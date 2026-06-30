import { NextRequest } from "next/server";
import { runStoreReportDigest } from "@/lib/storeReportDigest";
import { trackingDay } from "@/lib/storeReportTracking";

// Daily manager digest (scheduled in vercel.json — runs each MORNING SAST and
// reports on the PREVIOUS day's engagement). CRON_SECRET-guarded like the poller.
// An optional ?day=YYYY-MM-DD overrides the target day (for manual re-runs).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    // Default to YESTERDAY (SAST): a morning run summarises the full previous
    // working day, once every check-in for that day has been logged.
    const override = new URL(req.url).searchParams.get("day");
    const day = override || trackingDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const result = await runStoreReportDigest({ day, send: true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("store-report digest failed", err);
    const msg = err instanceof Error ? err.message : "digest failed";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
