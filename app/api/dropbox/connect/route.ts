import { NextRequest } from "next/server";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { hasAppCredentials, appKey } from "@/lib/dropbox";
import { randomUUID } from "crypto";

/* Step 1 of connecting Dropbox: send the user to Dropbox to approve.

   This exists because the alternative is an OAuth exchange run by hand in a
   terminal, copying an authorisation code between two windows inside the few
   minutes before it expires. That is a genuinely nasty thing to ask of
   someone, and it failed repeatedly in practice. A button does the same job
   and cannot mistype anything.

   token_access_type=offline is the whole point — without it Dropbox returns
   only a 4-hour access token and the integration dies the same afternoon. */
export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "view_sql_pilot");

    if (!hasAppCredentials()) {
      return Response.json(
        {
          error:
            "DROPBOX_APP_KEY and DROPBOX_APP_SECRET are not set on this deployment. " +
            "Add them in Vercel and redeploy, then click Connect again.",
        },
        { status: 400 },
      );
    }

    const redirectUri = new URL("/api/dropbox/callback", req.nextUrl.origin).toString();

    /* A random state, echoed back by Dropbox and checked in the callback, so
       a code cannot be planted by anything that did not start here. Held in a
       short-lived httpOnly cookie rather than in memory, because the callback
       is a different request and may land on a different instance. */
    const state = randomUUID();

    const authorize = new URL("https://www.dropbox.com/oauth2/authorize");
    authorize.searchParams.set("client_id", appKey());
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("token_access_type", "offline");
    authorize.searchParams.set("state", state);
    // Ask every time, so re-connecting a different account actually works
    // instead of silently handing back the account already approved.
    authorize.searchParams.set("force_reapprove", "false");

    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize.toString(),
        "Set-Cookie":
          `dropbox_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=900`,
        "Cache-Control": "no-store",
        // Recorded so the activity log can say who connected the account —
        // Dropbox itself cannot tell us, the credentials are shared.
        "X-Initiated-By": session.name,
      },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
