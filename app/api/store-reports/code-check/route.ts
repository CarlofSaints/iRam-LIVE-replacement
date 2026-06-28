import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { getMergedStores } from "@/lib/storeFileData";
import { getCodeMap, buildResolver, looseCode } from "@/lib/storeReportCodeMap";

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
    const dispoDigits = new Map<string, string>();
    const nameByLoose = new Map<string, string>();  // loose code → store name
    const add = (raw: string, name?: string) => {
      const e = raw.trim(); if (!e) return;
      dispoExact.add(e);
      const lc = looseCode(e);
      if (!dispoLoose.has(lc)) dispoLoose.set(lc, e);
      const d = digits(e); if (d && !dispoDigits.has(d)) dispoDigits.set(d, e);
      if (name && name.trim() && !nameByLoose.has(lc)) nameByLoose.set(lc, name.trim());
    };
    for (const client of clients) {
      for (const meta of await getAllSalesLedgers(client.id)) {
        const ledger = await getSalesLedger(client.id, meta.channelId);
        for (const r of ledger) add(String(r["Site"] ?? ""), String(r["_storeName"] ?? r["Site Name"] ?? ""));
      }
    }
    for (const s of await getMergedStores()) add(String(s.siteNum ?? ""), String(s.storeName ?? ""));

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

    const inputLoose = new Set(entries.map((e) => looseCode(e.code)));
    const dispoOnly = [...dispoExact]
      .filter((d) => !inputLoose.has(looseCode(d)))
      .sort()
      .map((code) => ({ code, name: dispoName(code) }));

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
        mappings: map,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
