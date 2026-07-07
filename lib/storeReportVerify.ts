/* ──────────────────────────────────────────────────────────────
   Phase 3 — verify rep action-claims against a freshly-loaded DISPO.

   When a new DISPO loads for a client, we re-check every active claim for that
   client (in a recent window) against the new data and stamp claim.verification:

     • Phantom  (wrote it off)   → SOH should drop to 0     → else SUSPECT
     • Out of Stock (ordered)    → SOH > 0, or SOO/SIT > 0   → else SUSPECT
     • Low Cover (reordered)     → SOO/SIT appear / SOH up   → else SUSPECT
     • Status   (queried block)  → status code changed       → else INCONCLUSIVE

   Margin claims are never verified (not visible in a later DISPO). Judged on the
   VERY NEXT DISPO with no grace window — the claim→DISPO day gap is recorded so a
   CAM can allow for paperwork lag. A later DISPO simply re-stamps the latest
   verdict. Best-effort: a SKU/site not present in this DISPO is left untouched.
   ────────────────────────────────────────────────────────────── */

import { getClaims, saveClaims, recentClaimDays, VERIFIABLE_CATEGORIES, type StoreReportClaim } from "./storeReportClaims";
import { getCodeMap, looseCode } from "./storeReportCodeMap";

type Row = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("en-ZA");
}

interface Verdict {
  outcome: "consistent" | "suspect" | "inconclusive";
  note: string;
}

// Evaluate the highest-priority verifiable category on the claim.
function evaluate(
  cats: string[], claim: StoreReportClaim,
  newSoh: number, soo: number, sit: number, newPrst: string,
): Verdict {
  if (cats.includes("phantom")) {
    if (newSoh <= 0) return { outcome: "consistent", note: `Phantom cleared — SOH now ${fmt(newSoh)} (was ${fmt(claim.soh)}). Looks written off.` };
    if (newSoh < claim.soh) return { outcome: "consistent", note: `SOH reduced ${fmt(claim.soh)} → ${fmt(newSoh)} — partial write-off / movement.` };
    return { outcome: "suspect", note: `Marked phantom (write-off) but SOH still ${fmt(newSoh)} (was ${fmt(claim.soh)}) — verify it was actioned.` };
  }
  if (cats.includes("oos")) {
    if (newSoh > 0) return { outcome: "consistent", note: `Back in stock — SOH now ${fmt(newSoh)}.` };
    if (soo > 0 || sit > 0) return { outcome: "consistent", note: `Order in the pipeline — SOO ${fmt(soo)} / SIT ${fmt(sit)}.` };
    return { outcome: "suspect", note: `Marked actioned but still out of stock (SOH ${fmt(newSoh)}, no order on the way) — check it was ordered.` };
  }
  if (cats.includes("lowCover")) {
    if (soo > 0 || sit > 0) return { outcome: "consistent", note: `Reorder on the way — SOO ${fmt(soo)} / SIT ${fmt(sit)}.` };
    if (newSoh > claim.soh) return { outcome: "consistent", note: `Stock up ${fmt(claim.soh)} → ${fmt(newSoh)} — replenished.` };
    return { outcome: "suspect", note: `Marked actioned but no reorder signal (SOO/SIT 0, SOH ${fmt(newSoh)}) — check it was reordered.` };
  }
  // status
  const oldPrst = String(claim.prst || "").trim().toUpperCase();
  if (oldPrst && newPrst && newPrst !== oldPrst) {
    return { outcome: "consistent", note: `Status changed ${oldPrst} → ${newPrst}.` };
  }
  return { outcome: "inconclusive", note: `Status still ${newPrst || "(blank)"} — no change visible yet.` };
}

export interface VerifyResult {
  checked: number;
  consistent: number;
  suspect: number;
  inconclusive: number;
}

export async function verifyClaimsAgainstDispo(params: {
  clientId: string;
  rows: Row[];
  loadedAt?: string;
  windowDays?: number;
}): Promise<VerifyResult> {
  const windowDays = params.windowDays ?? 28;
  const loadedAt = params.loadedAt ?? new Date().toISOString();
  const loadedMs = new Date(loadedAt).getTime();

  // Perigee visit code → DISPO site code (a claim's siteCode is the visit code).
  const map = await getCodeMap();
  const perigeeToDispo = new Map<string, string>();
  for (const m of map) perigeeToDispo.set(looseCode(m.perigeeCode), looseCode(m.dispoCode));

  // Index the new DISPO rows by looseSite|article.
  const rowIndex = new Map<string, Row>();
  for (const r of params.rows) {
    const site = looseCode(r["Site"]);
    const article = String(r["Article"] ?? "").trim();
    if (site && article) rowIndex.set(`${site}|${article}`, r);
  }

  const res: VerifyResult = { checked: 0, consistent: 0, suspect: 0, inconclusive: 0 };
  const verifiable = VERIFIABLE_CATEGORIES as readonly string[];

  for (const day of recentClaimDays(windowDays)) {
    const claims = await getClaims(day);
    let dirty = false;
    for (const c of claims) {
      if (c.clientId !== params.clientId || !c.active || c.test) continue;
      const cats = c.categories.filter((x) => verifiable.includes(x));
      if (!cats.length) continue;

      const dispoSite = perigeeToDispo.get(looseCode(c.siteCode)) || looseCode(c.siteCode);
      const row = rowIndex.get(`${dispoSite}|${c.article}`);
      if (!row) continue; // SKU/site not in this DISPO file — leave untouched

      const newSoh = num(row["SOH"]);
      const soo = num(row["SOO"]);
      const sit = num(row["SIT"]);
      const newPrst = String(row["Status"] ?? row["PR ST"] ?? "").trim().toUpperCase();
      const gapDays = Math.max(0, Math.round((loadedMs - new Date(c.claimedAt).getTime()) / 86400000));

      const v = evaluate(cats, c, newSoh, soo, sit, newPrst);
      c.verification = { checkedAt: new Date().toISOString(), dispoLoadedAt: loadedAt, gapDays, newSoh, outcome: v.outcome, note: v.note };
      dirty = true;
      res.checked++;
      if (v.outcome === "consistent") res.consistent++;
      else if (v.outcome === "suspect") res.suspect++;
      else res.inconclusive++;
    }
    if (dirty) await saveClaims(day, claims);
  }
  return res;
}
