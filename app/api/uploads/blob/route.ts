import { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requirePermission, handleAuthError } from "@/lib/auth";

// Issues a short-lived token so the BROWSER can upload a DISPO straight to Vercel
// Blob, bypassing the ~4.5MB serverless request-body limit that was failing large
// files with a generic "Network Error". The follow-up POST /api/uploads then
// fetches the blob URL server-side and parses it exactly as before.
export const dynamic = "force-dynamic";

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
        return {
          allowedContentTypes: [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
            "application/vnd.ms-excel", // .xls
            "application/octet-stream",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB headroom
          addRandomSuffix: true,
        };
      },
      // The file is processed by the follow-up /api/uploads call, not here.
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (err) {
    return handleAuthError(err);
  }
}
