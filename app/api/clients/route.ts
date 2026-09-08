import { NextRequest } from "next/server";
import { getClients, createClient } from "@/lib/clientData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import { getIramLiveClientNames, canonicalClientName } from "@/lib/sqlClientNames";

export async function GET(req: NextRequest) {
  try {
    const session = requireLogin(req);
    let clients = await getClients();
    // Client-scoped users only ever see their assigned clients.
    if (session.clientIds && session.clientIds.length > 0) {
      const allowed = new Set(session.clientIds);
      clients = clients.filter((c) => allowed.has(c.id));
    }
    // Archived clients are hidden by DEFAULT, so any caller that doesn't think
    // about it gets the operational list (upload targets, dashboard…). The
    // read-only surfaces that must still reach retained data — Reports, Charts,
    // Activity Log, the Clients page itself — opt in with ?scope=all.
    const scope = new URL(req.url).searchParams.get("scope");
    if (scope === "archived") clients = clients.filter((c) => !c.active);
    else if (scope !== "all") clients = clients.filter((c) => c.active);

    return Response.json(clients, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_clients");
    const data = await req.json();

    /* The name must be one SQL Server holds for iRam LIVE. The picker on the
       Clients page only offers those, but a picker is a convenience, not a
       rule — this endpoint is reachable without it, and the rule has to live
       where the write happens.

       A name that cannot be checked is refused rather than allowed through:
       "the proxy is down" must not become "anything goes for the next hour".
       The message says which of the two happened, because the fix differs. */
    const requested = String(data?.name ?? "").trim();
    if (!requested) {
      return Response.json({ error: "A client name is required." }, { status: 400, headers: noCacheHeaders() });
    }
    const allowed = await getIramLiveClientNames();
    if (allowed.error || allowed.names.length === 0) {
      return Response.json(
        {
          error:
            "The client list could not be read from SQL Server, so a new client cannot be created right now. " +
            (allowed.error ?? "The stored procedure returned no names."),
          sqlUnavailable: true,
        },
        { status: 503, headers: noCacheHeaders() },
      );
    }
    const canonical = canonicalClientName(requested, allowed.names);
    if (!canonical) {
      await addLog({
        userId: session.userId, userName: session.name, action: "create_client_refused",
        details: `"${requested}" is not on the iRam LIVE client list in SQL Server (${allowed.names.length} names)`,
        status: "error",
      });
      return Response.json(
        {
          error:
            `"${requested}" is not on the iRam LIVE client list in SQL Server. ` +
            "Pick a name from the list, or use Email OJ to have this client added at the source.",
          notOnList: true,
        },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    /* Store SQL's own spelling, and record it as the SQL name at the same
       time: the name was chosen FROM that list, so the mapping the SQL Direct
       pilot needs is known here and never has to be guessed later. */
    const client = await createClient({ ...data, name: canonical, sqlClientName: canonical });
    await addLog({ userId: session.userId, userName: session.name, action: "create_client", details: `Created client ${client.name}`, status: "success" });
    return Response.json(client, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
