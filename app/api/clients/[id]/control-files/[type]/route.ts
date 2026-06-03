import { NextRequest } from "next/server";
import { getControlFileData, deleteControlFile } from "@/lib/controlFileData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import type { ControlFileType } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    requireLogin(req);
    const { id, type } = await params;
    const data = await getControlFileData(id, type as ControlFileType);
    return Response.json(data, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const { id, type } = await params;
    await deleteControlFile(id, type as ControlFileType);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_control_file", details: `Deleted ${type} for client ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
