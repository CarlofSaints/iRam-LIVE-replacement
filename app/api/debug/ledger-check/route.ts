import { NextRequest } from "next/server";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta, getAllSalesLedgers } from "@/lib/salesData";
import { getUploadIndex, getUploadData } from "@/lib/uploadData";
import { getClients } from "@/lib/clientData";
import { getChannels } from "@/lib/channelData";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelId = url.searchParams.get("channelId");

    // If no params, show all available data locations
    if (!clientId) {
      const [clients, channels, uploads] = await Promise.all([
        getClients(),
        getChannels(),
        getUploadIndex(),
      ]);

      // Build a map of all ledgers per client
      const clientLedgers: Record<string, unknown> = {};
      for (const client of clients) {
        const ledgers = await getAllSalesLedgers(client.id);
        if (ledgers.length > 0) {
          clientLedgers[client.id] = {
            clientName: client.name,
            vendorNumbers: client.vendorNumbers,
            channelIds: client.channelIds,
            ledgers: ledgers.map((l) => ({
              channelId: l.channelId,
              channelName: l.channelName,
              totalRows: l.totalRows,
              dateColumns: l.dateColumns,
              lastMergedAt: l.lastMergedAt,
            })),
          };
        }
      }

      // Summarize uploads
      const uploadSummary = uploads.slice(0, 20).map((u) => ({
        id: u.id,
        clientId: u.clientId,
        clientName: u.clientName,
        channelId: u.channelId,
        channelName: u.channelName,
        fileType: u.fileType,
        fileName: u.fileName,
        rowCount: u.rowCount,
        uploadDate: u.uploadDate,
      }));

      // Channel map for reference
      const channelMap = channels.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId ?? null,
        isMain: !c.parentId,
      }));

      return Response.json(
        {
          instructions: "Use ?clientId=X&channelId=Y to inspect a specific ledger. Below shows all available data.",
          clients: clients.map((c) => ({
            id: c.id,
            name: c.name,
            vendorNumbers: c.vendorNumbers,
            channelIds: c.channelIds,
          })),
          channels: channelMap,
          clientLedgers,
          recentUploads: uploadSummary,
        },
        { headers: noCacheHeaders() },
      );
    }

    if (!channelId) {
      // Show all ledgers for this client
      const ledgers = await getAllSalesLedgers(clientId);
      return Response.json(
        {
          instructions: "Add &channelId=X to inspect a specific ledger",
          clientId,
          ledgers: ledgers.map((l) => ({
            channelId: l.channelId,
            channelName: l.channelName,
            totalRows: l.totalRows,
            lastMergedAt: l.lastMergedAt,
          })),
        },
        { headers: noCacheHeaders() },
      );
    }

    // Full inspection for a specific clientId + channelId
    const [ledger, meta] = await Promise.all([
      getSalesLedger(clientId, channelId),
      getSalesLedgerMeta(clientId, channelId),
    ]);

    // Collect all unique keys across first 10 rows
    const allKeys = new Set<string>();
    const sampleRows: Record<string, unknown>[] = [];
    for (let i = 0; i < Math.min(ledger.length, 10); i++) {
      const row = ledger[i];
      for (const k of Object.keys(row)) allKeys.add(k);
      sampleRows.push({
        Article: row["Article"],
        Site: row["Site"],
        Status: row["Status"],
        "PR ST": row["PR ST"],
        "pr st": row["pr st"],
        RP: row["RP"],
        "R. Profile": row["R. Profile"],
      });
    }

    // Count how many rows have a non-empty Status
    let statusCount = 0;
    let prStCount = 0;
    for (const row of ledger) {
      const s = row["Status"];
      if (s !== undefined && s !== null && String(s).trim() !== "") statusCount++;
      const p = row["PR ST"];
      if (p !== undefined && p !== null && String(p).trim() !== "") prStCount++;
    }

    // Check the most recent raw upload for this client+channel
    const uploads = await getUploadIndex();
    const clientUploads = uploads.filter(
      (u) => u.clientId === clientId && u.channelId === channelId && u.fileType === "dispo",
    );
    const latestUpload = clientUploads[0];

    let rawSample: Record<string, unknown>[] = [];
    let rawKeys: string[] = [];
    let rawStatusCount = 0;
    let rawPrStCount = 0;

    if (latestUpload) {
      const rawData = await getUploadData(latestUpload.id);
      rawKeys = rawData.length > 0 ? Object.keys(rawData[0]) : [];

      for (let i = 0; i < Math.min(rawData.length, 10); i++) {
        const row = rawData[i];
        rawSample.push({
          Article: row["Article"],
          Site: row["Site"],
          Status: row["Status"],
          "PR ST": row["PR ST"],
          "pr st": row["pr st"],
          RP: row["RP"],
          "R. Profile": row["R. Profile"],
        });
      }

      for (const row of rawData) {
        const s = row["Status"];
        if (s !== undefined && s !== null && String(s).trim() !== "") rawStatusCount++;
        const p = row["PR ST"];
        if (p !== undefined && p !== null && String(p).trim() !== "") rawPrStCount++;
      }
    }

    return Response.json(
      {
        ledger: {
          totalRows: ledger.length,
          allKeysInFirst10: Array.from(allKeys).sort(),
          hasStatusKey: allKeys.has("Status"),
          hasPrStKey: allKeys.has("PR ST"),
          rowsWithStatusValue: statusCount,
          rowsWithPrStValue: prStCount,
          sampleRows,
        },
        latestUpload: latestUpload
          ? {
              id: latestUpload.id,
              fileName: latestUpload.fileName,
              uploadDate: latestUpload.uploadDate,
              rowCount: latestUpload.rowCount,
              allKeysInRow0: rawKeys,
              hasStatusKey: rawKeys.includes("Status"),
              hasPrStKey: rawKeys.includes("PR ST"),
              rawRowsWithStatusValue: rawStatusCount,
              rawRowsWithPrStValue: rawPrStCount,
              sampleRows: rawSample,
            }
          : null,
        meta,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
