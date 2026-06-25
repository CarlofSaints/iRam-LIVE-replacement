import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getSendsForPeriod } from "@/lib/storeReportLog";

export const dynamic = "force-dynamic";

// Per-week store-report send log — powers the "Sends" view (who received what,
// what failed, what was skipped). Read-only for now; sends are written by the
// trigger/render pipeline (built once the report format + Perigee trigger land).
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const periodKey = new URL(req.url).searchParams.get("periodKey");
    if (!periodKey) {
      return Response.json({ error: "periodKey is required" }, { status: 400, headers: noCacheHeaders() });
    }
    const sends = await getSendsForPeriod(periodKey);
    return Response.json({ sends }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
