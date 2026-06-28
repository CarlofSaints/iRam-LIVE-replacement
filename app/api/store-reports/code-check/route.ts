import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { getMergedStores } from "@/lib/storeFileData";
import { getCodeMap, buildResolver, looseCode } from "@/lib/storeReportCodeMap";

// Compare a pasted list of site codes (the Perigee storeCode column) against the
// codes present in the DISPO ledgers + store master — accounting for the
// DISPO↔Perigee map. Matching mirrors the trigger: loose (case/space/dash) match
// counts as a match; otherwise a manual link is needed.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    // DISPO + store-master codes.
    const clients = (await getClients()).filter((c) => c.sendConsolidatedStoreReports);
    const dispoExact = new Set<string>();
    const dispoLoose = new Map<string, string>();   // loose → exact example
    const dispoDigits = new Map<string, string>();
    const add = (raw: string) => {
      const e = raw.trim(); if (!e) return;
      dispoExact.add(e);
      if (!dispoLoose.has(looseCode(e))) dispoLoose.set(looseCode(e), e);
      const d = digits(e); if (d && !dispoDigits.has(d)) dispoDigits.set(d, e);
    };
    for (const client of clients) {
      for (const meta of await getAllSalesLedgers(client.id)) {
        const ledger = await getSalesLedger(client.id, meta.channelId);
        for (const r of ledger) add(String(r["Site"] ?? ""));
      }
    }
    for (const s of await getMergedStores()) add(String(s.siteNum ?? ""));

    const map = await getCodeMap();
    const resolve = buildResolver(map);

    const results = codes.map((code) => {
      // 1. Explicit mapping wins.
      const linked = resolve(code);
      if (linked) {
        const ok = dispoLoose.has(looseCode(linked));
        return { code, status: "linked" as const, dispoCode: linked, reason: ok ? "manually linked" : "linked, but DISPO code not found" };
      }
      // 2. Loose match (what the trigger does automatically).
      if (dispoLoose.has(looseCode(code))) return { code, status: "match" as const, dispoCode: dispoLoose.get(looseCode(code)) };
      // 3. Same digits — likely leading-zero / prefix difference → needs a link.
      const d = dispoDigits.get(digits(code));
      if (d && digits(code)) return { code, status: "format-diff" as const, dispoCode: d, reason: "leading zeros / prefix differs — link to confirm" };
      // 4. Nothing.
      return { code, status: "no-match" as const };
    });

    const inputLoose = new Set(codes.map(looseCode));
    const dispoOnly = [...dispoExact].filter((d) => !inputLoose.has(looseCode(d))).sort();

    return Response.json(
      {
        checked: codes.length,
        matched: results.filter((r) => r.status === "match").length,
        linked: results.filter((r) => r.status === "linked").length,
        formatDiff: results.filter((r) => r.status === "format-diff").length,
        noMatch: results.filter((r) => r.status === "no-match").length,
        dispoCodeCount: dispoExact.size,
        dispoOnlyCount: dispoOnly.length,
        results,
        dispoOnly,                        // candidates for linking (all DISPO codes not matched)
        mappings: map,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
