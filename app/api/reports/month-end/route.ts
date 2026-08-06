import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, AuthError, noCacheHeaders } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig, classifyDSC, dscBracketLabels } from "@/lib/reportConfig";
import { getClientById } from "@/lib/clientData";
import { addLog } from "@/lib/activityLog";
import { incrementReportCount } from "@/lib/reportCounts";
import {
  buildDateContext,
  buildSalesSummary,
  buildOOSSummary,
  buildOOSDetail,
  buildStatusSummary,
  buildStatusDetail,
  buildMarginAnalysis,
  buildPhantomAnalysis,
  buildNumericalDistribution,
  buildOpenToOrder,
  buildDscSummary,
  buildDscDetail,
} from "@/lib/monthEndReport";
import { buildMonthEndWorkbook } from "@/lib/monthEndExcel";
import { calcMonthLastSold } from "@/lib/vitalSigns";
import { getStatusDefinitions } from "@/lib/statusData";
import { getStatusScenarios } from "@/lib/statusScenarioData";
import { getMergedStores } from "@/lib/storeFileData";
import { getProductLookup } from "@/lib/productMasterData";
import { getControlFileData } from "@/lib/controlFileData";
import { getClientLogo, getChannelLogo } from "@/lib/logoData";
import { saveReportToSharePointSafe } from "@/lib/sharepoint";

