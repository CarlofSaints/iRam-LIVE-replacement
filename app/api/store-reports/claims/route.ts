import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClaims, getClaimsForDays, recentClaimDays, type StoreReportClaim } from "@/lib/storeReportClaims";
import { trackingDay } from "@/lib/storeReportTracking";

// Inspect captured action claims + verification verdicts.
//   ?window=N  — trailing N send-days aggregate (active, non-test) with a summary.
//   ?day=YYYY-MM-DD — a single send-day, raw (all claims). Defaults to today.
// manage_store_reports.
export const dynamic = "force-dynamic";

function verdict(c: StoreReportClaim): "consistent" | "suspect" | "inconclusive" | "pending" {
  return c.verification ? c.verification.outcome : "pending";
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const sp = req.nextUrl.searchParams;
    const windowParam = sp.get("window");

    if (windowParam) {
      const n = Math.min(90, Math.max(1, parseInt(windowParam, 10) || 7));
      const days = recentClaimDays(n);
      const claims = (await getClaimsForDays(days)).filter((c) => c.active && !c.test);
      const summary = { total: claims.length, consistent: 0, suspect: 0, inconclusive: 0, pending: 0 };
      for (const c of claims) summary[verdict(c)]++;

      // Suspect first, then pending, then by most-recent claim.
      const order = { suspect: 0, pending: 1, inconclusive: 2, consistent: 3 };
      const rows = claims
        .map((c) => ({
          repName: c.repName, repEmail: c.repEmail,
          store: c.storeName || c.siteCode, siteCode: c.siteCode, channel: c.channel,
          clientName: c.clientName, article: c.article, description: c.description,
          categories: c.categories, soh: c.soh,
          claimedAt: c.claimedAt,
          verdict: verdict(c),
          newSoh: c.verification?.newSoh ?? null,
          gapDays: c.verification?.gapDays ?? null,
          note: c.verification?.note ?? "",
        }))
        .sort((a, b) =>
          order[a.verdict] - order[b.verdict] || (b.claimedAt || "").localeCompare(a.claimedAt || ""));

      return Response.json({ window: n, days, summary, claims: rows }, { headers: noCacheHeaders() });
    }

    const day = sp.get("day") || trackingDay();
    const claims = await getClaims(day);
    claims.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Response.json(
      { day, total: claims.length, active: claims.filter((c) => c.active).length, claims },
      { headers: noCacheHeaders() },
    );
  } catch (e) {
    return handleAuthError(e);
  }
}
