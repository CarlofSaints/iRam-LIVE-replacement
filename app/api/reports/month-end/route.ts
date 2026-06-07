import { NextRequest } from "next/server";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig, classifyDSC } from "@/lib/reportConfig";
import { getClientById } from "@/lib/clientData";
import { addLog } from "@/lib/activityLog";
import {
  buildDateContext,
  buildSalesSummary,
  buildOOSSummary,
  buildOOSDetail,
} from "@/lib/monthEndReport";
import { buildMonthEndWorkbook } from "@/lib/monthEndExcel";
import { calcMonthLastSold } from "@/lib/vitalSigns";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
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

    // 3. Load report config for DSC brackets
    const config = await getReportConfig(clientId);

    // 4. Enrich rows with DSC alert + date last sold for OOS Detail
    const enrichedRows = enriched.rows.map((row) => {
      const actDsc = Number(row["Act DSC"] ?? 0);
      return {
        ...row,
        _dscAlert: classifyDSC(actDsc, config.dscBrackets),
        _dateLastSold: calcMonthLastSold(row, dateColumns),
      };
    });

    // 5. Build date context
    const ctx = buildDateContext(dateColumns);

    // 6. Build all report data
    const salesSummary = buildSalesSummary(enrichedRows, ctx);
    const oosSummary = buildOOSSummary(enrichedRows);
    const oosDetail = buildOOSDetail(enrichedRows);

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

    // 8. Build Excel workbook
    const buf = await buildMonthEndWorkbook(
      salesSummary,
      oosSummary,
      oosDetail,
      clientName || client?.name || "Unknown",
      channelLabel,
      periodLabel,
    );

    // 9. Log activity
    addLog({
      userId: session.userId,
      userName: session.name,
      action: "Downloaded Month-End report",
      details: `Client: ${clientName}, Channels: ${channelLabel}, ${allRows.length} ledger rows`,
      status: "success",
    }).catch(() => {});

    // 10. Return as downloadable xlsx
    const datePart = `${rYear}${String(rMonth).padStart(2, "0")}Wk${rWeek}`;
    const fileName = `Month End - ${clientName || "Report"} - ${vendorNum} - ${datePart}.xlsx`;

    return new Response(new Uint8Array(buf), {
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