/* This report is an order of magnitude heavier than Vital Signs: it reads the
   whole store master, the product lookup and the ranging file on top of the
   ledgers, runs a dozen analyses over every row, and builds 16 exceljs sheets
   (exceljs holds a styled object per cell, unlike SheetJS). 120s was enough
   until the ledgers grew. Pro allows 300. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  /* Which stage we are in, so a failure can NAME it. Previously every error
     here became "Internal server error" with the cause visible only in the
     Vercel logs, which is no use to the person the report failed for. */
  const startedAt = Date.now();
  const timings: { stage: string; ms: number }[] = [];
  let stage = "starting up";
  let stageAt = startedAt;
  const enter = (next: string) => {
    timings.push({ stage, ms: Date.now() - stageAt });
    stage = next;
    stageAt = Date.now();
  };

  try {
    const session = await requirePermission(req, "export_data");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelIdsParam = url.searchParams.get("channelIds");

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

    // Optional dimension filters (multi-value, comma-separated)
    const subChFilter = (url.searchParams.get("subChannels") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const catFilter = (url.searchParams.get("categories") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    // Phantom thresholds in months (blank / 0 → no constraint on that dimension)
    const parseMonths = (v: string | null): number | null => {
      const n = v ? parseInt(v, 10) : NaN;
      return !isNaN(n) && n > 0 ? n : null;
    };
    const phLastSold = parseMonths(url.searchParams.get("phLastSold"));
    const phLastReceived = parseMonths(url.searchParams.get("phLastReceived"));

    // ND rolling window in months (1–24, default 6)
    const ndMonthsRaw = parseInt(url.searchParams.get("ndMonths") || "", 10);
    const ndMonths = !isNaN(ndMonthsRaw) && ndMonthsRaw >= 1 && ndMonthsRaw <= 24 ? ndMonthsRaw : 6;

    // Which sheets to include (empty = all)
    const includeSheets = (url.searchParams.get("sheets") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    // Main channel (for the cover-sheet channel logo)
    const mainChannelId = url.searchParams.get("mainChannelId") || "";

    // Diagnostic mode: run everything EXCEPT the Excel build and return the
    // stage timings as JSON. That splits the two ways this report can die —
    // loading/analysing the data, or building the workbook — without guessing.
    const diagnose = url.searchParams.get("diagnose") === "1";

    // 1. Load and merge sales ledgers from all selected channels
    enter("loading the sales ledgers");
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
    enter("joining products and stores onto the rows");
    const enriched = await enrichLedger(allRows, clientId);

    // 3. Load report config for DSC brackets
    const config = await getReportConfig(clientId);

    // 4. Enrich rows with DSC alert + date last sold for OOS Detail
    const enrichedRows: Record<string, unknown>[] = enriched.rows.map((row) => {
      const actDsc = Number((row as Record<string, unknown>)["Act DSC"] ?? 0);
      return {
        ...row,
        _dscAlert: classifyDSC(actDsc, config.dscBrackets),
        _dateLastSold: calcMonthLastSold(row, dateColumns),
      };
    });

    // 4b. Apply optional sub-channel / category filters (scopes every sheet)
    const subSet = new Set(subChFilter);
    const catSet = new Set(catFilter);
    const reportRows = (subSet.size || catSet.size)
      ? enrichedRows.filter((row) => {
          const sub = String(row["_storeSubChannel"] || row["_storeChannel"] || "");
          const cat = String(row["_category"] || "");
          if (subSet.size && !subSet.has(sub)) return false;
          if (catSet.size && !catSet.has(cat)) return false;
          return true;
        })
      : enrichedRows;

    // 5. Build date context
    const ctx = buildDateContext(dateColumns);

    // Status classification inputs (Status Reference logic)
    enter("reading the status reference");
    const [statusDefs, allStatusScenarios] = await Promise.all([
      getStatusDefinitions(),
      getStatusScenarios(),
    ]);
    // Scenarios are per-channel — scope to the channels in this report
    const statusScenarios = allStatusScenarios.filter((s) =>
      channelIds.includes(s.channelId)
    );

    // 6. Build all report data (from the filtered row set)
    enter("building the Sales, OOS, Status, Margin and DSC analyses");
    const salesSummary = buildSalesSummary(reportRows, ctx);
    const oosSummary = buildOOSSummary(reportRows, dateColumns);
    const oosDetail = buildOOSDetail(reportRows, dateColumns);
    const statusSummary = buildStatusSummary(reportRows, dateColumns, statusDefs, statusScenarios);
    const statusDetail = buildStatusDetail(reportRows, dateColumns, statusDefs, statusScenarios);
    const marginAnalysis = buildMarginAnalysis(reportRows);
    const dscSummary = buildDscSummary(reportRows, dateColumns, dscBracketLabels(config.dscBrackets));
    const dscDetail = buildDscDetail(reportRows, dateColumns);

    // 7. Build period label
    const client = await getClientById(clientId);
    const vendorNum = client?.vendorNumbers?.[0] ?? "";
    const latestMeta = ledgerResults.find(({ meta }) => meta?.reportYear)?.meta;
    const rYear = yearParam ? parseInt(yearParam, 10) : (latestMeta?.reportYear ?? new Date().getFullYear());
    const rMonth = monthParam ? parseInt(monthParam, 10) : (latestMeta?.reportMonth ?? (new Date().getMonth() + 1));
    const rWeek = weekParam ? parseInt(weekParam, 10) : (latestMeta?.reportWeek ?? Math.ceil(new Date().getDate() / 7));

    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const periodLabel = `${monthNames[rMonth] || rMonth} ${rYear} Wk${rWeek}`;
    const channelLabel = channelNames.join(", ") || channelIds.join(", ");

    // Phantom: reference date = last day of the report month (UTC, relative "months ago")
    const referenceDate = new Date(Date.UTC(rYear, rMonth, 0));
    const phantomAnalysis = buildPhantomAnalysis(reportRows, {
      referenceDate,
      lastSoldMonths: phLastSold,
      lastReceivedMonths: phLastReceived,
    });

    // Numerical Distribution — scenario depends on whether a ranging file exists
    enter("reading the store master, product master and ranging file");
    const hasRanging = !!client?.controlFiles?.ranging;
    const [ndStores, ndProducts, ndRanging, clientLogo, channelLogo] = await Promise.all([
      getMergedStores(),
      getProductLookup(clientId),
      hasRanging ? getControlFileData<Record<string, unknown>>(clientId, "ranging") : Promise.resolve([]),
      getClientLogo(clientId),
      mainChannelId ? getChannelLogo(mainChannelId) : Promise.resolve(null),
    ]);
    enter("building Numerical Distribution");
    let ndAnalysis;
    try {
      ndAnalysis = buildNumericalDistribution({
        rows: reportRows,
        dateColumns,
        refYear: rYear,
        refMonth: rMonth,
        rollingMonths: ndMonths,
        hasRanging,
        rangingRows: ndRanging,
        stores: ndStores,
        products: ndProducts,
        channelNames,
      });
    } catch (e) {
      console.error("ND build failed — skipping ND sheets", e);
      ndAnalysis = undefined;
    }

    // Open to Order — suggested replenishment for out-of-stock, orderable lines
    enter("building Open to Order");
    const otoAnalysis = buildOpenToOrder({
      rows: reportRows,
      statusDefs,
      statusScenarios,
      otoMultipliers: config.otoMultipliers,
      hasRanging,
      rangingRows: ndRanging,
    });

    if (diagnose) {
      enter("done");
      return Response.json(
        {
          diagnose: true,
          note: "All data loaded and analysed successfully — the Excel build was skipped. If this succeeds but the real download fails, the workbook build is the problem.",
          elapsedMs: Date.now() - startedAt,
          ledgerRows: allRows.length,
          rowsAfterFilters: reportRows.length,
          dateColumns: dateColumns.length,
          storeMasterRows: ndStores.length,
          rangingRows: ndRanging.length,
          sheetsRequested: includeSheets.length || "all",
          ndBuilt: !!ndAnalysis,
          timings,
        },
        { headers: noCacheHeaders() },
      );
    }

    // 8. Build Excel workbook (Data sheet holds the filtered enriched rows)
    enter("building the Excel workbook");
    const buf = await buildMonthEndWorkbook(
      salesSummary,
      oosSummary,
      oosDetail,
      clientName || client?.name || "Unknown",
      channelLabel,
      periodLabel,
      reportRows,
      dateColumns,
      statusSummary,
      statusDetail,
      marginAnalysis,
      phantomAnalysis,
      includeSheets,
      ndAnalysis,
      clientLogo?.dataUrl,
      channelLogo?.dataUrl,
      otoAnalysis,
      dscSummary,
      dscDetail,
    );

    // 9. Log activity
    addLog({
      userId: session.userId,
      userName: session.name,
      action: "Downloaded Month-End report",
      details: `Client: ${clientName}, Channels: ${channelLabel}, ${allRows.length} ledger rows`,
      status: "success",
    }).catch(() => {});
    if (clientId) incrementReportCount(clientId, "monthEnd").catch(() => {});

    // 10. Return as downloadable xlsx
    const datePart = `${rYear}${String(rMonth).padStart(2, "0")}Wk${rWeek}`;
    const fileName = `Month End - ${clientName || "Report"} - ${vendorNum} - ${datePart}.xlsx`;

    const fileBytes = new Uint8Array(buf);
    // Auto-save to the client's Month-End SharePoint folder (best-effort)
    enter("saving a copy to SharePoint");
    const spHeaders = await saveReportToSharePointSafe(config.spUrls?.month_end, fileName, fileBytes);
    enter("done");
    console.log(
      `Month-End OK — ${allRows.length} rows, ${(fileBytes.length / 1_048_576).toFixed(1)}MB, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      timings,
    );

    return new Response(fileBytes, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        ...spHeaders,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);

    /* Say what actually went wrong, and where. "Internal server error" told
       the person nothing and told us nothing either — the cause was only ever
       in the Vercel logs, so a report failing in the field was undiagnosable. */
    const detail = err instanceof Error ? err.message : String(err);
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `Month-End FAILED while ${stage} after ${(elapsedMs / 1000).toFixed(1)}s`,
      timings,
      err,
    );
    return Response.json(
      {
        error: `The Month-End report failed while ${stage}. ${detail}`,
        stage,
        detail,
        elapsedMs,
        timings,
      },
      { status: 500, headers: noCacheHeaders() },
    );
  }
}
