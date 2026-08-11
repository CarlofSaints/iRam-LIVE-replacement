/* Which DISPO owns a row's POINT-IN-TIME fields.

   A DISPO carries two very different kinds of column:

     • SALES (the monthly date columns) — history. Every DISPO that carries a
       month is a valid source for that month, and loading an old file is how
       missing history gets filled in. These accumulate.

     • SNAPSHOT (SOH, SOO, STO, PR ST, RP, MAC, Nett Cost, Incl SP, Curr Y/S …)
       — stock and prices AS AT the moment that DISPO was cut. There is exactly
       one right answer at any time, and it belongs to the most recent PERIOD.

   `mergeDispo` used to overwrite every non-date column with whatever loaded
   most recently in CLOCK time. So back-loading a June or a Wk3 file after the
   current Wk5 file replaced live stock with that older file's stock. Sales
   still looked correct — a closed month's total is identical in every DISPO
   that carries it — which is precisely why this showed up as "SOH doesn't
   match the DISPO" while everything else looked fine.

   The rule here: a snapshot may only be overwritten by a DISPO whose report
   period is the same or newer. Sales columns are untouched by this and keep
   merging from any period.                                                    */

/* Sortable period. Week is included because SOH genuinely differs week to week
   within a month, which is the case that started this. */
export function periodScore(year?: number | null, month?: number | null, week?: number | null): number {
  return (year || 0) * 10000 + (month || 0) * 100 + (week || 0);
}

/* May the incoming DISPO overwrite this row's snapshot fields?

   - No stamp on the existing row → yes. Every row pre-dates this change, so
     the first load after it takes ownership; refusing would freeze the whole
     ledger on values we can't date.
   - Equal period → yes. Re-loading the same week is how a bad file gets
     corrected, and that must still work.
   - Older period → NO. This is the fix.
   - Incoming has no period at all (score 0) → only when the existing row has
     none either, so an unstamped upload can't clobber a dated snapshot. */
export function snapshotWins(existingScore: unknown, incomingScore: number): boolean {
  const existing = typeof existingScore === "number" && isFinite(existingScore) ? existingScore : null;
  if (existing === null) return true;
  return incomingScore >= existing;
}

/* Columns exempt from the rule above — the ones that are history, not state.
   Date columns are handled by the caller (it holds the normalisation map);
   this covers our own internal fields, which carry their own year in the key
   (`_nettCost_2025`) or are load bookkeeping. */
export function isInternalField(col: string): boolean {
  return col.startsWith("_");
}

export const SNAPSHOT_PERIOD_FIELD = "_snapshotPeriod";
