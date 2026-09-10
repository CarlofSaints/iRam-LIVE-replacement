import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { refuseIfManualLoad } from "@/lib/dropboxControlFiles";
import { isDropboxConnected, dropboxRoot } from "@/lib/dropbox";
import { findClientFolder, listControlFiles, sqlSourceForKind } from "@/lib/dropboxControlFiles";

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

    /* SQL name first: the Dropbox folders are named the way SQL names things,
       not the way iRam's client records do. */
    const folder = await findClientFolder([client.sqlClientName || "", client.name]);
    if (!folder) {
      return Response.json(
        {
          clientName: client.name,
          sqlClientName: client.sqlClientName || null,
          folder: null,
          files: [],
          error:
            `No Dropbox folder found for "${client.name}"` +
            (client.sqlClientName ? ` or "${client.sqlClientName}"` : "") +
            `. Folders are matched on the exact name under ${dropboxRoot()}.`,
        },
        { headers: noCacheHeaders() },
      );
    }

    const files = (await listControlFiles(folder.path)).map((f) => ({
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
