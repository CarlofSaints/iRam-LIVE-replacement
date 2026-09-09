import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { getTemporaryDownloadLink } from "@/lib/dropbox";
import { findClientFolder, findControlFile } from "@/lib/dropboxControlFiles";
import { addLog } from "@/lib/activityLog";

/* A direct Dropbox download URL for one control file.

   The bytes go browser-to-Dropbox: routing a 20MB workbook through a
   serverless function is not something that fails cleanly, and Range
   Management files are that size.

   The path is not taken on trust — it is resolved against the client's own
   folder listing first, so a hand-edited path cannot reach another client's
   files or anywhere else in the Dropbox.

   The rev comes back with the link. Whoever downloads has to hand it back to
   save, which is what makes the save a replace of THIS version. */
export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_control_files");

    const clientId = req.nextUrl.searchParams.get("clientId") || "";
    const path = req.nextUrl.searchParams.get("path") || "";
    if (!clientId || !path) {
      return Response.json({ error: "clientId and path are required." }, { status: 400, headers: noCacheHeaders() });
    }

    const client = await getClientById(clientId);
    if (!client) return Response.json({ error: "No such client." }, { status: 404, headers: noCacheHeaders() });

    const folder = await findClientFolder([client.sqlClientName || "", client.name]);
    if (!folder) {
      return Response.json({ error: "No Dropbox folder for this client." }, { status: 404, headers: noCacheHeaders() });
    }

    const file = await findControlFile(folder.path, path);
    if (!file) {
      return Response.json(
        { error: "That file is not in this client's Dropbox folder." },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    const { url, entry } = await getTemporaryDownloadLink(file.path);

    /* Dropbox sees one shared account, so it cannot say who took a copy.
       This log is the only place that knows. */
    await addLog({
      userId: session.userId, userName: session.name,
      action: "dropbox_file_downloaded",
      details: `Downloaded "${file.name}" for ${client.name} from Dropbox (rev ${entry.rev}).`,
      status: "success",
    });

    return Response.json(
      { url, name: file.name, rev: entry.rev, size: entry.size, path: file.path },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
