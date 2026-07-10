import { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSession, requirePermission, AuthError, noCacheHeaders } from "@/lib/auth";

// Issues a short-lived token so the BROWSER can upload a DISPO straight to Vercel
// Blob, bypassing the ~4.5MB serverless request-body limit that was failing large
// files with a generic "Network Error". The follow-up POST /api/uploads then
// fetches the blob URL server-side and parses it exactly as before.
export const dynamic = "force-dynamic";

// Diagnostic — open in the browser while logged in. Confirms the session is seen
// here and that the Blob token is present, so we can tell an auth problem from a
// missing-env problem without reading server logs.
export async function GET(req: NextRequest) {
  const session = getSession(req);
  const tok = process.env.BLOB_READ_WRITE_TOKEN || "";
  const parts = tok.split("_");
  // Only shape info — prefix + counts, never the secret segment.
  return Response.json(
    {
      authed: !!session,
      role: session?.role ?? null,
      hasBlobToken: !!tok,
      tokenPrefix: tok.slice(0, 15),
      tokenSegments: parts.length,
      storeIdSegmentEmpty: !(parts[3] && parts[3].length > 0),
    },
    { headers: noCacheHeaders() },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Same permission the upload API itself enforces. The browser's upload()
        // is a same-origin request, so the session cookie is present here.
        await requirePermission(req, "upload_data");
        // No content-type restriction — browsers report inconsistent MIME for
        // .xlsx/.xls. No onUploadCompleted callback: the file is processed by the
        // follow-up /api/uploads call, and omitting it avoids a callback-URL step
        // that can fail on some deployments.
        return {
          maximumSizeInBytes: 200 * 1024 * 1024, // 200MB headroom
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(json);
  } catch (err) {
    // Surface the REAL cause in the body (temporarily) — the blob client only
    // shows a generic "Failed to retrieve the client token", and we need to see
    // exactly what handleUpload threw.
    console.error("uploads/blob token error:", err);
    const status = err instanceof AuthError ? err.status : 500;
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return Response.json({ error: message }, { status, headers: noCacheHeaders() });
  }
}
