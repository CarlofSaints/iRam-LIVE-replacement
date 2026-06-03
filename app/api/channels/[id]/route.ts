import { NextRequest } from "next/server";
import { updateChannel, deleteChannel } from "@/lib/channelData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_channels");
    const { id } = await params;
    const updates = await req.json();
    const channel = await updateChannel(id, updates);
    await addLog({ userId: session.userId, userName: session.name, action: "update_channel", details: `Updated channel ${channel.name}`, status: "success" });
    return Response.json(channel, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_channels");
    const { id } = await params;
    await deleteChannel(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_channel", details: `Deleted channel ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
