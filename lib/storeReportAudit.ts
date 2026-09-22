/* ──────────────────────────────────────────────────────────────
   Store-report AUDIT ledger — one record per visit outcome, per SAST day.

   Unlike the send ledger (lib/storeReportLog.ts), which is the DEDUP ledger and
   only persists "sent" / "skipped_no_data", this ledger records EVERY outcome of
   every processed check-in — including the reasons a rep was dropped that were
   previously only visible in the ephemeral run payload:

     skipped-no-email · skipped-channel · skipped-duplicate ·
     skipped-repeat-not-sent · skipped-no-sitecode · skipped-no-mapping ·
     skipped-no-data · failed · sent

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

/* Identity of a REPEATING outcome — one rep at one store with one result.

   The poller runs every three minutes all day, and Perigee keeps returning the
   same visits, so a rep who was sent their report at 08:00 is re-reported as
   "already sent today" on every run until midnight. On 11 Sep 2026 that turned
   66 real visits into 5 201 audit rows, 5 161 of them identical duplicates, in
   a 1.4MB file — a ledger nobody can read is not a ledger.

   So a repeat of an outcome already recorded today is dropped. The FIRST one
   is kept, which is the one that says what happened; later identical ones only
   say "and the poller ran again", which `lastRun` already records. */
function outcomeKey(r: { siteCode: string; repEmail: string; status: string }): string {
  return `${r.siteCode}|${r.repEmail.toLowerCase()}|${r.status}`;
}

/**
 * Append one run's worth of outcomes, skipping any that repeat an outcome
 * already recorded for this day.
 *
 * ⚠️ A CHANGE of outcome is never dropped: a rep who was "no data" at 09:00 and
 * "sent" at 14:00 keeps both rows, because that transition is exactly what
 * someone investigating needs to see. Only the identical repeat goes.
 *
 * Single read-modify-write. Two polls cannot normally overlap (the cron is
 * every 3 minutes and a run takes seconds), and the worst case of a race is a
 * duplicate diagnostic row, which is what this function is filtering anyway.
 */
export async function recordAuditOutcomes(
  day: string,
  outcomes: RunVisitOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const at = new Date().toISOString();
  const existing = await getAuditForDay(day);

  const seen = new Set(existing.map(outcomeKey));
  const rows: StoreReportAuditRecord[] = [];
  for (const o of outcomes) {
    const key = outcomeKey({ siteCode: o.siteCode, repEmail: o.repEmail, status: o.status });
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
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
    });
  }

  if (rows.length === 0) return;
  // Newest run first, matching the send ledger's ordering convention.
  await writeJson(auditKey(day), [...rows, ...existing]);
}
