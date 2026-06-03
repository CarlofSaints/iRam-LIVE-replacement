import { NextRequest } from "next/server";
import { getClients, createClient } from "@/lib/clientData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    return Response.json(await getClients(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const data = await req.json();
    const client = await createClient(data);
    await addLog({ userId: session.userId, userName: session.name, action: "create_client", details: `Created client ${client.name}`, status: "success" });
    return Response.json(client, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
