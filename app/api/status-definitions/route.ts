import { NextRequest } from "next/server";
import { getStatusDefinitions, getStatusesByChannel, upsertStatus } from "@/lib/statusData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const url = new URL(req.url);
    const channelId = url.searchParams.get("channelId");
    if (channelId) {
      return Response.json(await getStatusesByChannel(channelId), { headers: noCacheHeaders() });
    }
    return Response.json(await getStatusDefinitions(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_statuses");
    const data = await req.json();
    if (!data.code || !data.channelId) {
      return Response.json({ error: "code and channelId are required" }, { status: 400, headers: noCacheHeaders() });
    }
    const { definition, isNew } = await upsertStatus({
      code: data.code,
      channelId: data.channelId,
      classification: data.classification,
      description: data.description,
      notes: data.notes,
    });
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: isNew ? "create_status" : "update_status",
      details: `${isNew ? "Created" : "Updated"} status definition "${definition.code}" for channel ${data.channelId}`,
      status: "success",
    });
    return Response.json(definition, { status: isNew ? 201 : 200, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
