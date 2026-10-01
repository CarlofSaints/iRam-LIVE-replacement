/* ──────────────────────────────────────────────────────────────
   Which SQL Server client each iRam client is, for the mapping screen.

   sqlClientName is the JOIN KEY between an iRam client and every stored
   procedure (none of Mark's procs take a client parameter; they return every
   client and the caller narrows on the Client column). A wrong mapping does
   not error — it silently reads another client's data. So this only ever
   SUGGESTS; a person confirms every mapping.

   Evidence, strongest first:
     1. vendor  — an iRam vendor number appears against exactly one SQL name.
                  The SP returns VendorCode per row, and iRam stores
                  vendorNumbers, so this is a match on data, not on spelling.
     2. exact   — the same name, ignoring case and spacing.
     3. name    — looksLikeSameClient: "BISCO" vs "BISCO PLUS (PTY) LTD".

   The SP is being opened up from iRam-only clients to ALL clients, so the
   name guess will meet far more candidates than the 19 it was tuned on. That
   is why vendor comes first and why an ambiguous result (two SQL names on
   the same evidence) suggests nothing and lists the candidates instead.
   ────────────────────────────────────────────────────────────── */

import type { Client } from "./types";
import {
  looksLikeSameClient, normaliseClientName, normaliseVendorCode, type SqlClientEntry,
} from "./sqlClientNames";

export type MatchReason = "vendor" | "exact" | "name";

export interface ClientMappingRow {
  id: string;
  name: string;
  active: boolean;
  vendorNumbers: string[];
  /** What is stored today, or null. */
  current: string | null;
  /** false when the stored name is no longer on SQL's list — a stale mapping
      reads as "no data" everywhere it is used. null when nothing is stored. */
  currentOnList: boolean | null;
  /** One SQL name the evidence points to, or null when there is none or it is
      ambiguous. Offered even when a mapping exists, so a disagreement shows. */
  suggestion: { sqlName: string; reason: MatchReason } | null;
  /** Every SQL name with some evidence, when more than one does. */
  candidates: { sqlName: string; reason: MatchReason }[];
  /** Other iRam clients mapped to the same SQL name. Legitimate for a client
      split into records per vendor, but worth seeing. */
  sharedWith: string[];
}

export function buildMappingRows(clients: Client[], entries: SqlClientEntry[]): ClientMappingRow[] {
  const norm = normaliseClientName;
  const onList = new Set(entries.map((e) => norm(e.name)));

  // SQL names per vendor code.
  const byVendor = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const v of e.vendorCodes) {
      const set = byVendor.get(v) ?? new Set<string>();
      set.add(e.name);
      byVendor.set(v, set);
    }
  }

  // iRam clients per stored SQL name.
  const byStored = new Map<string, { id: string; name: string }[]>();
  for (const c of clients) {
    if (!c.sqlClientName) continue;
    const k = norm(c.sqlClientName);
    byStored.set(k, [...(byStored.get(k) ?? []), { id: c.id, name: c.name }]);
  }

  return clients.map((c) => {
    const current = c.sqlClientName?.trim() || null;

    let reason: MatchReason | null = null;
    let names: string[] = [];

    const vendorHits = new Set<string>();
    for (const v of c.vendorNumbers ?? []) {
      for (const n of byVendor.get(normaliseVendorCode(v)) ?? []) vendorHits.add(n);
    }
    if (vendorHits.size > 0) {
      reason = "vendor";
      names = [...vendorHits];
      /* One vendor number under several SQL names ("HALEWOOD" and "HALEWOOD
         INTERNATIONAL"): let the name break the tie, but only if it leaves
         exactly one. Otherwise all of them stay as candidates. */
      if (names.length > 1) {
        const exact = names.filter((n) => norm(n) === norm(c.name));
        const similar = names.filter((n) => looksLikeSameClient(c.name, n));
        if (exact.length === 1) names = exact;
        else if (similar.length === 1) names = similar;
      }
    } else {
      const exact = entries.filter((e) => norm(e.name) === norm(c.name)).map((e) => e.name);
      if (exact.length > 0) {
        reason = "exact";
        names = exact;
      } else {
        const likely = entries.filter((e) => looksLikeSameClient(c.name, e.name)).map((e) => e.name);
        if (likely.length > 0) {
          reason = "name";
          names = likely;
        }
      }
    }
    names.sort((a, b) => a.localeCompare(b));

    const suggestion = reason && names.length === 1 ? { sqlName: names[0], reason } : null;
    const candidates = reason && names.length > 1 ? names.map((sqlName) => ({ sqlName, reason: reason! })) : [];

    return {
      id: c.id,
      name: c.name,
      active: c.active !== false,
      vendorNumbers: c.vendorNumbers ?? [],
      current,
      currentOnList: current ? onList.has(norm(current)) : null,
      suggestion,
      candidates,
      sharedWith: current ? (byStored.get(norm(current)) ?? []).filter((o) => o.id !== c.id).map((o) => o.name) : [],
    };
  });
}
