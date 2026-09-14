/* ──────────────────────────────────────────────────────────────
   Portfolio Stock Health — the stored history that makes the arrows possible.

   ⚠️ THE REASON THIS FILE EXISTS. iRam keeps no stock history. A DISPO's
   SOH, PR ST, MAC and prices are a SNAPSHOT owned by the newest period — see
   lib/dispoSnapshot.ts — so a newer load OVERWRITES the older value rather
   than adding to a series. Sales months accumulate; stock does not. That means
   there is nothing in the ledger to diff this week against, and no amount of
   cleverness at read time can recover a number that was overwritten.

   So the comparison columns are not derived, they are REMEMBERED: every run
   writes the aggregate it computed, and a later run reads the older ones back.
   The corollary is worth stating plainly to anyone who asks why the first
   report is bare — the history starts the day the cron first runs, and no
   earlier.

   ── Why one blob per capture ───────────────────────────────────
   Key is `portfolio-health/{channelId}/{YYYY-MM-DD}.json`, and each capture
   owns its own key. Nothing appends to a shared list, so two runs in the same
   minute cannot lose each other's write, and a re-run on the same day is an
   idempotent overwrite of that day's key rather than a duplicate row. The
   index is the blob listing itself, which cannot drift from what is stored.

   ── Cadence ────────────────────────────────────────────────────
   Makro and Massbuild DISPOs are weekly, so the comparison points are weekly
   too: the previous capture, four weeks back, and a year back. A daily
   comparison would be four different readings of one weekly file, which is
   three lines of noise and one real number.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson, listBlobs } from "./blob";
import type { KpiCounts, PortfolioHealth } from "./portfolioHealth";

const ROOT = "portfolio-health";

export interface PortfolioSnapshot {
  /** Capture date, YYYY-MM-DD (UTC). Also the blob key. */
  date: string;
  channelId: string;
  channelName: string;
  /** ISO instant the capture ran. */
  capturedAt: string;
  /** The report period the ledger was anchored to, e.g. "Wk 2 · Sep 2026". */
  periodLabel: string;
  health: PortfolioHealth;
}

/** UTC YYYY-MM-DD for a date. */
export function snapshotDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function keyFor(channelId: string, date: string): string {
  return `${ROOT}/${channelId}/${date}.json`;
}

export async function saveSnapshot(snap: PortfolioSnapshot): Promise<void> {
  await writeJson(keyFor(snap.channelId, snap.date), snap);
}

export async function readSnapshot(
  channelId: string,
  date: string,
): Promise<PortfolioSnapshot | null> {
  return readJson<PortfolioSnapshot | null>(keyFor(channelId, date), null);
}

/**
 * Capture dates held for a channel, OLDEST FIRST.
 *
 * Read from the blob listing rather than an index we maintain: an index is a
 * second thing that can disagree with the store, and this one would be written
 * by the same cron that writes the snapshots.
 */
export async function listSnapshotDates(channelId: string): Promise<string[]> {
  const entries = await listBlobs(`${ROOT}/${channelId}/`);
  const dates: string[] = [];
  for (const e of entries) {
    const m = e.key.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) dates.push(m[1]);
  }
  return [...new Set(dates)].sort();
}

const MS_PER_DAY = 86400000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / MS_PER_DAY);
}

/** One comparison column on the report. */
export interface ComparisonPoint {
  /** What the column is called, e.g. "4 weeks ago". */
  label: string;
  /** The capture actually used, or null when nothing fell inside tolerance. */
  date: string | null;
  /** How far off the ideal target it landed, in days. */
  driftDays: number | null;
  counts: KpiCounts | null;
  /** Per-client counts from that capture, for colouring the client table. */
  byClient?: Record<string, KpiCounts>;
}

interface Target {
  label: string;
  /** Days before the current capture. */
  daysBack: number;
  /** How far from that target a capture may sit and still be used. */
  toleranceDays: number;
}

/* Weekly cadence. Tolerances are generous enough to absorb a DISPO that landed
   a few days late, and tight enough that a "4 weeks ago" column is never
   quietly filled with a reading from two months back. */
export const COMPARISON_TARGETS: Target[] = [
  { label: "Previous capture", daysBack: 7, toleranceDays: 6 },
  { label: "4 weeks ago", daysBack: 28, toleranceDays: 10 },
  { label: "1 year ago", daysBack: 364, toleranceDays: 21 },
];

/**
 * Resolve each comparison column against the captures on hand.
 *
 * A column with nothing inside tolerance comes back with `date: null` rather
 * than the nearest capture at any distance. Reporting "no data for this
 * period" is honest; silently comparing this week against a reading from two
 * months ago produces a delta that looks precise and means nothing.
 *
 * The "previous capture" column is the exception: it takes the most recent
 * capture strictly before this one whenever that sits within tolerance of a
 * week, which is what "previous" means when files land irregularly.
 */
export async function resolveComparisons(
  channelId: string,
  currentDate: string,
  loadSnapshot: (date: string) => Promise<PortfolioSnapshot | null> = (d) => readSnapshot(channelId, d),
): Promise<ComparisonPoint[]> {
  const dates = (await listSnapshotDates(channelId)).filter((d) => d < currentDate);
  const out: ComparisonPoint[] = [];

  for (const target of COMPARISON_TARGETS) {
    let best: string | null = null;
    let bestDrift = Infinity;

    for (const d of dates) {
      const back = daysBetween(currentDate, d);       // positive, days into the past
      const drift = Math.abs(back - target.daysBack);
      if (drift > target.toleranceDays) continue;
      if (drift < bestDrift) {
        bestDrift = drift;
        best = d;
      }
    }

    // "Previous capture" falls back to the newest earlier capture when the
    // weekly rhythm slipped — but still only within its tolerance window.
    if (!best && target.label === "Previous capture" && dates.length) {
      const newest = dates[dates.length - 1];
      const back = daysBetween(currentDate, newest);
      if (back <= target.daysBack + target.toleranceDays) {
        best = newest;
        bestDrift = Math.abs(back - target.daysBack);
      }
    }

    if (!best) {
      out.push({ label: target.label, date: null, driftDays: null, counts: null });
      continue;
    }

    const snap = await loadSnapshot(best);
    if (!snap) {
      // Listed but unreadable. Say so rather than quietly showing no column.
      out.push({ label: target.label, date: best, driftDays: bestDrift, counts: null });
      continue;
    }

    const byClient: Record<string, KpiCounts> = {};
    for (const r of snap.health.byClient) byClient[r.key] = r.counts;

    out.push({
      label: target.label,
      date: best,
      driftDays: bestDrift,
      counts: snap.health.totals,
      byClient,
    });
  }

  return out;
}

/** Delta helper for the UI: positive means MORE of a measure, which is worse. */
export function delta(now: number, then: number | null | undefined): number | null {
  if (then === null || then === undefined) return null;
  return now - then;
}
