/* Point-in-time DISPO fields must not be rolled back by an older load.
   Run: npx tsx scripts/test-dispo-snapshot.ts                                 */

import { periodScore, snapshotWins, isInternalField, SNAPSHOT_PERIOD_FIELD } from "../lib/dispoSnapshot";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const P = (y: number, m: number, w: number) => periodScore(y, m, w);

console.log("\n── Periods order the way a human would ──────────────────");
{
  ok("later week beats earlier week", P(2026, 7, 5) > P(2026, 7, 3));
  ok("later month beats earlier month", P(2026, 7, 1) > P(2026, 6, 5));
  ok("later year beats earlier year", P(2026, 1, 1) > P(2025, 12, 5));
  // Week 5 exists and must not overflow into the month.
  ok("week 5 does not spill into the next month", P(2026, 7, 5) < P(2026, 8, 1));
  eq("no period at all scores zero", periodScore(undefined, undefined, undefined), 0);
}

console.log("\n── The bug: an OLDER dispo must not roll stock back ─────");
{
  // The reported case: Wk5 is loaded, then a historical file is back-loaded and
  // replaces live stock with the older file's stock.
  ok("Wk3 loaded after Wk5 does NOT take the snapshot", !snapshotWins(P(2026, 7, 5), P(2026, 7, 3)));
  ok("June loaded after July does NOT take the snapshot", !snapshotWins(P(2026, 7, 5), P(2026, 6, 5)));
  ok("last year loaded after this year does NOT", !snapshotWins(P(2026, 7, 5), P(2025, 7, 5)));
}

console.log("\n── But normal loading still works ───────────────────────");
{
  ok("a newer week takes the snapshot", snapshotWins(P(2026, 7, 3), P(2026, 7, 5)));
  ok("a newer month takes it", snapshotWins(P(2026, 6, 5), P(2026, 7, 1)));
  // Re-loading the same week is how a bad file gets corrected — it must win.
  ok("the SAME period takes it (re-upload to correct a file)", snapshotWins(P(2026, 7, 5), P(2026, 7, 5)));
}

console.log("\n── Rows that pre-date this change ───────────────────────");
{
  // Every existing ledger row is unstamped. If those refused updates the whole
  // ledger would freeze on values we cannot date.
  ok("an unstamped row accepts the next load", snapshotWins(undefined, P(2026, 7, 5)));
  ok("a null stamp accepts it", snapshotWins(null, P(2026, 7, 5)));
  ok("a junk stamp accepts it", snapshotWins("nonsense", P(2026, 7, 5)));
  ok("NaN is not treated as a real period", snapshotWins(NaN, P(2026, 7, 5)));
}

console.log("\n── An unstamped UPLOAD can't clobber a dated snapshot ───");
{
  // Period is optional on an upload. A file with no period must not outrank a
  // row we know the date of...
  ok("no-period upload loses to a dated snapshot", !snapshotWins(P(2026, 7, 5), 0));
  // ...but two unknowns are a tie, and the newer load wins, which is the old
  // behaviour and the only sensible answer.
  ok("no-period upload still writes an undated row", snapshotWins(undefined, 0));
  ok("no-period vs no-period is a tie the loader wins", snapshotWins(0, 0));
}

console.log("\n── Internal fields keep their own behaviour ─────────────");
{
  ok("_nettCost_2025 is internal", isInternalField("_nettCost_2025"));
  ok("_vendor is internal", isInternalField("_vendor"));
  ok("_lastLoadedAt is internal", isInternalField("_lastLoadedAt"));
  ok("the stamp field is itself internal", isInternalField(SNAPSHOT_PERIOD_FIELD));
  ok("SOH is NOT internal — it is a snapshot", !isInternalField("SOH"));
  ok("Nett Cost is NOT internal", !isInternalField("Nett Cost"));
  ok("a date column is NOT internal", !isInternalField("07-2026"));
}

console.log("\n── The whole scenario, end to end ───────────────────────");
{
  /* Replays what happened: Wk5 sets stock to 44, then a back-loaded Wk3 file
     carrying stock 273 arrives. Sales for the closed month are identical in
     both files, which is exactly why sales looked right while SOH did not. */
  const row: Record<string, unknown> = {};
  const apply = (soh: number, jul: number, score: number) => {
    const take = snapshotWins(row[SNAPSHOT_PERIOD_FIELD], score);
    if (take) { row["SOH"] = soh; row[SNAPSHOT_PERIOD_FIELD] = score; }
    row["07-2026"] = jul;      // sales always merge, whatever the period
  };

  apply(44, 900, P(2026, 7, 5));     // the current file
  eq("current load sets stock", row["SOH"], 44);

  apply(273, 900, P(2026, 7, 3));    // the back-load that caused this
  eq("the back-load does NOT touch stock", row["SOH"], 44);
  eq("but its sales still merge", row["07-2026"], 900);
  eq("and the stamp stays on the newer period", row[SNAPSHOT_PERIOD_FIELD], P(2026, 7, 5));

  apply(51, 950, P(2026, 8, 1));     // next month's real load
  eq("a genuinely newer load does update stock", row["SOH"], 51);
  eq("and moves the stamp forward", row[SNAPSHOT_PERIOD_FIELD], P(2026, 8, 1));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
