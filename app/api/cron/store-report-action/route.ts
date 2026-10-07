import { NextRequest } from "next/server";
import { runActionReport } from "@/lib/storeReportActionDigest";

// Weekly rep action report (scheduled in vercel.json — Monday 07:00 SAST).
// Covers the trailing 7 days of claims and emails managers/CAMs the spreadsheet.
// CRON_SECRET-guarded like the other crons.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  {
    // No CRON_SECRET in production = refuse, never "anyone may trigger".
    const auth = req.headers.get("authorization") || "";
    if (secret ? auth !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await runActionReport({ send: true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("weekly action report failed", err);
    const msg = err instanceof Error ? err.message : "action report failed";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
