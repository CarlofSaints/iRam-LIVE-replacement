/* ──────────────────────────────────────────────────────────────
   Store-report AUDIT ledger — one record per visit outcome, per SAST day.

   Unlike the send ledger (lib/storeReportLog.ts), which is the DEDUP ledger and
   only persists "sent" / "skipped_no_data", this ledger records EVERY outcome of
   every processed check-in — including the reasons a rep was dropped that were
   previously only visible in the ephemeral run payload:

     skipped-no-email · skipped-channel · skipped-duplicate ·
     skipped-no-sitecode · skipped-no-mapping · skipped-no-data · failed · sent

   It is diagnostic-only — nothing reads it back into the send flow, so it can
   never affect dedup or suppress a legitimate retry. It answers, after the fact:
   "why didn't rep X at store Y get their report today?"

   Stored one blob per day so a busy week never bloats a single file. Appended in
   one write at the end of each real run (never on dry runs).
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import type { RunVisitOutcome, RunVisitStatus } from "./storeReportRunner";
import { v4 as uuid } from "uuid";

export interface StoreReportAuditRecord {
  id: string;
  day: string;                 // YYYY-MM-DD (SAST) — which daily file it lives in
  at: string;                  // ISO — when the run processed this visit
  siteCode: string;
  store: string;
  channel: string;
  repEmail: string;
  repName: string;
  status: RunVisitStatus;
  actions?: number;
  detail?: string;
}

function auditKey(day: string): string {
  return `store-reports/audit/${day}.json`;
}

export async function getAuditForDay(day: string): Promise<StoreReportAuditRecord[]> {
  return readJson<StoreReportAuditRecord[]>(auditKey(day), []);
}

// Append one run's worth of outcomes. Single read-modify-write; store-report
// volume is low (≈ one rep per token) so races are negligible.
export async function recordAuditOutcomes(
  day: string,
  outcomes: RunVisitOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const at = new Date().toISOString();
  const existing = await getAuditForDay(day);
  const rows: StoreReportAuditRecord[] = outcomes.map((o) => ({
    id: uuid(),
    day,
    at,
    siteCode: o.siteCode,
    store: o.store,
    channel: o.channel ?? "",
    repEmail: o.repEmail,
    repName: o.repName ?? "",
    status: o.status,
    actions: o.actions,
    detail: o.detail,
  }));
  // Newest run first, matching the send ledger's ordering convention.
  await writeJson(auditKey(day), [...rows, ...existing]);
}
