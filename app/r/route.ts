import { NextRequest } from "next/server";
import { loadStoreReport, formatGeneratedAt, storeReportLogos } from "@/lib/storeReportLoad";
import { renderStoreReportPage } from "@/lib/storeReportPage";
import { verifyReportLink, legacyLinksAllowed, ReportLinkPayload } from "@/lib/reportLink";

// PUBLIC hosted action-list page — reps open this from the email link, so it is
// intentionally not behind a login (any rep may view any store's report). The
// link is a SIGNED, self-expiring token (?r=<token>) so the address can't be
// guessed or tweaked (change the site code → signature fails). Legacy plain-param
// links (?site=…) are honoured during a grace window (see legacyLinksAllowed).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function intParam(v: string | null): number | undefined {
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? undefined : n;
}

function expiredPage(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#f4f5f7;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;max-width:420px;width:100%;
    padding:36px 28px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .badge{width:56px;height:56px;border-radius:50%;background:#eef2ff;color:#1e3a8a;display:flex;
    align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px}
  h1{font-size:19px;margin:0 0 10px}
  p{font-size:14px;line-height:1.55;color:#4b5563;margin:0}
</style></head><body><div class="card">
  <div class="badge">⏳</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);

  // Resolve the report target from either the signed token or (legacy) plain params.
  let target: ReportLinkPayload | null = null;
  const rToken = u.searchParams.get("r");

  if (rToken) {
    const res = verifyReportLink(rToken);
    if (!res.ok) {
      if (res.reason === "expired") {
        return expiredPage(
          "This report link has expired",
          "Store-report links are valid for a limited time. Please check in at the store again to receive a fresh report.",
          410,
        );
      }
      return expiredPage(
        "This report link isn't valid",
        "The link may be incomplete or has been altered. Please open the report from your original email.",
        400,
      );
    }
    target = res.payload;
  } else if (u.searchParams.get("site")) {
    // Legacy plain-param link (already-sent emails). Honoured during the grace window.
    if (!legacyLinksAllowed()) {
      return expiredPage(
        "This report link has expired",
        "Store-report links are valid for a limited time. Please check in at the store again to receive a fresh report.",
        410,
      );
    }
    target = {
      site: (u.searchParams.get("site") || "").trim(),
      clientId: u.searchParams.get("clientId") || undefined,
      year: intParam(u.searchParams.get("year")),
      month: intParam(u.searchParams.get("month")),
      week: intParam(u.searchParams.get("week")),
    };
  }

  if (!target || !target.site) {
    return new Response("Missing 'site' parameter", { status: 400 });
  }

  try {
    const loaded = await loadStoreReport({
      siteCode: target.site,
      clientIds: target.clientId ? [target.clientId] : undefined,
      year: target.year,
      month: target.month,
      week: target.week,
    });

    const token = u.searchParams.get("t") || "";
    const day = u.searchParams.get("d") || "";
    const html = renderStoreReportPage(loaded.report, {
      periodLabel: loaded.periodLabel,
      generatedAt: formatGeneratedAt(),
      version: "iRam LIVE",
      reportId: `${target.site}-${loaded.year}-${loaded.month}-${loaded.week}`,
      ...storeReportLogos(u.origin, loaded.report.subChannel),
      ...(token && day ? { track: { url: `${u.origin}/api/store-reports/track`, token, day } } : {}),
    });

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("store-report view failed", err);
    return new Response("Could not build the store report. Please try again later.", { status: 500 });
  }
}
