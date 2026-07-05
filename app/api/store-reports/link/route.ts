import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { reportBaseUrl } from "@/lib/storeReportLoad";
import { signReportLink } from "@/lib/reportLink";

// Mint a signed /r link for an authenticated admin (the Store Reports "Preview"
// button). The browser can't hold the signing secret, so it asks here.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const sp = req.nextUrl.searchParams;
    const site = (sp.get("site") || "").trim();
    if (!site) return Response.json({ error: "Missing site" }, { status: 400, headers: noCacheHeaders() });

    const intParam = (v: string | null): number | undefined => {
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isNaN(n) ? undefined : n;
    };

    const r = signReportLink({
      site,
      clientId: sp.get("clientId") || undefined,
      year: intParam(sp.get("year")),
      month: intParam(sp.get("month")),
      week: intParam(sp.get("week")),
    });
    const base = reportBaseUrl(req.nextUrl.origin);
    return Response.json({ url: `${base}/r?r=${r}` }, { headers: noCacheHeaders() });
  } catch (e) {
    return handleAuthError(e);
  }
}
