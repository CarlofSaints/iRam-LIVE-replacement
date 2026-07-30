import { NextRequest } from "next/server";
import { runLoadStatus } from "@/lib/loadStatus";

// Weekday 16:00 SAST DISPO load-status email (scheduled in vercel.json as
// "0 14 * * 1-5" — Vercel crons run in UTC and SAST is UTC+2 year-round).
// CRON_SECRET-guarded like the other crons.
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
    const result = await runLoadStatus({ send: true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("load-status cron failed", err);
    const msg = err instanceof Error ? err.message : "load status failed";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
