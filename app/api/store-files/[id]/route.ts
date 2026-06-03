import { NextRequest } from "next/server";
import { getStoreFileRecords, deleteStoreFile } from "@/lib/storeFileData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireLogin(req);
    const { id } = await params;
    return Response.json(await getStoreFileRecords(id), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_store_files");
    const { id } = await params;
    await deleteStoreFile(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_store_file", details: `Deleted store file ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
