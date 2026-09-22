import { NextRequest } from "next/server";
import { requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getTodayMassmartVisits } from "@/lib/sqlProxy";
import { normaliseVisit } from "@/lib/storeReportSync";

/* Super-admin: raw today's-visits from the SQL proxy + how our normaliser reads
   each row. Open in-browser while logged in as super_admin.

     GET /api/store-reports/visits-debug         → counts, columns, site codes
     GET /api/store-reports/visits-debug?q=S117  → every visit mentioning S117
     GET /api/store-reports/visits-debug?all=1   → every raw row (capped)

   ⚠️ WHY `siteCodes` AND `q` EXIST. The audit ledger records PERIGEE's site
   code, not ours, so a store we call S117 is invisible to any search for
   "S117" if Perigee spells it differently — and the original version of this
   endpoint only returned the first 5 of ~50 rows, which cannot tell "that rep
   did not check in" from "that rep checked in under a code you did not guess".
   `siteCodes` lists every distinct code seen today so absence is provable at a
   glance, and `q` searches EVERY column of every row rather than the ones our
   normaliser happens to read, so a code hiding in an unmapped column is still
   found. See [[a-filtered-list-cannot-prove-absence]].

   ⚠️ Returns real rep names and email addresses — anonymise before pasting a
   screenshot of it anywhere. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 200;

// Loose compare, mirroring the trigger: case, spaces, dashes and underscores
// are noise. Deliberately NOT stripping letters — "S117" vs "117" is a real
// difference worth seeing, and collapsing it would hide the answer.
const loose = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

export async function GET(req: NextRequest) {
  try {
    requireRole(req, "super_admin");
    const sp = req.nextUrl.searchParams;
    const q = loose((sp.get("q") || "").trim());
    const all = sp.get("all") === "1";

    const raw = await getTodayMassmartVisits();
    const normalised = raw.map(normaliseVisit);

    // Every distinct site code + channel the poller saw today. This is the list
    // that answers "is our store in here at all, under any spelling?".
    const siteCodes = [...new Set(normalised.map((v) => v.siteCode).filter(Boolean))].sort();
    const channels = [...new Set(normalised.map((v) => v.channel).filter(Boolean))].sort();
    const byChannel: Record<string, number> = {};
    for (const v of normalised) byChannel[v.channel || "(blank)"] = (byChannel[v.channel || "(blank)"] ?? 0) + 1;

    // Visits with no readable site code never reach a report and are easy to
    // miss, because they show in the audit with an EMPTY site code — so they
    // cannot be found by searching for the store either.
    const noSiteCode = normalised
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => !v.siteCode)
      .map(({ v, i }) => ({ row: i, repName: v.repName, repEmail: v.repEmail, channel: v.channel }));

    // Search every VALUE of every column, not just the ones normaliseVisit reads.
    const matches = q
      ? raw
          .map((row, i) => ({ row, i }))
          .filter(({ row }) => Object.values(row).some((val) => val != null && loose(String(val)).includes(q)))
          .slice(0, MAX_ROWS)
          .map(({ row, i }) => ({ row: i, raw: row, normalised: normalised[i] }))
      : undefined;

    return Response.json(
      {
        count: raw.length,
        columns: raw[0] ? Object.keys(raw[0]) : [],
        channels,
        byChannel,
        siteCodes,
        siteCodeCount: siteCodes.length,
        noSiteCode,
        ...(q ? { query: sp.get("q"), matchCount: matches?.length ?? 0, matches } : {}),
        ...(all ? { rows: raw.slice(0, MAX_ROWS).map((row, i) => ({ row: i, raw: row, normalised: normalised[i] })) } : {}),
        sampleRaw: raw.slice(0, 5),
        sampleNormalised: normalised.slice(0, 5),
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
