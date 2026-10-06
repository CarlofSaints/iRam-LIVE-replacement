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

   WHERE A YEAR'S WEEKS COME FROM, in order:
     1. a calendar PDF loaded in Control Centre → Retail Calendar
        (lib/retailCalendarData.ts stores it; registerRetailCalendar() puts it
        here, on the server per request and in the browser via
        useRetailCalendar());
     2. BUILT_IN below (2026, read off the printed calendar);
     3. the 4-5-4 pattern. A 53-week year then gives December the extra week,
        which is a GUESS — isRetailYearLoaded() lets screens say so.
   ────────────────────────────────────────────────────────────── */

import { periodScore } from "./dispoSnapshot";

/** year → weeks in each month, Jan..Dec (12 numbers). */
export type RetailCalendarYears = Record<number, number[]>;

const PATTERN_454 = [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4];

const BUILT_IN: RetailCalendarYears = {
  2026: [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4],
};

// Years loaded from a calendar PDF. Replaced wholesale, never merged, so a
// year deleted in the admin page stops counting on the next register.
let loaded: RetailCalendarYears = {};

export function registerRetailCalendar(years: RetailCalendarYears): void {
  loaded = { ...years };
}

/** The stored year records → the map registerRetailCalendar takes. */
export function toWeeksMap(years: { year: number; weeks: number[] }[]): RetailCalendarYears {
  const out: RetailCalendarYears = {};
  for (const y of years) out[y.year] = y.weeks;
  return out;
}

/** Running total of weeks: the retail week each month ends on. */
export function monthEndWeeksOf(weeks: number[]): number[] {
  let sum = 0;
  return weeks.map((w) => (sum += w));
}

const DAY = 86_400_000;

/** Monday (UTC midnight) of retail week 1 of `year`. */
function retailYearStart(year: number): number {
  const jan1 = Date.UTC(year, 0, 1);
  const dow = (new Date(jan1).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return jan1 - dow * DAY;
}

/** 52 or 53, from the "week 1 holds 1 January" rule. */
export function weeksInRetailYear(year: number): number {
  return Math.round((retailYearStart(year + 1) - retailYearStart(year)) / (7 * DAY));
}

/** 1 January's weekday, Mon=0 … Sun=6. */
export function jan1Weekday(year: number): number {
  return (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7;
}

const isMonth = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;

function yearWeeks(year: number): number[] | undefined {
  return loaded[year] ?? BUILT_IN[year];
}

/** True when this year's weeks came from a real calendar, not the pattern. */
export function isRetailYearLoaded(year: number): boolean {
  return !!yearWeeks(year);
}

/** Weeks in a retail month (month 1-12). */
export function weeksInRetailMonth(year: number, month: number): number {
  if (!isMonth(month)) return 0;
  const known = yearWeeks(year);
  if (known) return known[month - 1];
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
  // Only reachable if a loaded year disagrees with the year's length; say December.
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

/* ── Reading a Massmart planning-calendar PDF ─────────────────

   The PDF's text comes out as one block per month:

     Week Mon Tues Wed Thurs Fri Sat Sun
     27 1 2 3 4 5
     ...
     30 20 21 22 23 24 25 26
     R
     31 27 28 29 30 31

   A line that is only "R" marks the retail month end, and it always follows
   the row of the week that ends the month. The blocks are NOT in month order
   (the layout is three columns), and the year is drawn as a picture, so
   neither is read from the text. Instead:
     - collect the week number of every row an "R" follows → 12 month-end
       weeks; sorted, the gaps between them are the weeks per month;
     - the row "1 1 2 3 4" (week 1 starting on the 1st) says which weekday
       1 January fell on, which is checked against the year being loaded so a
       2026 PDF can't be saved as 2027. */

export interface ParsedRetailCalendar {
  weeks: number[];            // Jan..Dec
  monthEndWeeks: number[];    // retail week each month ends on
  jan1Weekday: number | null; // Mon=0 … Sun=6, as printed
}

const WEEK_ROW = /^(\d{1,2})((?:\s+\d{1,2})+)$/;

export function parseMassmartCalendarText(text: string): ParsedRetailCalendar {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ends = new Set<number>();
  let lastWeek: number | null = null;
  let jan1: number | null = null;

  for (const line of lines) {
    const row = line.match(WEEK_ROW);
    if (row) {
      lastWeek = Number(row[1]);
      const days = row[2].trim().split(/\s+/).map(Number);
      if (lastWeek === 1 && days[0] === 1 && jan1 === null) jan1 = 7 - days.length;
      continue;
    }
    if (line === "R") {
      if (lastWeek === null) throw new Error('Found a month-end "R" with no week row before it.');
      ends.add(lastWeek);
    }
    // Any other line ends the block, so a stray "R" can't attach to a row
    // from a different month.
    if (line !== "R") lastWeek = null;
  }

  const monthEndWeeks = [...ends].sort((a, b) => a - b);
  if (monthEndWeeks.length !== 12) {
    throw new Error(
      `Expected 12 retail month ends (the "R" marks), found ${monthEndWeeks.length}` +
      (monthEndWeeks.length ? ` (weeks ${monthEndWeeks.join(", ")})` : "") +
      ". Is this a Massmart planning calendar?",
    );
  }
  const weeks = monthEndWeeks.map((w, i) => w - (i === 0 ? 0 : monthEndWeeks[i - 1]));
  return { weeks, monthEndWeeks, jan1Weekday: jan1 };
}

/** Problems with saving `weeks` as `year`'s calendar; empty means fine. */
export function retailCalendarProblems(
  year: number,
  weeks: number[],
  printedJan1Weekday: number | null,
): string[] {
  const out: string[] = [];
  if (!Number.isInteger(year) || year < 2020 || year > 2100) out.push(`${year} is not a sensible year.`);
  if (weeks.length !== 12) out.push(`Need 12 months, got ${weeks.length}.`);
  const bad = weeks.findIndex((n) => !Number.isInteger(n) || n < 4 || n > 6);
  if (bad >= 0) out.push(`${MONTHS[bad + 1]} has ${weeks[bad]} weeks; a retail month has 4 to 6.`);
  const total = weeks.reduce((a, b) => a + b, 0);
  const expected = weeksInRetailYear(year);
  if (total !== expected) {
    out.push(`The months add up to ${total} weeks, but retail ${year} has ${expected} (week 1 is the week holding 1 January).`);
  }
  /* Required, not optional: without it a 2026 PDF saves cleanly as 2027 (both
     52 weeks, same 4-5-4 shape). */
  if (printedJan1Weekday === null || !Number.isInteger(printedJan1Weekday) || printedJan1Weekday < 0 || printedJan1Weekday > 6) {
    out.push(`Couldn't find the week-1 row (1 January) in the PDF, so can't confirm it is the ${year} calendar.`);
  } else if (printedJan1Weekday !== jan1Weekday(year)) {
    out.push(
      `This calendar starts 1 January on a ${WEEKDAYS[printedJan1Weekday]}, but 1 January ${year} is a ` +
      `${WEEKDAYS[jan1Weekday(year)]}. Wrong year picked, or the wrong year's PDF?`,
    );
  }
  return out;
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Sort key for a stamped period; same scale the ledgers use. */
export { periodScore };
