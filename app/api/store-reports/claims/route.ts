import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClaims } from "@/lib/storeReportClaims";
import { trackingDay } from "@/lib/storeReportTracking";

// Inspect captured action claims for a send-day (defaults to today, SAST).
// GET /api/store-reports/claims?day=YYYY-MM-DD  — manage_store_reports.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const day = req.nextUrl.searchParams.get("day") || trackingDay();
    const claims = await getClaims(day);
    // Newest first, active claims surfaced.
    claims.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const active = claims.filter((c) => c.active);
    return Response.json(
      { day, total: claims.length, active: active.length, claims },
      { headers: noCacheHeaders() },
    );
  } catch (e) {
    return handleAuthError(e);
  }
}
