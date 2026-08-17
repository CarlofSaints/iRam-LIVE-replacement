/* Pack-price snapshot detection and repair.
   Run: npx tsx scripts/test-price-snapshot-repair.ts

   The numbers below are REAL — taken from VERIGREEN's 9677 Aug-2026 Wk2 DISPO
   and from the Month-End workbook Carl flagged on 17 Aug 2026 — so a change to
   the threshold shows up here as a behaviour change on live data, not as an
   abstract unit test. */

import {
  classifySnapshot,
  repairRow,
  repairLedger,
  PACK_PRICE_RATIO,
} from "../lib/priceSnapshotRepair";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── The real prices off SUPA MAMA VALUE REFUSE BAGS 20'S, store M26 ──
// EA 48.95 · CS 1194.95 (case of 25) · PAL nett 25929.00 (pallet of 900)
eq(classifySnapshot(1194.95, 48.95).verdict, "poisoned", "case price against the each price");
eq(classifySnapshot(720.25, 28.81).verdict, "poisoned", "case NETT cost against the each cost");
eq(classifySnapshot(25929, 28.81).verdict, "poisoned", "pallet cost against the each cost");
eq(classifySnapshot(374.04, 31.17).verdict, "poisoned", "415952's 12-pack cost — the smallest real multiple");
eq(classifySnapshot(48.95, 48.95).verdict, "ok", "an unchanged price is not poisoned");

// ── Real year-on-year movement must survive ──
eq(classifySnapshot(44.95, 48.95).verdict, "ok", "last year's price was lower — normal");
eq(classifySnapshot(48.95, 44.95).verdict, "ok", "…and the other way round");
eq(classifySnapshot(29.99, 59.99).verdict, "ok", "even a 2x repricing is left alone");
eq(classifySnapshot(59.99, 29.99).verdict, "ok", "…in both directions");
eq(PACK_PRICE_RATIO, 3, "threshold is 3x — the corridor between a repricing and a 12-pack");

// ── The asymmetry: a LOW snapshot means the LIVE column is the pack one ──
// 55 of 345 VERIGREEN rows are in this state. Deleting here would swap good
// history for a bad current price, which is worse than doing nothing.
eq(classifySnapshot(48.95, 1194.95).verdict, "live-suspect", "snapshot fine, live price is the case");
const liveBad: Record<string, unknown> = { "Incl SP": 1194.95, _inclSP_2025: 48.95 };
const rLive = repairRow(liveBad, { apply: true });
eq(rLive.removed, [], "nothing is deleted when the LIVE price is the suspect one");
eq(rLive.liveSuspect, true, "…but the row is reported");
eq(liveBad._inclSP_2025, 48.95, "…and the good snapshot is still there");

// ── No usable reference → leave it alone, say so ──
eq(classifySnapshot(1194.95, 0).verdict, "unknown", "no live price to judge against");
eq(classifySnapshot(1194.95, null).verdict, "unknown", "…missing entirely");
eq(classifySnapshot(0, 48.95).verdict, "ok", "an empty snapshot is nothing to fix");
eq(classifySnapshot(null, 48.95).verdict, "ok", "…as is an absent one");

// ── Strings, blanks and Rand-formatted values all parse ──
eq(classifySnapshot("1194.95", "48.95").verdict, "poisoned", "numeric strings");
eq(classifySnapshot("1,194.95", "48.95").verdict, "poisoned", "thousands separators");
eq(classifySnapshot("R 1194.95", "R 48.95").verdict, "poisoned", "a Rand prefix");
eq(classifySnapshot("", "48.95").verdict, "ok", "blank string is nothing to fix");

// ── A dry run must not touch the row ──
const dry: Record<string, unknown> = { "Incl SP": 48.95, _inclSP_2025: 1194.95 };
const rDry = repairRow(dry, { apply: false });
eq(rDry.removed, ["_inclSP_2025"], "dry run still reports what it would remove");
eq(dry._inclSP_2025, 1194.95, "…and changes nothing");
repairRow(dry, { apply: true });
eq("_inclSP_2025" in dry, false, "apply deletes the key outright, so priceForYear falls back");

