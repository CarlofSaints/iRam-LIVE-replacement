import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig } from "@/lib/reportConfig";
import { getClientById } from "@/lib/clientData";
import { getStatusDefinitions } from "@/lib/statusData";
import { computeVitalSigns, getVitalSignsColumnOrder } from "@/lib/vitalSigns";
import { addLog } from "@/lib/activityLog";

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

    // 3. Load report config (DSC brackets + OTO multipliers)
    const config = await getReportConfig(clientId);

    // 4. Load all status definitions (covers all channels)
    const allStatusDefs = await getStatusDefinitions();
    const relevantStatusDefs = allStatusDefs.filter((s) =>
      channelIds.includes(s.channelId)
    );

    // 5. Compute vital signs
    const vitalRows = computeVitalSigns(
      enriched.rows,
      config.dscBrackets,
      dateColumns,
      relevantStatusDefs,
      config.otoMultipliers
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

    // 8. Return as downloadable xlsx
    // Naming: Vital Signs - CLIENT NAME - VENDOR - YYYYMMWkN
    const client = await getClientById(clientId);
    const vendorNum = client?.vendorNumbers?.[0] ?? "";
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const weekOfMonth = Math.ceil(now.getDate() / 7);
    const datePart = `${yyyy}${mm}Wk${weekOfMonth}`;
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
