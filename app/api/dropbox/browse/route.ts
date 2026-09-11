import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { listFolder, dropboxRoot, normalizeDropboxPath, isDropboxConnected } from "@/lib/dropbox";

/* List one Dropbox folder so the per-client setup can be CHOSEN, not typed.

   Every way this app has tried to find a client's folder by name has failed,
   because a client is called three different things — the iRam record, the
   SQL name, and whatever the folder in Dropbox is actually called. This is
   what replaces the guessing: show what is really there and let someone point
   at it once.

   Read-only. Takes a path, lists it, returns folders and .xlsx files. `path`
   is normalised, so pasting the address bar out of the Dropbox web UI works —
   that is how people actually get a folder path. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_control_files");

    if (!(await isDropboxConnected())) {
      return Response.json(
        { error: "Dropbox is not connected. Control Centre → Dropbox." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const raw = req.nextUrl.searchParams.get("path") || "";
    /* No path means the control root — the sensible place to start looking,
       and the folder every client's folder sits under. */
    const path = raw.trim() ? normalizeDropboxPath(raw) : dropboxRoot();
    if (!path) {
      return Response.json(
        { error: "DROPBOX_CONTROL_ROOT is not set on this deployment." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    let entries;
    try {
      entries = await listFolder(path);
    } catch (e) {
      /* A path that does not exist is the single most likely thing to go
         wrong here, and it must read as "that folder isn't there" rather than
         as a broken integration. */
      return Response.json(
        {
          path,
          error:
            `Could not open "${path}". Check the folder still exists and the path is right — ` +
            `pasting the address from the Dropbox website works. ` +
            (e instanceof Error ? e.message : ""),
          folders: [],
          files: [],
        },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    const folders = entries
      .filter((e) => e.isFolder)
      .map((e) => ({ name: e.name, path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name));

    /* Only spreadsheets: a control file is always one, and offering the rest
       just makes the wrong choice easier to click. */
    const files = entries
      .filter((e) => !e.isFolder && /\.xlsx?$/i.test(e.name))
      .map((e) => ({ name: e.name, path: e.path, size: e.size, modified: e.modified }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json(
      { path, root: dropboxRoot(), folders, files },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
