import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getAuditForDay } from "@/lib/storeReportAudit";
import { trackingDay } from "@/lib/storeReportTracking";

// Read-only diagnostic: dump every store-report send OUTCOME for a day — sent
// plus every skip reason (no-email, channel, duplicate, no-mapping, no-data) and
// failures — so "why didn't rep X get their report?" is answerable in production.
//
//   GET /api/store-reports/audit                → today (SAST)
//   GET /api/store-reports/audit?day=2026-07-18 → a specific day
//   GET /api/store-reports/audit?status=failed  → filter by outcome status
//   GET /api/store-reports/audit?email=jo@x.co  → filter by rep email (substring)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");

    const sp = req.nextUrl.searchParams;
    const day = (sp.get("day") || trackingDay()).trim();
    const statusFilter = (sp.get("status") || "").trim().toLowerCase();
    const emailFilter = (sp.get("email") || "").trim().toLowerCase();

    let rows = await getAuditForDay(day);
    if (statusFilter) rows = rows.filter((r) => r.status.toLowerCase() === statusFilter);
    if (emailFilter) rows = rows.filter((r) => r.repEmail.toLowerCase().includes(emailFilter));

    // Counts per outcome status — the at-a-glance "what happened today".
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    return Response.json(
      { day, total: rows.length, byStatus, rows },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
