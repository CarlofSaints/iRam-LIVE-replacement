/* ──────────────────────────────────────────────────────────────
   Massmart retail calendar: how many weeks each month has.

   Massmart (Makro, Game, Builders, Walmart) report on a 4-5-4 retail
   calendar: each quarter is a 4-week month, a 5-week month, then a 4-week
   month. Weeks run Monday to Sunday. Source: "Massmart 2026 Planning
   Calendar-A3.pdf" (the "R" marks are the retail month ends):

     Jan 4 · Feb 5 · Mar 4 · Apr 4 · May 5 · Jun 4
     Jul 4 · Aug 5 · Sep 4 · Oct 4 · Nov 5 · Dec 4

   So Sep 2026 has NO Week 5. The Data Load picker offered Weeks 1-5 for every
   month, and on 5-6 Oct 2026 about 50 early-October DISPOs were stamped
   "Sep Wk5" (retail week 40, 28 Sep to 4 Oct, is Oct Wk1).

   A 53-week retail year puts an extra week into one month. When Massmart
   publishes one, add that year to OVERRIDES rather than changing the pattern.
   ────────────────────────────────────────────────────────────── */

const PATTERN_454 = [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4];

// year → { month (1-12): weeks } for years that break the 4-5-4 pattern.
const OVERRIDES: Record<number, Record<number, number>> = {};

/** Weeks in a retail month (month is 1-12). Unknown input gets 5, never fewer. */
export function weeksInRetailMonth(year: number, month: number): number {
  const override = OVERRIDES[year]?.[month];
  if (override) return override;
  return PATTERN_454[month - 1] ?? 5;
}

/** True when `week` exists in that retail month. */
export function isValidRetailWeek(year: number, month: number, week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= weeksInRetailMonth(year, month);
}
