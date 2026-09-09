import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { probeDropbox, dropboxRoot, dropboxRootRaw, listFolder, getStoredAuth, usesTeamSpace } from "@/lib/dropbox";

/* Is Dropbox actually wired on THIS deployment?

   The credentials are Sensitive env vars, which read back blank from the
   Vercel CLI, so a deployed probe is the only thing that can answer it — a
   variable being set is not the same as the feature working.

   When the configured folder cannot be listed this also lists the account's
   TOP LEVEL and reports the path it actually tried. A working connection
   pointed at a folder that does not exist is the failure that otherwise looks
   like a broken integration, and the fix is usually just the exact spelling.

   Read-only: lists, never writes. Super-admin only. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_sql_pilot");

    const configuredRoot = dropboxRoot();
    const result = await probeDropbox();
    const stored = await getStoredAuth();

    const base = {
      ...result,
      configuredRoot: dropboxRootRaw() || "(DROPBOX_CONTROL_ROOT is not set)",
      resolvedPath: configuredRoot || "(none)",
      teamSpace: await usesTeamSpace().catch(() => null),
      connectedBy: stored?.connectedBy ?? null,
      connectedAt: stored?.connectedAt ?? null,
      tokenSource: process.env.DROPBOX_REFRESH_TOKEN ? "env var" : stored ? "Connect button" : "none",
    };

    if (result.ok) {
      const sample = (await listFolder(configuredRoot).catch(() => []))
        .slice(0, 40)
        .map((e) => ({ name: e.isFolder ? `${e.name}/` : e.name, size: e.size, modified: e.modified }));
      return Response.json({ ...base, sample }, { headers: noCacheHeaders() });
    }

    /* The connection itself may be fine and only the path wrong, so show what
       IS there rather than leaving someone guessing at the spelling. */
    let topLevel: string[] | null = null;
    let topLevelError: string | null = null;
    try {
      topLevel = (await listFolder("")).slice(0, 60).map((e) => (e.isFolder ? `${e.name}/` : e.name));
    } catch (e) {
      topLevelError = e instanceof Error ? e.message : String(e);
    }

    return Response.json(
      {
        ...base,
        hint:
          topLevel && topLevel.length
            ? "The account is reachable, so the connection is fine — DROPBOX_CONTROL_ROOT does not match a real folder. Pick from the top level below and use the exact spelling, with a leading slash."
            : "Could not list the account at all — this is not just a wrong path.",
        topLevel,
        topLevelError,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
