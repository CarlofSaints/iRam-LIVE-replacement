import { NextRequest } from "next/server";
import { getChannels, createChannel } from "@/lib/channelData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const channels = await getChannels();
    return Response.json(channels, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_channels");
    const { name, parentId } = await req.json();
    if (!name) return Response.json({ error: "Name is required" }, { status: 400, headers: noCacheHeaders() });
    const channel = await createChannel({ name, parentId });
    await addLog({ userId: session.userId, userName: session.name, action: "create_channel", details: `Created channel ${channel.name}`, status: "success" });
    return Response.json(channel, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
