import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { refuseIfManualLoad } from "@/lib/dropboxControlFiles";
import { isDropboxConnected, dropboxRoot } from "@/lib/dropbox";
import { resolveClientFolder, listControlFiles, sqlSourceForKind } from "@/lib/dropboxControlFiles";

/* The control files one client has in Dropbox.

   Read-only. The rev of each file comes back with it, because that is what a
   later save has to quote to prove it is replacing the version that was
   downloaded rather than flattening someone else's edit. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_control_files");

    const clientId = req.nextUrl.searchParams.get("clientId") || "";
    if (!clientId) {
      return Response.json({ error: "clientId is required." }, { status: 400, headers: noCacheHeaders() });
    }
    if (!(await isDropboxConnected())) {
      return Response.json(
        { error: "Dropbox is not connected on this deployment." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const client = await getClientById(clientId);
    if (!client) {
      return Response.json({ error: "No such client." }, { status: 404, headers: noCacheHeaders() });
    }
    const manual = refuseIfManualLoad(client);
    if (manual) return manual;

    /* An explicit folder set on the client wins; otherwise fall back to
       matching the SQL name and then the iRam name. */
    const folder = await resolveClientFolder(client);
    if (!folder || folder.error) {
      return Response.json(
        {
          clientName: client.name,
          sqlClientName: client.sqlClientName || null,
          folder: null,
          files: [],
          /* Not configured yet is a DIFFERENT thing from configured-and-broken,
             and the tab offers a different next step for each. */
          needsSetup: !folder,
          error:
            folder?.error ??
            `No Dropbox folder is set for "${client.name}", and no folder under ${dropboxRoot()} ` +
              `is named "${client.name}"` +
              (client.sqlClientName ? ` or "${client.sqlClientName}"` : "") +
              `. Set the folder below — a client's Dropbox folder is often named neither of those.`,
        },
        { headers: noCacheHeaders() },
      );
    }

    const files = (await listControlFiles(folder.path, client.dropboxFiles)).map((f) => ({
      ...f,
      /* Whether an edit to this file can be confirmed against SQL at all.
         Ranging has no stored procedure, so saying so up front beats a
         progress bar that never finishes. */
      verifiable: sqlSourceForKind(f.kind) !== null,
    }));

    return Response.json(
      {
        clientName: client.name,
        sqlClientName: client.sqlClientName || null,
        folder: folder.path,
        matchedFolderName: folder.matched,
        files,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
