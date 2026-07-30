import { NextRequest } from "next/server";
import { setClientArchived, getClientById } from "@/lib/clientData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

// POST { archived: boolean } — archive or restore a client.
// Archiving keeps every byte of data; it only removes the client from the
// operational flows (see getActiveClients in lib/clientData.ts).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const { id } = await params;
    const { archived } = await req.json();
    if (typeof archived !== "boolean") {
      return Response.json({ error: "archived must be true or false" }, { status: 400, headers: noCacheHeaders() });
    }
    const existing = await getClientById(id);
    if (!existing) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    const client = await setClientArchived(id, archived, session.name);
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: archived ? "archive_client" : "restore_client",
      details: `${archived ? "Archived" : "Restored"} client ${client.name}`,
      status: "success",
    });
    return Response.json(client, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
