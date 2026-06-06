import { NextRequest } from "next/server";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { getUploadIndex, getUploadData } from "@/lib/uploadData";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelId = url.searchParams.get("channelId");

    if (!clientId || !channelId) {
      return Response.json(
        { error: "clientId and channelId are required" },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    // 1. Check the merged ledger
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
      // Only include status-related fields + Article + Site for readability
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

    // 2. Check the most recent raw upload for this client
    const uploads = await getUploadIndex();
    const clientUploads = uploads.filter(
      (u) => u.clientId === clientId && u.channelId === channelId && u.fileType === "dispo",
    );
    const latestUpload = clientUploads[0]; // newest first

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
