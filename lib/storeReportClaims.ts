/* ──────────────────────────────────────────────────────────────
   Store-report ACTION CLAIMS.

   When a rep ticks a SKU on the hosted /r page ("I actioned this"), the page
   beacons the line here. We record ONE claim per (send-token × SKU), snapshotting
   the line's state AT CLAIM TIME (SOH, flags, margins). The rep / store / channel
   / period all come from the send's TrackRecord (server-trusted — the page can't
   spoof who claimed it), only the line detail comes from the page.

   Two downstream uses:
     • Phase 2 — a weekly spreadsheet of what each rep claims they actioned.
     • Phase 3 — when a fresh DISPO loads, re-check each claim against the new
       data (e.g. a claimed Phantom write-off should show SOH → 0) and flag
       anything that doesn't add up for a CAM to review.

   Files are partitioned by the SEND day (SAST) — the same key the TrackRecord
   uses — so a report's ticks and un-ticks always land in one file (stable upsert).
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

// Verifiable-against-DISPO categories. Margin claims aren't visible in a later
// DISPO, so they are captured but never auto-verified.
export const VERIFIABLE_CATEGORIES = ["oos", "phantom", "lowCover", "status"] as const;

export interface ClaimVerification {
  checkedAt: string;          // when we ran the check
  dispoLoadedAt: string;      // the DISPO load that triggered it
  gapDays: number;            // days between claim and that DISPO
  newSoh?: number;            // SOH on the new DISPO
  outcome: "consistent" | "suspect" | "inconclusive";
  note: string;               // human-readable reason
}

export interface StoreReportClaim {
  id: string;                 // `${token}|${clientId}|${article}` — one per rep-report-SKU
  token: string;              // the send's tracking token
  sendDay: string;            // YYYY-MM-DD (SAST) = the file this claim lives in
  // ── who / where / when (from the TrackRecord, trusted) ──
  repEmail: string;
  repName: string;
  siteCode: string;
  storeName: string;
  channel: string;
  year?: number;
  month?: number;
  week?: number;
  test?: boolean;
  // ── the SKU (from the page) ──
  clientId: string;
  clientName: string;
  article: string;
  barcode?: string;
  description: string;
  categories: string[];       // flags active on the line (oos/phantom/lowCover/status/marginRisk/marginOpp)
  // ── snapshot at claim time ──
  soh: number;
  dros?: number;
  daysCover?: number | null;
  prst?: string;
  statusClass?: string;
  marginRiskRand?: number | null;
  marginOppRand?: number | null;
  // ── state ──
  active: boolean;            // currently ticked (false = the rep un-ticked it)
  claimedAt: string;          // first ticked
  updatedAt: string;          // last tick/un-tick
  verification?: ClaimVerification;  // filled in Phase 3
}

function claimFileKey(day: string): string {
  return `store-reports/claims/${day}.json`;
}

export async function getClaims(day: string): Promise<StoreReportClaim[]> {
  return readJson<StoreReportClaim[]>(claimFileKey(day), []);
}

// Load claims across several send-days (weekly sheet / verification sweeps).
export async function getClaimsForDays(days: string[]): Promise<StoreReportClaim[]> {
  const all = await Promise.all(days.map((d) => getClaims(d)));
  return all.flat();
}

export interface ClaimInput {
  token: string;
  sendDay: string;
  repEmail: string;
  repName: string;
  siteCode: string;
  storeName: string;
  channel: string;
  year?: number;
  month?: number;
  week?: number;
  test?: boolean;
  clientId: string;
  clientName: string;
  article: string;
  barcode?: string;
  description: string;
  categories: string[];
  soh: number;
  dros?: number;
  daysCover?: number | null;
  prst?: string;
  statusClass?: string;
  marginRiskRand?: number | null;
  marginOppRand?: number | null;
}

// Record a tick (on=true) or un-tick (on=false). Upserts by id so a rep toggling
// the same SKU updates one record rather than piling up events. The snapshot is
// (re)captured on each ON tick so it reflects what the rep actually saw.
export async function upsertClaim(input: ClaimInput, on: boolean): Promise<void> {
  const id = `${input.token}|${input.clientId}|${input.article}`;
  const now = new Date().toISOString();
  const claims = await getClaims(input.sendDay);
  const existing = claims.find((c) => c.id === id);

  if (existing) {
    existing.active = on;
    existing.updatedAt = now;
    if (on) {
      // Refresh the snapshot + who/where (a re-tick may carry newer data).
      existing.categories = input.categories;
      existing.soh = input.soh;
      existing.dros = input.dros;
      existing.daysCover = input.daysCover;
      existing.prst = input.prst;
      existing.statusClass = input.statusClass;
      existing.marginRiskRand = input.marginRiskRand;
      existing.marginOppRand = input.marginOppRand;
    }
  } else {
    claims.push({
      id,
      token: input.token,
      sendDay: input.sendDay,
      repEmail: input.repEmail,
      repName: input.repName,
      siteCode: input.siteCode,
      storeName: input.storeName,
      channel: input.channel,
      year: input.year,
      month: input.month,
      week: input.week,
      test: input.test,
      clientId: input.clientId,
      clientName: input.clientName,
      article: input.article,
      barcode: input.barcode,
      description: input.description,
      categories: input.categories,
      soh: input.soh,
      dros: input.dros,
      daysCover: input.daysCover,
      prst: input.prst,
      statusClass: input.statusClass,
      marginRiskRand: input.marginRiskRand,
      marginOppRand: input.marginOppRand,
      active: on,
      claimedAt: now,
      updatedAt: now,
    });
  }
  await writeJson(claimFileKey(input.sendDay), claims);
}
