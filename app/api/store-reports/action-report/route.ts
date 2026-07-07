import { NextRequest } from "next/server";
import { requirePermission, requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { runActionReport } from "@/lib/storeReportActionDigest";

// Manual control for the weekly rep action report.
//   GET  — dry-run summary (who'd get it, how many claims). manage_store_reports.
//   POST — send it now. super_admin only (mirrors the digest "send now").
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const result = await runActionReport({ send: false });
    return Response.json(result, { headers: noCacheHeaders() });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, "super_admin");
    const result = await runActionReport({ send: true });
    return Response.json(result, { headers: noCacheHeaders() });
  } catch (e) {
    return handleAuthError(e);
  }
}
