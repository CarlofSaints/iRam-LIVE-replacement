import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig } from "@/lib/reportConfig";
import { getStatusesByChannel } from "@/lib/statusData";
import { computeVitalSigns, getVitalSignsColumnOrder } from "@/lib/vitalSigns";
import { addLog } from "@/lib/activityLog";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "export_data");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelId = url.searchParams.get("channelId");

    if (!clientId || !channelId) {
      return Response.json(
        { error: "clientId and channelId are required" },
        { status: 400 }
      );
    }

    // 1. Load sales ledger + meta
    const [ledgerRows, meta] = await Promise.all([
      getSalesLedger(clientId, channelId),
      getSalesLedgerMeta(clientId, channelId),
    ]);

    if (ledgerRows.length === 0 || !meta) {
      return Response.json(
        { error: "No sales data found for this client/channel" },
        { status: 404 }
      );
    }

    const dateColumns = meta.dateColumns ?? [];

    // 2. Enrich rows with PMF + store dimensions
    const enriched = await enrichLedger(ledgerRows, clientId);

    // 3. Load report config (DSC brackets)
    const config = await getReportConfig(clientId);

    // 4. Load status definitions for OTO calculation
    const statusDefs = await getStatusesByChannel(channelId);

    // 5. Compute vital signs
    const vitalRows = computeVitalSigns(
      enriched.rows,
      config.dscBrackets,
      dateColumns,
      statusDefs,
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
    addLog({
      userId: session.userId,
      userName: session.name,
      action: "Downloaded Vital Signs report",
      details: `Client: ${meta.clientName}, Channel: ${meta.channelName}, ${vitalRows.length} rows`,
      status: "success",
    }).catch(() => {});

    // 8. Return as downloadable xlsx
    const fileName = `Vital_Signs_${meta.clientName}_${meta.channelName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
