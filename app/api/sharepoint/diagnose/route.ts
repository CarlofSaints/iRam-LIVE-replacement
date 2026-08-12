import { NextRequest } from "next/server";
import { requireRole, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { probeSharePoint } from "@/lib/sharepoint";

/**
 * Does the app's SharePoint access actually work, and what can it see?
 *
 * The three Graph credentials are marked Sensitive in Vercel, so they read back
 * blank from `vercel env pull` and from every local test — "set" is not "valid".
 * This is the only place that can answer it, and it also lists the document
 * libraries so the right root folder URL can be found rather than guessed.
 *
 *   GET /api/sharepoint/diagnose
 *   GET /api/sharepoint/diagnose?folder=<a SharePoint folder URL>
 *
 * Super admin only — it reveals tenant structure. Returns no secret values.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireRole(req, "super_admin");
    const folder = req.nextUrl.searchParams.get("folder") ?? undefined;
    return Response.json(await probeSharePoint(folder), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
