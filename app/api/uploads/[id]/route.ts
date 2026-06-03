import { NextRequest } from "next/server";
import { getUploadById, getUploadData, deleteUpload } from "@/lib/uploadData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireLogin(req);
    const { id } = await params;
    const meta = await getUploadById(id);
    if (!meta) return Response.json({ error: "Not found" }, { status: 404, headers: noCacheHeaders() });
    const data = await getUploadData(id);
    return Response.json({ meta, data }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "delete_uploads");
    const { id } = await params;
    await deleteUpload(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_upload", details: `Deleted upload ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
