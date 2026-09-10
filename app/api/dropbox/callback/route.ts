import { NextRequest } from "next/server";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { writeJson } from "@/lib/blob";
import { addLog } from "@/lib/activityLog";
import {
  hasAppCredentials, appKey, appSecret,
  DROPBOX_AUTH_KEY, resetDropboxTokenCache,
  type StoredDropboxAuth,
} from "@/lib/dropbox";

/* Step 2: Dropbox sends the user back here with a one-time code, and this
   trades it for the durable refresh token — server side, in the same second
   it was issued. That timing is the entire reason this route exists: done by
   hand the code expires while you are still copying it.

   The refresh token is stored in the app's own private blob and never
   rendered, never returned in a response and never logged. Nobody has to
   carry it between windows, so nobody can paste it somewhere it shouldn't be. */

function page(title: string, body: string, ok: boolean): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px">
       <div style="border:1px solid #E2E8F0;border-top:4px solid ${ok ? "#7CC042" : "#E04E2A"};border-radius:10px;padding:28px">
         <h1 style="margin:0 0 12px;font-size:20px;color:#2D3748">${title}</h1>
         <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4A5568">${body}</p>
         <a href="/control-centre/dropbox" style="display:inline-block;background:#7CC042;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Back to iRam LIVE</a>
       </div>
     </div>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "view_sql_pilot");

    const url = req.nextUrl;
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const denied = url.searchParams.get("error");

    if (denied) {
      /* Dropbox puts the useful half in error_description; the code alone
         ("access_denied") never says which scope or why. */
      const detail = url.searchParams.get("error_description") || denied;
      return page("Dropbox did not connect", `Dropbox said: <strong>${detail}</strong>`, false);
    }

    const expected = req.cookies.get("dropbox_oauth_state")?.value || "";
    if (!expected || !state || state !== expected) {
      return page(
        "That link did not come from here",
        "The one-time state did not match, so the code was not used. Start again from Connect Dropbox.",
        false,
      );
    }
    if (!code) return page("No code came back", "Dropbox returned no authorisation code. Try Connect again.", false);
    if (!hasAppCredentials()) {
      return page("Not configured", "DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set on this deployment.", false);
    }

    const redirectUri = new URL("/api/dropbox/callback", url.origin).toString();
    const res = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(appKey() + ":" + appSecret()).toString("base64"),
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      await addLog({
        userId: session.userId, userName: session.name,
        action: "dropbox_connect_failed",
        details: `Dropbox refused the authorisation code (${res.status}).`,
        status: "error",
      });
      return page(
        "Dropbox refused the code",
        `Dropbox replied <strong>${res.status}</strong>. If it says the code expired, just click Connect again — they only last a few minutes.`,
        false,
      );
    }

    const json = JSON.parse(text) as { refresh_token?: string; account_id?: string };
    if (!json.refresh_token) {
      /* Almost always means token_access_type=offline was missing, which
         yields a 4-hour token and an integration that dies this afternoon.
         Refuse it rather than store something that will silently stop. */
      return page(
        "No refresh token came back",
        "Dropbox returned a short-lived token only. The connect link must ask for offline access — this is a bug on our side, not yours.",
        false,
      );
    }

    const auth: StoredDropboxAuth = {
      refreshToken: json.refresh_token,
      connectedAt: new Date().toISOString(),
      connectedBy: session.name,
      account: json.account_id || "",
    };
    await writeJson(DROPBOX_AUTH_KEY, auth);
    resetDropboxTokenCache();

    /* Who connected it is worth recording precisely because Dropbox cannot
       tell us — the credentials are shared, so every action there looks like
       the same person. */
    await addLog({
      userId: session.userId, userName: session.name,
      action: "dropbox_connected",
      details: `Connected the Dropbox account used for the control files.`,
      status: "success",
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/control-centre/dropbox?dropbox=connected",
        // Burn the state cookie so the same link cannot be replayed.
        "Set-Cookie": "dropbox_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
