import { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requirePermission, AuthError, noCacheHeaders } from "@/lib/auth";

// Issues a short-lived token so the BROWSER can upload a control file straight to
// Vercel Blob. A Range Management file runs to ~20MB, far past the ~4.5MB
// serverless request-body limit, so it can never be POSTed to the parse route
// directly. Same mechanism as /api/uploads/blob for DISPOs; the follow-up POST to
// /api/clients/[id]/control-files sends only the blob URL.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        await requirePermission(req, "manage_control_files");
        return {
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(json);
  } catch (err) {
    console.error("control-files/blob token error:", err);
    const status = err instanceof AuthError ? err.status : 500;
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return Response.json({ error: message }, { status, headers: noCacheHeaders() });
  }
}
