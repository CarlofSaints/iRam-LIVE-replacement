/* ──────────────────────────────────────────────────────────────
   Store-report send log — per armed week.

   One record per send attempt. Doubles as the DEDUP LEDGER: the trigger
   checks hasSent(periodKey, siteCode, repEmail) before sending, so a store
   report goes out at most once per (store, rep) per armed week, and Perigee's
   duplicate check-in/check-out fires (same visit GUID) never double-send.

   Stored one blob per period so a busy week never bloats a single file.
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

export async function hasProcessedVisit(periodKey: string, visitGuid: string): Promise<boolean> {
  if (!visitGuid) return false;
  const sends = await getSendsForPeriod(periodKey);
  const g = visitGuid.trim().toLowerCase();
  return sends.some((s) => s.visitGuid.trim().toLowerCase() === g);
}

export async function addSend(record: Omit<StoreReportSend, "id">): Promise<StoreReportSend> {
  const sends = await getSendsForPeriod(record.periodKey);
  const send: StoreReportSend = { id: uuid(), ...record };
  sends.unshift(send); // newest first
  await writeJson(logKey(record.periodKey), sends);
  return send;
}
