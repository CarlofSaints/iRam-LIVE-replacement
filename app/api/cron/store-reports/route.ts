import { NextRequest } from "next/server";
import { runStoreReportSync } from "@/lib/storeReportRunner";

// Vercel Cron entry point (scheduled in vercel.json). Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set; we require it
// so the endpoint can't be triggered by the public.
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
    const result = await runStoreReportSync({ origin: req.nextUrl.origin });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("store-report cron failed", err);
    const msg = err instanceof Error ? err.message : "cron failed";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
