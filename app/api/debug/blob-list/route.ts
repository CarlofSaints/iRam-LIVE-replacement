import { list } from "@vercel/blob";
import { NextRequest } from "next/server";

/**
 * PUBLIC diagnostic — lists all blobs in the store to determine if data exists.
 * DELETE THIS ENDPOINT after the data issue is resolved.
 *
 * Usage:
 *   /api/debug/blob-list             → list all blobs
 *   /api/debug/blob-list?read=KEY    → read a specific blob (e.g. ?read=clients.json)
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const readKey = url.searchParams.get("read");

    // Mode: read a specific blob directly
    if (readKey) {
      const fullKey = readKey.startsWith("live/") ? readKey : `live/${readKey}`;
      const { blobs } = await list({ prefix: fullKey, limit: 10 });
      const match = blobs.find((b) => b.pathname === fullKey);
      if (!match) {
        return Response.json(
          { error: `Blob not found: ${fullKey}`, foundBlobs: blobs.map(b => b.pathname) },
          { status: 404, headers: { "Cache-Control": "no-store" } }
        );
      }
      const res = await fetch(`${match.url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        return Response.json(
          { error: `Fetch failed: ${res.status}`, url: match.url },
          { status: 502, headers: { "Cache-Control": "no-store" } }
        );
      }
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        return Response.json(
          { blobKey: fullKey, size: match.size, data },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch {
        return Response.json(
          { blobKey: fullKey, size: match.size, rawPreview: text.slice(0, 2000) },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    // Mode: list all blobs
    const allBlobs: { pathname: string; size: number; uploadedAt: string }[] = [];
    let cursor: string | undefined;
    let totalSize = 0;

    for (let page = 0; page < 50; page++) {
      const result = await list({ prefix: "live/", limit: 1000, cursor });
      for (const b of result.blobs) {
        allBlobs.push({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt.toISOString(),
        });
        totalSize += b.size;
      }
      if (!result.hasMore) break;
      cursor = result.cursor;
    }

    return Response.json(
      {
        totalBlobs: allBlobs.length,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        blobs: allBlobs,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err: unknown) {
    return Response.json(
      {
        error: "Failed to list blobs",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
