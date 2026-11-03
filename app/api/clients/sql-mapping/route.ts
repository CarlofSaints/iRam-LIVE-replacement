import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients, setSqlClientNames } from "@/lib/clientData";
import { getIramLiveClientNames, canonicalClientName } from "@/lib/sqlClientNames";
import { buildMappingRows } from "@/lib/sqlClientMapping";
import { addLog } from "@/lib/activityLog";

/* The SQL Name mapping screen: every iRam client beside the SQL Server client
   it is, with a suggested match. Same permission as editing a client, because
   that is all this is — the sqlClientName field, for many clients at once. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const [list, clients] = await Promise.all([getIramLiveClientNames(), getClients()]);
    return Response.json(
      {
        configured: list.configured,
        error: list.error,
        names: list.names,
        entries: list.entries,
        rows: buildMappingRows(clients, list.entries),
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

/* Body: { changes: [{ id, sqlClientName: string | null }] }. null clears.
   Every name must be on SQL's list, and SQL's own spelling is what is stored,
   because that exact string is what the stored procedures return. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const body = await req.json().catch(() => null);
    const raw: unknown[] = Array.isArray(body?.changes) ? body.changes : [];
    if (raw.length === 0) {
      return Response.json({ error: "No changes sent." }, { status: 400, headers: noCacheHeaders() });
    }

    const list = await getIramLiveClientNames();
    if (list.error || list.names.length === 0) {
      // Never save a mapping that cannot be checked against the list.
      return Response.json(
        { error: `The SQL Server client list could not be read, so nothing was saved. ${list.error ?? ""}`.trim() },
        { status: 503, headers: noCacheHeaders() },
      );
    }

    const clients = await getClients();
    const changes: { id: string; sqlClientName: string | null }[] = [];
    const refused: string[] = [];
    for (const item of raw) {
      const id = typeof (item as { id?: unknown })?.id === "string" ? (item as { id: string }).id : "";
      const want = (item as { sqlClientName?: unknown })?.sqlClientName;
      const client = clients.find((c) => c.id === id);
      if (!client) { refused.push(`unknown client id "${id}"`); continue; }
      if (want == null || (typeof want === "string" && want.trim() === "")) {
        changes.push({ id, sqlClientName: null });
        continue;
      }
      const canonical = typeof want === "string" ? canonicalClientName(want, list.names) : null;
      if (!canonical) { refused.push(`${client.name}: "${String(want)}" is not on the SQL Server client list`); continue; }
      changes.push({ id, sqlClientName: canonical });
    }

    // All or nothing: a half-saved screen is harder to reason about than a refused one.
    if (refused.length > 0) {
      return Response.json(
        { error: `Nothing was saved. ${refused.join("; ")}.`, refused },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const before = new Map(clients.map((c) => [c.id, c.sqlClientName ?? null]));
    const saved = await setSqlClientNames(changes);
    const summary = saved
      .map((c) => `${c.name}: ${before.get(c.id) ?? "(none)"} → ${c.sqlClientName ?? "(none)"}`)
      .join("; ");
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "update_sql_client_names",
      details: `Set the SQL Name for ${saved.length} client(s). ${summary}`,
      status: "success",
    });

    return Response.json({ success: true, saved: saved.length }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
