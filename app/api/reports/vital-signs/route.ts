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
import { addLog } from "@/lib/activityLog";
import { incrementReportCount } from "@/lib/reportCounts";

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

    // 4. Compute vital signs
    const vitalRows = computeVitalSigns(
      enriched.rows,
      config.dscBrackets,
      dateColumns,
      relevantStatusDefs,
      config.otoMultipliers,
      statusScenarios
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

    XLSX.utils.book_append_sheet(wb, ws, "Vital Signs");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

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
    // Naming: Vital Signs - CLIENT NAME - VENDOR - YYYYMMWkN
    const client = await getClientById(clientId);
    const vendorNum = client?.vendorNumbers?.[0] ?? "";

    // Use period from query params, fall back to ledger meta, then current date
    const latestMeta = ledgerResults.find(({ meta }) => meta?.reportYear)?.meta;
    const rYear = yearParam ? parseInt(yearParam, 10) : (latestMeta?.reportYear ?? new Date().getFullYear());
    const rMonth = monthParam ? parseInt(monthParam, 10) : (latestMeta?.reportMonth ?? (new Date().getMonth() + 1));
    const rWeek = weekParam ? parseInt(weekParam, 10) : (latestMeta?.reportWeek ?? Math.ceil(new Date().getDate() / 7));
    const datePart = `${rYear}${String(rMonth).padStart(2, "0")}Wk${rWeek}`;
    const fileName = `Vital Signs - ${clientName} - ${vendorNum} - ${datePart}.xlsx`;

    return new Response(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
