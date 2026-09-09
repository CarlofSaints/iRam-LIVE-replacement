import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { probeDropbox, dropboxRoot, listFolder } from "@/lib/dropbox";

/* Is Dropbox actually wired on THIS deployment?

   The credentials are Sensitive env vars, which read back blank from the
   Vercel CLI, so a deployed probe is the only thing that can answer it — a
   variable being set is not the same as the feature working, and the refresh
   token is the half that can be revoked or minted wrong without anything
   locally looking different.

   Read-only: lists, never writes. Super-admin only while this is being built.
*/
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_sql_pilot");

    const result = await probeDropbox();

    /* A working connection with an empty or wrong root is the failure that
       looks like success, so name what is actually in the folder rather than
       reporting a bare count. */
    let sample: { name: string; size: number; modified: string }[] = [];
    if (result.ok && dropboxRoot()) {
      sample = (await listFolder(dropboxRoot()).catch(() => []))
        .slice(0, 25)
        .map((e) => ({
          name: e.isFolder ? `${e.name}/` : e.name,
          size: e.size,
          modified: e.modified,
        }));
    }

    return Response.json({ ...result, sample }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
