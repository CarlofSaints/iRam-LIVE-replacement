import { NextRequest } from "next/server";
import { requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getTodayMassmartVisits } from "@/lib/sqlProxy";
import { normaliseVisit } from "@/lib/storeReportSync";

// Super-admin: raw today's-visits from the SQL proxy + how our normaliser reads
// each row. Use this (once reps have checked in) to confirm the SP's columns and
// lock the visit mapping. Open in-browser while logged in as super_admin.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    requireRole(req, "super_admin");
    const raw = await getTodayMassmartVisits();
    return Response.json(
      {
        count: raw.length,
        columns: raw[0] ? Object.keys(raw[0]) : [],
        sampleRaw: raw.slice(0, 5),
        sampleNormalised: raw.slice(0, 5).map(normaliseVisit),
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
