import { NextRequest } from "next/server";
import { requirePermission, requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getTrackingDay, summariseByChannel, isOpened, isUsed, trackingDay } from "@/lib/storeReportTracking";
import { runStoreReportDigest } from "@/lib/storeReportDigest";
import { reportBaseUrl } from "@/lib/storeReportLoad";
import { addLog } from "@/lib/activityLog";

// Engagement detail log + per-channel summary for a day. The separate logging
// file the team can browse to see who's using reports vs ignoring them.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const day = new URL(req.url).searchParams.get("day") || trackingDay();
    const records = await getTrackingDay(day);

    // Link to the actual report each rep was sent. We deliberately OMIT the
    // tracking token (t/d) so a manager opening it from the grid doesn't inflate
    // that rep's open/used stats. Period params pin the exact report when known
    // (older records without them fall back to the site's latest period).
    const base = reportBaseUrl(req.nextUrl.origin);
    const buildReportUrl = (r: (typeof records)[number]): string => {
      const p = new URLSearchParams({ site: r.siteCode });
      if (r.year != null) p.set("year", String(r.year));
      if (r.month != null) p.set("month", String(r.month));
      if (r.week != null) p.set("week", String(r.week));
      return `${base}/r?${p.toString()}`;
    };

    const detail = records.map((r) => ({
      store: r.store || r.siteCode,
      siteCode: r.siteCode,
      channel: r.channel,
      repName: r.repName,
      repEmail: r.repEmail,
      sentAt: r.sentAt,
      opened: isOpened(r),
      used: isUsed(r),
      opens: r.opens,
      pageViews: r.pageViews,
      cardClicks: r.cardClicks,
      distinctCards: r.distinctCards,
      firstOpenAt: r.firstOpenAt,
      reportUrl: buildReportUrl(r),
      test: !!r.test,
    }));
    // Most recently active first.
    detail.sort((a, b) => (b.firstOpenAt || b.sentAt).localeCompare(a.firstOpenAt || a.sentAt));

    const summary = summariseByChannel(records);
    const totalSent = records.filter((r) => !r.test).length;

    return Response.json({ day, summary, totalSent, detail }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

// Manually send (or preview) the digest. super-admin only.
export async function POST(req: NextRequest) {
  try {
    const session = requireRole(req, "super_admin");
    const body = (await req.json().catch(() => ({}))) as { day?: string; send?: boolean };
    const result = await runStoreReportDigest({ day: body.day, send: body.send !== false });
    addLog({
      userId: session.userId, userName: session.name,
      action: body.send === false ? "Previewed store-report digest" : "Sent store-report digest",
      details: `day=${result.day} total=${result.totalSent} recipients=${result.recipients.length} emailed=${result.emailed}`,
      status: "success",
    }).catch(() => {});
    return Response.json(result, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
