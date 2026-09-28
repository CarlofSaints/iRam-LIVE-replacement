import { NextRequest } from "next/server";
import { requirePermission, requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getPerigeeFeedViews, getPerigeeFeedsWithTokens, upsertPerigeeFeed, removePerigeeFeed } from "@/lib/perigeeFeeds";
import { fetchPerigeeVisits, normalisePerigeeApiVisit, describeFeedError, PERIGEE_VISITS_URL } from "@/lib/perigeeApi";
import { getClientById } from "@/lib/clientData";
import { trackingDay } from "@/lib/storeReportTracking";
import { addLog } from "@/lib/activityLog";

/* Per-client Perigee feeds (store reports). Reading is for anyone who manages
   store reports and never returns a token, only its last four characters.
   Changing a feed is super-admin only, the same as the Auto-send settings: a
   token decides whose check-ins reach the poller.

   ⚠️ The session cookie is unsigned app-wide (see memory: iram-live-public-repo-
   unsigned-auth), so "super admin" here is only as strong as that. Hence the
   Test of a SAVED token returns counts only, never rep names or emails: those
   are only shown when the caller pastes the token themselves, i.e. already
   holds it.

   POST body: { action: "save", clientId, token?, enabled? }
            | { action: "remove", clientId }
            | { action: "test", clientId, token? }   (token = try one before saving) */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const feeds = await getPerigeeFeedViews();
    return Response.json({ feeds, endpoint: PERIGEE_VISITS_URL }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireRole(req, "super_admin");
    const body = (await req.json().catch(() => ({}))) as {
      action?: string; clientId?: string; token?: string; enabled?: boolean;
    };
    const clientId = String(body.clientId ?? "").trim();
    const client = clientId ? await getClientById(clientId) : null;
    if (!client) return Response.json({ error: "Pick a client" }, { status: 400, headers: noCacheHeaders() });
    const pasted = typeof body.token === "string" ? body.token.trim() : "";

    if (body.action === "test") {
      let useToken = pasted;
      if (!useToken) {
        const saved = (await getPerigeeFeedsWithTokens()).find((f) => f.clientId === clientId);
        if (saved && !saved.token) return Response.json({ ok: false, error: `Stored token unreadable (${saved.decryptError}): paste it again` }, { headers: noCacheHeaders() });
        useToken = saved?.token ?? "";
      }
      if (!useToken) return Response.json({ error: "No token to test" }, { status: 400, headers: noCacheHeaders() });
      const day = trackingDay();
      try {
        const r = await fetchPerigeeVisits(useToken, day, day, { deadline: Date.now() + 45_000 });
        const visits = r.rows.map(normalisePerigeeApiVisit);
        const detail = pasted
          ? {
              // Enough to judge a NEW token: which reps, and whether the fields
              // we rely on came through. No other visit data.
              reps: [...new Set(visits.map((v) => v.repEmail || v.repName).filter(Boolean))].slice(0, 20),
              fieldNames: r.rows[0] ? Object.keys(r.rows[0]).slice(0, 40) : [],
            }
          : {};
        return Response.json({
          ok: true, day, visits: r.rows.length, pages: r.pagesFetched, complete: r.complete, stoppedReason: r.stoppedReason,
          withSiteCode: visits.filter((v) => v.siteCode).length,
          withEmail: visits.filter((v) => v.repEmail).length,
          ...detail,
        }, { headers: noCacheHeaders() });
      } catch (e) {
        return Response.json({ ok: false, error: describeFeedError(e) }, { headers: noCacheHeaders() });
      }
    }

    if (body.action === "remove") {
      const removed = await removePerigeeFeed(clientId);
      await addLog({ userId: session.userId, userName: session.name, action: "perigee_feed_remove", details: `Removed the Perigee feed for ${client.name}`, status: "success" });
      return Response.json({ ok: true, removed }, { headers: noCacheHeaders() });
    }

    if (body.action === "save") {
      const feed = await upsertPerigeeFeed(
        clientId,
        { token: pasted || undefined, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined },
        session.name || session.email,
      );
      // Never the token itself, only whether it changed and how it ends.
      const what = [
        pasted ? `token set (ends …${feed.tokenEnding})` : "",
        typeof body.enabled === "boolean" ? (body.enabled ? "switched ON" : "switched OFF") : "",
      ].filter(Boolean).join(", ");
      await addLog({ userId: session.userId, userName: session.name, action: "perigee_feed_save", details: `Perigee feed for ${client.name}: ${what || "saved"}`, status: "success" });
      return Response.json({ ok: true, feed }, { headers: noCacheHeaders() });
    }

    return Response.json({ error: "Unknown action" }, { status: 400, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
