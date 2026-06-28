import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { getMergedStores } from "@/lib/storeFileData";

// Compare a pasted list of site codes (e.g. the storeCode column from the Perigee
// store list) against the codes actually present in the DISPO ledgers + store
// master — so we can confirm the trigger's storeCode will match before any live
// check-ins. Reports exact matches, format-only diffs, and no-matches.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const exact = (s: string) => s.trim();
const loose = (s: string) => s.trim().toLowerCase().replace(/[\s\-_]+/g, "");
const digits = (s: string) => s.replace(/\D+/g, "").replace(/^0+/, "");

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
    const input = Array.isArray(body.codes) ? body.codes.map((c) => String(c)) : [];
    const codes = [...new Set(input.map((c) => c.trim()).filter(Boolean))];
    if (!codes.length) {
      return Response.json({ error: "No codes provided" }, { status: 400, headers: noCacheHeaders() });
    }

    // Gather all DISPO Site codes (across flagged clients) + store-master codes.
    const clients = (await getClients()).filter((c) => c.sendConsolidatedStoreReports);
    const dispoExact = new Set<string>();
    const dispoLoose = new Map<string, string>();  // loose → an exact example
    const dispoDigits = new Map<string, string>();
    const add = (raw: string) => {
      const e = exact(raw); if (!e) return;
      dispoExact.add(e);
      if (!dispoLoose.has(loose(e))) dispoLoose.set(loose(e), e);
      const d = digits(e); if (d && !dispoDigits.has(d)) dispoDigits.set(d, e);
    };

    for (const client of clients) {
      for (const meta of await getAllSalesLedgers(client.id)) {
        const ledger = await getSalesLedger(client.id, meta.channelId);
        for (const r of ledger) add(String(r["Site"] ?? ""));
      }
    }
    for (const s of await getMergedStores()) add(String(s.siteNum ?? ""));

    const results = codes.map((code) => {
      if (dispoExact.has(exact(code))) return { code, status: "match" as const };
      const l = dispoLoose.get(loose(code));
      if (l) return { code, status: "format-diff" as const, dispoCode: l, reason: "case / spacing / dash differs" };
      const d = dispoDigits.get(digits(code));
      if (d && digits(code)) return { code, status: "format-diff" as const, dispoCode: d, reason: "leading zeros / prefix differs" };
      return { code, status: "no-match" as const };
    });

    const inputLoose = new Set(codes.map(loose));
    const dispoOnly = [...dispoExact].filter((d) => !inputLoose.has(loose(d))).sort();

    return Response.json(
      {
        checked: codes.length,
        matched: results.filter((r) => r.status === "match").length,
        formatDiff: results.filter((r) => r.status === "format-diff").length,
        noMatch: results.filter((r) => r.status === "no-match").length,
        dispoCodeCount: dispoExact.size,
        dispoOnlyCount: dispoOnly.length,
        results,
        dispoOnly: dispoOnly.slice(0, 200), // codes in DISPO not in the pasted list
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
