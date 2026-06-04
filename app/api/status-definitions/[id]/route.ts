import { NextRequest } from "next/server";
import { updateStatusDefinition, deleteStatusDefinition } from "@/lib/statusData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_statuses");
    const { id } = await params;
    const updates = await req.json();
    const definition = await updateStatusDefinition(id, updates);
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "update_status",
      details: `Updated status definition "${definition.code}"`,
      status: "success",
    });
    return Response.json(definition, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_statuses");
    const { id } = await params;
    await deleteStatusDefinition(id);
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "delete_status",
      details: `Deleted status definition ${id}`,
      status: "success",
    });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
