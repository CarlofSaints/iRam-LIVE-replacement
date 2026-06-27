import { NextRequest } from "next/server";
import { runStoreReportDigest } from "@/lib/storeReportDigest";

// Daily manager digest (scheduled in vercel.json, ~end of working day SAST).
// CRON_SECRET-guarded like the poller.
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
    const result = await runStoreReportDigest({ send: true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("store-report digest failed", err);
    const msg = err instanceof Error ? err.message : "digest failed";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
