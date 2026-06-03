import { NextRequest } from "next/server";
import { getClientById, updateClient, deleteClient } from "@/lib/clientData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireLogin(req);
    const { id } = await params;
    const client = await getClientById(id);
    if (!client) return Response.json({ error: "Not found" }, { status: 404, headers: noCacheHeaders() });
    return Response.json(client, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const { id } = await params;
    const updates = await req.json();
    const client = await updateClient(id, updates);
    await addLog({ userId: session.userId, userName: session.name, action: "update_client", details: `Updated client ${client.name}`, status: "success" });
    return Response.json(client, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const { id } = await params;
    await deleteClient(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_client", details: `Deleted client ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
