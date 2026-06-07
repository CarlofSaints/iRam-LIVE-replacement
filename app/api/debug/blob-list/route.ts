import { list } from "@vercel/blob";

/**
 * PUBLIC diagnostic — lists all blobs in the store to determine if data exists.
 * DELETE THIS ENDPOINT after the data issue is resolved.
 */
export async function GET() {
  try {
    const allBlobs: { pathname: string; size: number; uploadedAt: string }[] = [];
    let cursor: string | undefined;

    // Paginate through ALL blobs in the store
    for (let page = 0; page < 50; page++) {
      const result = await list({ prefix: "live/", limit: 1000, cursor });
      for (const b of result.blobs) {
        allBlobs.push({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt.toISOString(),
        });
      }
      if (!result.hasMore) break;
      cursor = result.cursor;
    }

    return Response.json(
      {
        totalBlobs: allBlobs.length,
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