// ── All three families, several years, on one row ──
const wide: Record<string, unknown> = {
  "Incl SP": 48.95, "Prom SP": 0, "Nett Cost": 28.81,
  _inclSP_2024: 1194.95,   // poisoned
  _inclSP_2025: 44.95,     // fine
  _inclSP_2026: 48.95,     // fine
  _nettCost_2024: 720.25,  // poisoned
  _nettCost_2025: 27.5,    // fine
  _promSP_2024: 1100,      // poisoned — judged against Incl SP, since Prom SP is 0
  _promSP_2025: 0,         // empty, nothing to fix
};
const rWide = repairRow(wide, { apply: true });
eq(rWide.removed.sort(), ["_inclSP_2024", "_nettCost_2024", "_promSP_2024"], "every family, only the bad year");
eq(wide._inclSP_2025, 44.95, "a good year is untouched");
eq(wide._nettCost_2025, 27.5, "…in every family");
eq(wide["Incl SP"], 48.95, "the live columns are never touched — those heal on the next load");

// ── A live Prom SP, when there is one, is what a promo snapshot is judged on ──
const promo: Record<string, unknown> = { "Incl SP": 48.95, "Prom SP": 39.95, _promSP_2025: 37.5 };
eq(repairRow(promo, { apply: true }).removed, [], "a real promo price survives");

// ── Non-snapshot underscore fields are not ours to touch ──
const bookkeeping: Record<string, unknown> = {
  "Incl SP": 48.95, _vendor: "9677", _lastLoadedAt: "2026-08-17", _snapshotPeriod: 20260802,
  _inclSP_1999: 5000, _inclSP_abc: 5000,
};
const rBook = repairRow(bookkeeping, { apply: true });
eq(rBook.removed, [], "no year in range, nothing removed");
eq(bookkeeping._vendor, "9677", "load bookkeeping is left alone");
eq(bookkeeping._snapshotPeriod, 20260802, "…including the snapshot period stamp");

// ── Ledger sweep ──
const ledger: Record<string, unknown>[] = [
  { "Incl SP": 48.95, "Nett Cost": 28.81, _inclSP_2025: 1194.95, _nettCost_2025: 720.25 },
  { "Incl SP": 48.95, "Nett Cost": 28.81, _inclSP_2025: 44.95 },
  { "Incl SP": 43.99, "Nett Cost": 374.04, _inclSP_2025: 43.99 }, // live nett is the pack one
  { "Incl SP": 0, _inclSP_2025: 1194.95 },                        // no reference
];
const before = JSON.stringify(ledger);
const preview = repairLedger(ledger, { apply: false });
eq(JSON.stringify(ledger), before, "preview leaves the ledger byte-identical");
eq(preview.rows, 4, "row count");
eq(preview.rowsRepaired, 1, "one row would be repaired");
eq(preview.fieldsRemoved, 2, "two fields on it");
eq(preview.byField, { _inclSP_2025: 1, _nettCost_2025: 1 }, "counted per field");
eq(preview.unknownRows, 1, "the row with no live price is reported, not guessed at");

const applied = repairLedger(ledger, { apply: true });
eq(applied.fieldsRemoved, 2, "apply removes the same two");
eq("_inclSP_2025" in ledger[0], false, "…and they are gone");
eq(ledger[1]._inclSP_2025, 44.95, "a healthy row is untouched");
eq(ledger[3]._inclSP_2025, 1194.95, "an unjudgeable row is left for a human");
eq(repairLedger(ledger, { apply: true }).fieldsRemoved, 0, "running it twice is a no-op");

// ── The bug this exists for, end to end ──
// 16,807 units of 08-2025. At the case price the report read R13.9m; at the each
// price it is R775k ex-VAT. After the repair the row has no 2025 snapshot, so
// priceForYear falls back to the live price and the units are valued sanely.
const verigreen: Record<string, unknown> = { "Incl SP": 48.95, "Prom SP": 0, _inclSP_2025: 1194.95, "08-2025": 842 };
repairRow(verigreen, { apply: true });
const priceUsed = Number(verigreen._inclSP_2025 ?? verigreen["Incl SP"]) / 1.15;
eq(Math.round(priceUsed * 842), 35840, "842 units now value at R35,840, not R874,918");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All price-snapshot repair assertions passed.\n");
