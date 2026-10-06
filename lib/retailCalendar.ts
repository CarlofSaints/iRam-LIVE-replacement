/* ──────────────────────────────────────────────────────────────
   Massmart retail calendar: how many weeks each month has.

   Massmart (Makro, Game, Builders, Walmart) report on a 4-5-4 retail
   calendar: each quarter is a 4-week month, a 5-week month, then a 4-week
   month. Weeks run Monday to Sunday. Source: "Massmart 2026 Planning
   Calendar-A3.pdf" (the "R" marks are the retail month ends):

     Jan 4 · Feb 5 · Mar 4 · Apr 4 · May 5 · Jun 4
     Jul 4 · Aug 5 · Sep 4 · Oct 4 · Nov 5 · Dec 4

   Retail week 1 is the Mon-Sun week holding 1 January (2026: Mon 29 Dec 2025;
   2027: Mon 28 Dec 2026, both as printed on the calendar).

   So Sep 2026 has NO Week 5. The Data Load picker offered Weeks 1-5 for every
   month, and on 5-6 Oct 2026 about 50 early-October DISPOs were stamped
   "Sep Wk5" (retail week 40, 28 Sep to 4 Oct, is Oct Wk1).

   ⚠️ Only 2026 is checked against a printed calendar. Every few years the
   rule above gives a 53-week year; this file then gives December the extra
   week, which is a GUESS. When Massmart publishes that year's calendar, put
   the real answer in OVERRIDES.
   ────────────────────────────────────────────────────────────── */

import { periodScore } from "./dispoSnapshot";

const PATTERN_454 = [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4];

// year → { month (1-12): weeks } for years that break the pattern.
const OVERRIDES: Record<number, Record<number, number>> = {};

const DAY = 86_400_000;

/** Monday (UTC midnight) of retail week 1 of `year`. */
function retailYearStart(year: number): number {
  const jan1 = Date.UTC(year, 0, 1);
  const dow = (new Date(jan1).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return jan1 - dow * DAY;
}

function weeksInRetailYear(year: number): number {
  return Math.round((retailYearStart(year + 1) - retailYearStart(year)) / (7 * DAY));
}

const isMonth = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;

/** Weeks in a retail month (month 1-12). */
export function weeksInRetailMonth(year: number, month: number): number {
  if (!isMonth(month)) return 0;
  const override = OVERRIDES[year]?.[month];
  if (override != null) return override;
  if (month === 12 && weeksInRetailYear(year) === 53) return 5;
  return PATTERN_454[month - 1];
}

/** True when `week` exists in that retail month. Month 0 or 13 is never valid. */
export function isValidRetailWeek(year: number, month: number, week: number): boolean {
  return Number.isInteger(year) && isMonth(month) &&
    Number.isInteger(week) && week >= 1 && week <= weeksInRetailMonth(year, month);
}

/** The retail (year, month, week) a date falls in. 29 Sep 2026 → Oct 2026 Wk1. */
export function retailPeriodOf(date: Date): { year: number; month: number; week: number } {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  let year = date.getFullYear() + 1;
  while (retailYearStart(year) > day) year--;
  let weekIdx = Math.floor((day - retailYearStart(year)) / (7 * DAY)); // 0-based
  for (let month = 1; month <= 12; month++) {
    const n = weeksInRetailMonth(year, month);
    if (weekIdx < n) return { year, month, week: weekIdx + 1 };
    weekIdx -= n;
  }
  // Only reachable if OVERRIDES disagree with the year's length; say December.
  return { year, month: 12, week: weeksInRetailMonth(year, 12) };
}

/**
 * Week options for a picker. When `current` is a week the month doesn't have
 * (an old "Sep Wk5" stamp), it stays in the list, flagged, so the select shows
 * what will actually be sent instead of silently displaying its first option.
 * An unknown month ("Auto") offers 1-5.
 */
export function retailWeekOptions(
  year: number | "",
  month: number | "",
  current: number | "" = "",
): { week: number; valid: boolean }[] {
  const n = year !== "" && month !== "" ? weeksInRetailMonth(year, month) : 5;
  const opts = Array.from({ length: n }, (_, i) => ({ week: i + 1, valid: true }));
  if (current !== "" && current > n) opts.push({ week: current, valid: false });
  return opts;
}

/** Sort key for a stamped period; same scale the ledgers use. */
export { periodScore };
