import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig } from "@/lib/reportConfig";
import { getClientById } from "@/lib/clientData";
import { getStatusDefinitions } from "@/lib/statusData";
import { getStatusScenarios } from "@/lib/statusScenarioData";
import { computeVitalSigns, getVitalSignsColumnOrder } from "@/lib/vitalSigns";
import { analyzeCoverage, coverageMessageLines, formatMonth } from "@/lib/dataCoverage";
import { addLog } from "@/lib/activityLog";
import { incrementReportCount } from "@/lib/reportCounts";
import { saveReportToSharePointSafe } from "@/lib/sharepoint";
import { resolveReportPeriod, reportVendorPart } from "@/lib/reportPeriod";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "export_data");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelIdsParam = url.searchParams.get("channelIds"); // comma-separated

    if (!clientId || !channelIdsParam) {
      return Response.json(
        { error: "clientId and channelIds are required" },
        { status: 400 }
      );
    }

    const channelIds = channelIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (channelIds.length === 0) {
      return Response.json(
        { error: "At least one channelId is required" },
        { status: 400 }
      );
    }

    // Optional period override params
    const yearParam = url.searchParams.get("year");
    const monthParam = url.searchParams.get("month");
    const weekParam = url.searchParams.get("week");

    // 1. Load and merge sales ledgers from all selected channels
    const ledgerResults = await Promise.all(
      channelIds.map(async (chId) => {
        const [rows, meta] = await Promise.all([
          getSalesLedger(clientId, chId),
          getSalesLedgerMeta(clientId, chId),
        ]);
        return { rows, meta, channelId: chId };
      })
    );

    const allRows: Record<string, unknown>[] = [];
    const allDateCols = new Set<string>();
    const channelNames: string[] = [];
    let clientName = "";

    for (const { rows, meta } of ledgerResults) {
      if (rows.length > 0) allRows.push(...rows);
      if (meta) {
        for (const dc of meta.dateColumns ?? []) allDateCols.add(dc);
        if (meta.channelName) channelNames.push(meta.channelName);
        if (meta.clientName) clientName = meta.clientName;
      }
    }

    if (allRows.length === 0) {
      return Response.json(
        { error: "No sales data found for the selected channels" },
        { status: 404 }
      );
    }

    const dateColumns = Array.from(allDateCols);

    // 2. Enrich rows with PMF + store dimensions
    const enriched = await enrichLedger(allRows, clientId);

    // 3. Load report config, status definitions, and scenarios in parallel
    const [config, allStatusDefs, statusScenarios] = await Promise.all([
      getReportConfig(clientId),
      getStatusDefinitions(),
      getStatusScenarios(),
    ]);
    const relevantStatusDefs = allStatusDefs.filter((s) =>
      channelIds.includes(s.channelId)
    );
    const relevantScenarios = statusScenarios.filter((s) =>
      channelIds.includes(s.channelId)
    );

    // 4. Compute vital signs
    const vitalRows = computeVitalSigns(
      enriched.rows,
      config.dscBrackets,
      dateColumns,
      relevantStatusDefs,
      config.otoMultipliers,
      relevantScenarios
    );

    // 6. Build Excel
    const columnOrder = getVitalSignsColumnOrder(dateColumns);
    const sheetData: unknown[][] = [];

    // Header row
    sheetData.push(columnOrder);

    // Data rows — output only columns in columnOrder
    for (const row of vitalRows) {
      const dataRow: unknown[] = columnOrder.map((col) => {
        const val = row[col];
        if (val === undefined || val === null) return "";
        return val;
      });
      sheetData.push(dataRow);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Auto-width columns
    ws["!cols"] = columnOrder.map((col) => ({
      wch: Math.max(col.length, 10),
    }));

    // Format monetary (Rand) columns as Rands. Rand columns are the value
    // columns (any "… Value" header, incl. monthly + OTO + Curr Y/S) plus the
    // price/cost columns. Units, counts, %, DSC and rankings are left alone.
    const RAND_FMT = '"R "#,##0.00';
    const isRandCol = (name: string) =>
      name.includes("Value") || ["MAC", "Nett Cost", "Incl SP", "Promo SP"].includes(name);
    const randColIdx = columnOrder
      .map((c, i) => (isRandCol(c) ? i : -1))
      .filter((i) => i >= 0);
    for (let rIdx = 1; rIdx < sheetData.length; rIdx++) {
      for (const ci of randColIdx) {
        const ref = XLSX.utils.encode_cell({ r: rIdx, c: ci });
        const cell = ws[ref];
        if (cell && cell.t === "n") cell.z = RAND_FMT;
      }
    }

    // Prepend a Data Coverage sheet when the ledger's monthly series has gaps,
    // so the warning travels with the file — growth read off an incomplete
    // prior-year base is overstated. Lands as the FIRST tab.
    const coverage = analyzeCoverage(dateColumns);
    if (coverage.hasGaps) {
      const aoa: unknown[][] = [
        ["⚠ DATA COVERAGE WARNING"],
        [`Client: ${clientName}`],
        [],
        ...coverageMessageLines(coverage).map((l) => [l]),
        [],
      ];
      if (coverage.firstMonth && coverage.lastMonth) {
        aoa.push([`Data present from ${formatMonth(coverage.firstMonth)} to ${formatMonth(coverage.lastMonth)}.`]);
        aoa.push(["To fill a gap, re-upload the DISPO that carries that month (each DISPO includes several trailing months plus the same month a year prior)."]);
      }
      const cws = XLSX.utils.aoa_to_sheet(aoa);
      cws["!cols"] = [{ wch: 130 }];
      XLSX.utils.book_append_sheet(wb, cws, "Data Coverage");
    }

    XLSX.utils.book_append_sheet(wb, ws, "Vital Signs");

    // compression: true is essential — SheetJS writes an UNCOMPRESSED zip by
    // default, which made this ~10k-row × 67-col report ~27MB. DEFLATE cuts it
    // several-fold with no change to the data.
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });

    // 7. Log activity
    const channelLabel = channelNames.join(", ") || channelIds.join(", ");
    addLog({
      userId: session.userId,
      userName: session.name,
      action: "Downloaded Vital Signs report",
      details: `Client: ${clientName}, Channels: ${channelLabel}, ${vitalRows.length} rows`,
      status: "success",
    }).catch(() => {});
    incrementReportCount(clientId, "vitalSigns").catch(() => {});

    // 8. Return as downloadable xlsx
    // Naming: Vital Signs - CLIENT NAME - VENDOR(S) - YYYYMMWkN
    // The vendors named are the ones actually in the file, read off the rows —
    // not vendorNumbers[0], which is just whichever sorts first on the client
    // record. See reportVendorPart in lib/reportPeriod.ts.
    const client = await getClientById(clientId);
    const vendorNum = reportVendorPart(enriched.rows, client?.vendorNumbers);

    // Period from query params, else the LATEST stamped ledger, else today.
    // This used to take the FIRST stamped ledger (channel order, not time
    // order) — see lib/reportPeriod.ts for what that did to the labels.
    const period = resolveReportPeriod(
      ledgerResults.map(({ meta }) => meta),
      { year: yearParam, month: monthParam, week: weekParam },
    );
    const datePart = period.filePart;
    const fileName = `Vital Signs - ${clientName} - ${vendorNum} - ${datePart}.xlsx`;
    console.log(
      `[vital-signs] period ${period.label} — year:${period.source.year} month:${period.source.month} week:${period.source.week}`,
    );

    // 9. Auto-save to the client's Vital Signs SharePoint folder (best-effort)
    const spHeaders = await saveReportToSharePointSafe(config.spUrls?.vital_signs, fileName, buf);

    return new Response(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        ...spHeaders,
      },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
