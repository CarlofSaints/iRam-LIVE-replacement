import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getIramLiveClientNames } from "@/lib/sqlClientNames";
import { getClients } from "@/lib/clientData";

/* The client names a new client can be created under, read live from SQL
   Server. Feeds the picker on the Clients page, which replaced the free-text
   name box.

   It also says which of those names iRam ALREADY has a client for, so the
   picker can show them as taken rather than letting someone create a second
   copy of a client that is already there under the same name.

   Read-only: one parameterless stored procedure plus this app's own client
   list. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");

    const [list, clients] = await Promise.all([
      getIramLiveClientNames(),
      getClients().catch(() => []),
    ]);

    return Response.json(
      {
        ...list,
        // Every name already in use here, active or archived — an archived
        // client still owns its name, and re-adding it would split its data.
        taken: clients.map((c) => ({ name: c.name, id: c.id, active: c.active })),
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
