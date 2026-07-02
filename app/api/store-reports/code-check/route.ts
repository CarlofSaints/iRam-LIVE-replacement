import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { getMergedStores } from "@/lib/storeFileData";
import { getCodeMap, buildResolver, looseCode } from "@/lib/storeReportCodeMap";
import type { StoreRecord } from "@/lib/types";

// Reps don't call on DCs, online stores or closed stores — so they never need
// linking and shouldn't clutter the candidate list. We check both the store
// master record (status/sub-channel) AND the store name we captured (which may
// be the only signal for a DISPO-ledger code with no store-master record — e.g.
// a "… DC" / "Distribution Centre" name). NOTE: never filter on "warehouse" —
// Builders Warehouse (BWH) stores are real callable retail stores.
function isCallableStore(rec: StoreRecord | undefined, name?: string): boolean {
  const status = String(rec?.status ?? "").toLowerCase();
  if (/clos|shut|inactiv|ceas|delist|not\s*trad/.test(status)) return false;
  const sub = String(rec?.subChannel ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (sub === "dc" || sub.startsWith("distributioncent") || sub.includes("online") || sub.includes("ecommerce")) return false;
  const hay = `${name ?? ""} ${rec?.storeName ?? ""} ${rec?.type ?? ""} ${rec?.channel ?? ""} ${rec?.subChannel ?? ""}`.toLowerCase();
  if (/\bonline\b|e-?commerce|distribution\s*cent|\bdc\b|\bd\.?c\.?\b/.test(hay)) return false;
  return true;
}

// Compare a pasted list of Perigee site codes (optionally with their store names)
// against the DISPO ledgers + store master — accounting for the DISPO↔Perigee
// map. Returns the DISPO store NAME alongside each match so an ambiguous code can
// be confirmed by name. Matching mirrors the trigger (loose case/space/dash).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digits = (s: string) => s.replace(/\D+/g, "").replace(/^0+/, "");

interface Entry { code: string; name: string }

export async function POST(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as { entries?: { code?: unknown; name?: unknown }[]; codes?: unknown };

    // Accept structured entries {code,name} or a plain codes[] (names blank).
    let entries: Entry[] = [];
    if (Array.isArray(body.entries)) {
      entries = body.entries.map((e) => ({ code: String(e.code ?? "").trim(), name: String(e.name ?? "").trim() }));
    } else if (Array.isArray(body.codes)) {
      entries = body.codes.map((c) => ({ code: String(c).trim(), name: "" }));
    }
    // De-dupe by code (keep first name seen).
    const seen = new Set<string>();
    entries = entries.filter((e) => e.code && !seen.has(looseCode(e.code)) && seen.add(looseCode(e.code)));
    if (!entries.length) {
      return Response.json({ error: "No codes provided" }, { status: 400, headers: noCacheHeaders() });
    }

    // DISPO codes (from ledgers) + store-master codes & names.
    const clients = (await getClients()).filter((c) => c.sendConsolidatedStoreReports);
    const dispoExact = new Set<string>();
    const dispoLoose = new Map<string, string>();   // loose → exact example
    const dispoDigits = new Map<string, string>();  // digit-core → callable example (fuzzy match)
    const nameByLoose = new Map<string, string>();  // loose code → store name
    const recByLoose = new Map<string, StoreRecord>(); // loose code → store master record

    // Build the store-master record index FIRST so callability is known while we
    // populate the pools (the fuzzy digit pool must skip non-callable stores).
    const merged = await getMergedStores();
    for (const s of merged) recByLoose.set(looseCode(String(s.siteNum ?? "")), s);

    const add = (raw: string, name?: string) => {
      const e = raw.trim(); if (!e) return;
      const lc = looseCode(e);
      if (name && name.trim() && !nameByLoose.has(lc)) nameByLoose.set(lc, name.trim());
      dispoExact.add(e);
      if (!dispoLoose.has(lc)) dispoLoose.set(lc, e);
      // Fuzzy digit-match strips letters, so S103 and D103 both reduce to "103".
      // Never let a non-callable store (closed / DC / online) be a fuzzy match
      // target — that produced false "format diff" matches like S103 → D103
      // (a closed DC). Exact/loose matches still resolve against every code.
      if (isCallableStore(recByLoose.get(lc), name ?? nameByLoose.get(lc))) {
        const d = digits(e); if (d && !dispoDigits.has(d)) dispoDigits.set(d, e);
      }
    };
    for (const client of clients) {
      for (const meta of await getAllSalesLedgers(client.id)) {
        const ledger = await getSalesLedger(client.id, meta.channelId);
        for (const r of ledger) add(String(r["Site"] ?? ""), String(r["_storeName"] ?? r["Site Name"] ?? ""));
      }
    }
    for (const s of merged) add(String(s.siteNum ?? ""), String(s.storeName ?? ""));

    const map = await getCodeMap();
    const resolve = buildResolver(map);
    const dispoName = (code?: string) => (code ? nameByLoose.get(looseCode(code)) || "" : "");

    const results = entries.map((e) => {
      const code = e.code;
      const linked = resolve(code);
      if (linked) {
        const ok = dispoLoose.has(looseCode(linked));
        return { code, name: e.name, status: "linked" as const, dispoCode: linked, dispoName: dispoName(linked), reason: ok ? "manually linked" : "linked, but DISPO code not found" };
      }
      if (dispoLoose.has(looseCode(code))) {
        const dc = dispoLoose.get(looseCode(code));
        return { code, name: e.name, status: "match" as const, dispoCode: dc, dispoName: dispoName(dc) };
      }
      const d = dispoDigits.get(digits(code));
      if (d && digits(code)) return { code, name: e.name, status: "format-diff" as const, dispoCode: d, dispoName: dispoName(d), reason: "leading zeros / prefix differs — link to confirm" };
      return { code, name: e.name, status: "no-match" as const, dispoName: "" };
    });

    // Candidates for linking = DISPO codes NOT in the pasted list, NOT already a
    // link target, and callable (drop DC / online / closed stores).
    const inputLoose = new Set(entries.map((e) => looseCode(e.code)));
    const linkedTargets = new Set(map.map((m) => looseCode(m.dispoCode)));
    const dispoOnly = [...dispoExact]
      .filter((d) => {
        const lc = looseCode(d);
        if (inputLoose.has(lc) || linkedTargets.has(lc)) return false;
        return isCallableStore(recByLoose.get(lc), nameByLoose.get(lc));
      })
      .sort()
      .map((code) => ({ code, name: dispoName(code) }));

    // Reverse index: which pasted Perigee code currently "claims" each DISPO
    // store — an exact/fuzzy code match in the list, or a manual link. Lets the
    // linker show "already used by X" instead of hiding a store that's spoken for
    // (so you can still link a second code to it, or reassign a manual link).
    const claimByDispo = new Map<string, { by: string; via: "match" | "format-diff" | "linked" }>();
    for (const r of results) {
      if (r.dispoCode && (r.status === "match" || r.status === "format-diff" || r.status === "linked")) {
        const lc = looseCode(r.dispoCode);
        if (!claimByDispo.has(lc)) claimByDispo.set(lc, { by: r.code, via: r.status });
      }
    }
    // Every callable DISPO store (claimed or not) — the linker searches this so a
    // store already used by another code is still findable and (re)assignable.
    const dispoAll = [...dispoExact]
      .filter((d) => isCallableStore(recByLoose.get(looseCode(d)), nameByLoose.get(looseCode(d))))
      .sort()
      .map((code) => ({ code, name: dispoName(code), claim: claimByDispo.get(looseCode(code)) ?? null }));

    return Response.json(
      {
        checked: entries.length,
        matched: results.filter((r) => r.status === "match").length,
        linked: results.filter((r) => r.status === "linked").length,
        formatDiff: results.filter((r) => r.status === "format-diff").length,
        noMatch: results.filter((r) => r.status === "no-match").length,
        dispoCodeCount: dispoExact.size,
        dispoOnlyCount: dispoOnly.length,
        results,
        dispoOnly,
        dispoAll,
        mappings: map,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
