import { NextRequest } from "next/server";
import { list } from "@vercel/blob";
import { gunzipSync } from "zlib";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";

/**
 * Raw blob diagnostic — bypasses readJson entirely.
 * Lists blobs by prefix and fetches their contents directly.
 *
 * Usage:
 *   /api/debug/ledger-check                         → list all blobs under live/sales/ and live/uploads/
 *   /api/debug/ledger-check?uploadId=XXXX            → read raw upload data, show ALL keys + status fields
 *   /api/debug/ledger-check?blobKey=sales/CLIENT/CH  → read specific blob, show keys + sample rows
 */
export async function GET(req: NextRequest) {
  try {
    requireLogin(req);

    const url = new URL(req.url);
    const uploadId = url.searchParams.get("uploadId");
    const blobKey = url.searchParams.get("blobKey");

    // ── Mode 1: Read specific blob by key ──
    if (blobKey) {
      const fullKey = blobKey.startsWith("live/") ? blobKey : `live/${blobKey}`;
      return Response.json(await inspectBlob(fullKey), { headers: noCacheHeaders() });
    }

    // ── Mode 2: Read raw upload data by upload ID ──
    if (uploadId) {
      const fullKey = `live/uploads/${uploadId}.json`;
      return Response.json(await inspectBlob(fullKey), { headers: noCacheHeaders() });
    }

    // ── Mode 3: List all relevant blobs ──
    const salesBlobs = await listBlobsByPrefix("live/sales/");
    const uploadBlobs = await listBlobsByPrefix("live/uploads/");

    return Response.json(
      {
        instructions: [
          "Use ?uploadId=XXXX to inspect a raw upload's data (shows all column keys + status values)",
          "Use ?blobKey=sales/CLIENTID/massbuild.json to inspect a ledger directly",
        ],
        salesBlobs: salesBlobs.map((b) => ({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt,
        })),
        uploadBlobs: uploadBlobs.map((b) => ({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt,
        })),
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

async function listBlobsByPrefix(prefix: string) {
  const allBlobs: { pathname: string; size: number; uploadedAt: Date; url: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await list({ prefix, limit: 100, cursor });
    allBlobs.push(...result.blobs);
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  return allBlobs;
}

async function inspectBlob(fullKey: string) {
  // Find the blob
  const { blobs } = await list({ prefix: fullKey, limit: 10 });
  const match = blobs.find((b) => b.pathname === fullKey);

  if (!match) {
    return {
      error: `Blob not found: ${fullKey}`,
      foundBlobs: blobs.map((b) => b.pathname),
    };
  }

  // Fetch the actual content
  const res = await fetch(`${match.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    return {
      error: `Fetch failed: ${res.status} ${res.statusText}`,
      blobUrl: match.url,
      blobSize: match.size,
    };
  }

  // This endpoint deliberately bypasses readJson to inspect the raw blob, so
  // it has to handle the gzip itself (see the transparent-gzip note in
  // lib/blob.ts). Sniff the magic bytes exactly as readJson does.
  const raw = Buffer.from(await res.arrayBuffer());
  const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const text = (gzipped ? gunzipSync(raw) : raw).toString("utf-8");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      error: "Not valid JSON",
      blobSize: match.size,
      textPreview: text.slice(0, 500),
    };
  }

  // If it's an array of objects (rows), analyze the keys + status fields
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
    const rows = data as Record<string, unknown>[];
    const allKeys = new Set<string>();
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      for (const k of Object.keys(rows[i])) allKeys.add(k);
    }

    // Find any key that contains "st" (case-insensitive) to catch status variants
    const statusLikeKeys = Array.from(allKeys).filter(
      (k) => k.toLowerCase().includes("st") && !k.toLowerCase().includes("cost") && !k.toLowerCase().includes("dist") && !k.toLowerCase().includes("list")
    );

    // Sample first 5 rows — show status-like fields + Article + Site
    const sampleRows = rows.slice(0, 5).map((row) => {
      const sample: Record<string, unknown> = {
        Article: row["Article"],
        Site: row["Site"],
      };
      for (const k of statusLikeKeys) {
        sample[k] = row[k];
      }
      return sample;
    });

    // Count non-empty values for each status-like key
    const statusKeyCounts: Record<string, number> = {};
    for (const k of statusLikeKeys) {
      let count = 0;
      for (const row of rows) {
        const v = row[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") count++;
      }
      statusKeyCounts[k] = count;
    }

    return {
      blobKey: fullKey,
      blobSize: match.size,
      totalRows: rows.length,
      allKeys: Array.from(allKeys).sort(),
      statusLikeKeys,
      statusKeyCounts,
      sampleRows,
    };
  }

  // Otherwise just show the data shape
  return {
    blobKey: fullKey,
    blobSize: match.size,
    dataType: Array.isArray(data) ? `array[${data.length}]` : typeof data,
    preview: JSON.stringify(data).slice(0, 1000),
  };
}
