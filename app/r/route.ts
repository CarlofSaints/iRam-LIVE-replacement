import { NextRequest } from "next/server";
import { loadStoreReport, formatGeneratedAt, storeReportLogos } from "@/lib/storeReportLoad";
import { renderStoreReportPage } from "@/lib/storeReportPage";

// PUBLIC hosted action-list page — reps open this from the email link, so it is
// intentionally not behind the login. URL: /r?site=<code>&clientId=<id>&year=&month=&week=
// (Productionise with a signed token; for now it's reachable by query params.)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function intParam(v: string | null): number | undefined {
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? undefined : n;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const site = (u.searchParams.get("site") || "").trim();
  const clientId = u.searchParams.get("clientId") || undefined;
  if (!site) {
    return new Response("Missing 'site' parameter", { status: 400 });
  }

  try {
    const loaded = await loadStoreReport({
      siteCode: site,
      clientIds: clientId ? [clientId] : undefined,
      year: intParam(u.searchParams.get("year")),
      month: intParam(u.searchParams.get("month")),
      week: intParam(u.searchParams.get("week")),
    });

    const token = u.searchParams.get("t") || "";
    const day = u.searchParams.get("d") || "";
    const html = renderStoreReportPage(loaded.report, {
      periodLabel: loaded.periodLabel,
      generatedAt: formatGeneratedAt(),
      version: "iRam LIVE",
      reportId: `${site}-${loaded.year}-${loaded.month}-${loaded.week}`,
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
