import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getIramLiveClientNames, looksLikeSameClient, normaliseClientName } from "@/lib/sqlClientNames";
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

    /* Which iRam client, if any, each SQL name already belongs to.

       "taken" is certainty: the same string, or a client explicitly mapped to
       that SQL name. "likely" is a guess, and it is the common case here —
       SQL says "BISCO", iRam holds "BISCO PLUS". Only 1 of the 19 names the SP
       returns matches an iRam client by string, so without the guess almost
       every existing client would look brand new in the picker. */
    const norm = (s: string) => normaliseClientName(s);
    const match = list.names.map((sqlName) => {
      const exact = clients.filter(
        (c) => norm(c.name) === norm(sqlName) ||
          (c.sqlClientName ? norm(c.sqlClientName) === norm(sqlName) : false),
      );
      const likely = exact.length === 0
        ? clients.filter((c) => looksLikeSameClient(c.name, sqlName))
        : [];
      return {
        sqlName,
        taken: exact.map((c) => ({ name: c.name, id: c.id, active: c.active })),
        likely: likely.map((c) => ({ name: c.name, id: c.id, active: c.active })),
      };
    });

    return Response.json(
      {
        ...list,
        match,
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
