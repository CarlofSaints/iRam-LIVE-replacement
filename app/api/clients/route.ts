import { NextRequest } from "next/server";
import { getClients, createClient } from "@/lib/clientData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    const session = requireLogin(req);
    let clients = await getClients();
    // Client-scoped users only ever see their assigned clients.
    if (session.clientIds && session.clientIds.length > 0) {
      const allowed = new Set(session.clientIds);
      clients = clients.filter((c) => allowed.has(c.id));
    }
    return Response.json(clients, { headers: noCacheHeaders() });
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
