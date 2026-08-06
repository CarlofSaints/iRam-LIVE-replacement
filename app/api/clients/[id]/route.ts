import { NextRequest } from "next/server";
import { getClientById, updateClient } from "@/lib/clientData";
import { purgeClient } from "@/lib/clientPurge";
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

/**
 * Irreversibly deletes a client AND all of its stored data.
 *
 * Requires `?confirm=<exact client name>` — a mis-aimed delete here destroys
 * every ledger and upload the client ever had, so the caller has to prove it
 * knows which client it is asking for. GET the sibling /purge-preview route
 * first to see what will be destroyed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // NOT manage_clients — that grants add/edit/archive, which a CAM needs.
    // This purges every ledger, upload and control file the client has.
    const session = await requirePermission(req, "delete_clients");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    const confirm = new URL(req.url).searchParams.get("confirm");
    if (!confirm || confirm.trim().toLowerCase() !== client.name.trim().toLowerCase()) {
      return Response.json(
        { error: `Type the client name exactly ("${client.name}") to confirm deletion.` },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const result = await purgeClient(id);
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "delete_client",
      details:
        `Deleted client ${client.name} and purged ${result.deletedBlobs} object(s), ` +
        `${(result.totalBytes / 1e6).toFixed(1)} MB, ${result.uploadCount} upload(s)` +
        (result.failed.length > 0 ? ` — ${result.failed.length} object(s) failed to delete` : ""),
      status: result.failed.length > 0 ? "error" : "success",
    });
    return Response.json({ success: true, ...result }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
