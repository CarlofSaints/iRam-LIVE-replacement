/* ──────────────────────────────────────────────────────────────
   Store-report send log — one blob per DAY.

   ⚠️ `periodKey` is the tracking DAY (the runner passes `trackingDay()`), not
   an armed week — this comment said "week" for months and it is worth reading
   twice, because it describes how often a rep can be mailed.

   One record per processed visit. Doubles as the DEDUP LEDGER: the trigger
   checks hasSent(periodKey, siteCode, repEmail) before sending, so a store
   report goes out at most once per (store, rep) per day, and Perigee's
   duplicate check-in/check-out fires (same visit GUID) never double-send.

   ⚠️ Not every record is a send. `skipped_no_data` records are written here
   too, so the poller does not re-render a clean or unmapped store every three
   minutes. Read `processedVisitStatus`, never just "is it in here".

   Stored one blob per period so a busy day never bloats a single file.
   ────────────────────────────────────────────────────────────── */

import type { StoreReportSend } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

function logKey(periodKey: string): string {
  return `store-reports/sends/${periodKey}.json`;
}

export async function getSendsForPeriod(periodKey: string): Promise<StoreReportSend[]> {
  return readJson<StoreReportSend[]>(logKey(periodKey), []);
}

// Dedup checks: a real send already exists for this (store, rep), or the exact
// visit GUID has already been processed (Perigee double-fire).
export async function hasSent(
  periodKey: string, siteCode: string, repEmail: string,
): Promise<boolean> {
  const sends = await getSendsForPeriod(periodKey);
  const site = siteCode.trim().toLowerCase();
  const email = repEmail.trim().toLowerCase();
  return sends.some(
    (s) =>
      s.status === "sent" &&
      s.siteCode.trim().toLowerCase() === site &&
      s.repEmail.trim().toLowerCase() === email,
  );
}

/* What already happened to this visit GUID today, or null if it is new.

   ⚠️ Returns the STATUS, not a boolean, and that difference is the whole point.
   `addSend` is called with `status: "skipped_no_data"` for a clean store AND
   for a site that is in no loaded DISPO, so this ledger is full of visits that
   were PROCESSED but never emailed. A boolean here made every one of them read
   as "Already sent today" from the second poll of the day onward, three minutes
   after the real reason was recorded — so a rep who was never going to get a
   report sat in the same bucket as 40 reps who got one, and the run summary
   looked healthy while the complaint was real. Callers must branch on WHICH
   status comes back. */
export async function processedVisitStatus(
  periodKey: string, visitGuid: string,
): Promise<StoreReportSend["status"] | null> {
  if (!visitGuid) return null;
  const sends = await getSendsForPeriod(periodKey);
  const g = visitGuid.trim().toLowerCase();
  return sends.find((s) => s.visitGuid.trim().toLowerCase() === g)?.status ?? null;
}

/** Was this visit GUID seen at all today, whatever the outcome? Prefer
 *  `processedVisitStatus` — a bare yes/no cannot tell sent from never-sent. */
export async function hasProcessedVisit(periodKey: string, visitGuid: string): Promise<boolean> {
  return (await processedVisitStatus(periodKey, visitGuid)) !== null;
}

export async function addSend(record: Omit<StoreReportSend, "id">): Promise<StoreReportSend> {
  const sends = await getSendsForPeriod(record.periodKey);
  const send: StoreReportSend = { id: uuid(), ...record };
  sends.unshift(send); // newest first
  await writeJson(logKey(record.periodKey), sends);
  return send;
}
