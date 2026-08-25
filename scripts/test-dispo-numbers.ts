/* Two defects found 19 Aug 2026 while asking why a 1,382-row DISPO produced a
   363-row Vital Signs sheet (the row count was fine — the UOM collapse — but
   the numbers underneath were not):

     1. Quantity columns encode thousands with a PERIOD. 1,525 is written
        "1.525" and 1,500 is written "1.5", so the ledger took them as 1.525
        and 1.5. VERIGREEN's `Curr Y/S` read 41,404 units against 135,830.

     2. collapseUomRows kept only the selling-unit row, so every CASE, PALLET
        and LAYER sale was dropped. 52 of 354 keys on that one file.

   Run: npx tsx scripts/test-dispo-numbers.ts                                  */

import {
  isThousandsSuspect,
  readQty,
  readQtyScaled,
  detectPeriodThousands,
  applyPeriodThousands,
  applyWitnessedThousands,
} from "../lib/dispoNumbers";
import { collapseUomRows } from "../lib/dispoParser";

const collapseForTest = (rows: Record<string, unknown>[], cols: string[]) =>
  collapseUomRows(rows, cols).rows;

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

console.log("\n── Reading a period-separated thousand ──────────────────");
{
  // All four shapes seen in the real file, verified against its "**" lines.
  eq('"1.525" is 1525', readQtyScaled("1.525"), 1525);
  eq('"1.5" is 1500 (trailing zeros dropped)', readQtyScaled("1.5"), 1500);
  eq('"1.12" is 1120', readQtyScaled("1.12"), 1120);
  eq('"2.58" is 2580', readQtyScaled("2.58"), 2580);
  eq('"5.089" is 5089', readQtyScaled("5.089"), 5089);
  eq("a negative scales too", readQtyScaled("-1.5"), -1500);
  eq("a plain integer is untouched", readQtyScaled("265"), 265);
  eq("zero is untouched", readQtyScaled("0"), 0);
  eq("blank is zero", readQtyScaled(""), 0);
}

console.log("\n── What must NOT be treated as a thousand ───────────────");
{
  // Older DISPOs write six as "6.000". Scaling that would give 6000.
  ok('"6.000" is not a suspect', !isThousandsSuspect("6.000"));
  eq('"6.000" reads as 6', readQtyScaled("6.000"), 6);
  eq('"120.000" reads as 120', readQtyScaled("120.000"), 120);
  // Comma-separated files are the common case and already parse correctly.
  ok('"1,650" is not a suspect', !isThousandsSuspect("1,650"));
  eq('"1,650" reads as 1650', readQtyScaled("1,650"), 1650);
  eq('quoted "1,040.000" reads as 1040', readQtyScaled('"1,040.000"'), 1040);
  // Four or more digits before the point is not this format.
  ok('"1234.5" is not a suspect', !isThousandsSuspect("1234.5"));
  // A price is a genuine decimal — but prices are never passed in anyway.
  ok('"122.905" is a suspect by shape only', isThousandsSuspect("122.905"));
}

console.log("\n── Detection is decided by the file's own ** lines ──────");
{
  const COLS = ["07-2026"];
  // A group whose "**" total only reconciles if "1.5" means 1500:
  //   EA 1500 x 1  +  CS 1 x 25  =  1525
  const thousandsFile = [
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "1.5" },
    { Article: "A", Site: "M01", UOM: "CS", Compo: "25", "07-2026": "1" },
    { Article: "A", Site: "M01", UOM: "**", Compo: "1", "07-2026": "1.525" },
  ];
  const d1 = detectPeriodThousands(thousandsFile, COLS);
  ok("thousands file is detected", d1.applies);
  eq("  one pair judged", d1.judged, 1);
  eq("  it reconciles scaled", d1.reconciledScaled, 1);
  eq("  and not plain", d1.reconciledPlain, 0);

  // The same shape where the decimals are REAL: 1.5 + 1x25 = 26.5
  const decimalFile = [
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "1.5" },
    { Article: "A", Site: "M01", UOM: "CS", Compo: "25", "07-2026": "1" },
    { Article: "A", Site: "M01", UOM: "**", Compo: "1", "07-2026": "26.5" },
  ];
  const d2 = detectPeriodThousands(decimalFile, COLS);
  ok("a genuine decimal file is NOT rescaled", !d2.applies);
  eq("  it reconciles plain", d2.reconciledPlain, 1);

  // Massbuild-style: one row per Article|Site, no "**" line to judge by.
  const noOracle = [
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "1.5" },
  ];
  const d3 = detectPeriodThousands(noOracle, COLS);
  ok("no ** line means no rescale", !d3.applies);
  eq("  and the suspect is reported as unjudged", d3.unjudged, 1);

  // A file with nothing suspicious must be left completely alone.
  const clean = [
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "265" },
    { Article: "A", Site: "M01", UOM: "**", Compo: "1", "07-2026": "265" },
  ];
  const d4 = detectPeriodThousands(clean, COLS);
  ok("a clean file is not touched", !d4.applies);
  eq("  no suspects at all", d4.suspects, 0);

  // Mixed evidence must NOT trigger — one disagreeing key vetoes the rescale.
  const mixed = [
    ...thousandsFile,
    { Article: "B", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "2.5" },
    { Article: "B", Site: "M01", UOM: "CS", Compo: "25", "07-2026": "1" },
    { Article: "B", Site: "M01", UOM: "**", Compo: "1", "07-2026": "27.5" },
  ];
  const d5 = detectPeriodThousands(mixed, COLS);
  ok("one disagreeing key vetoes the whole file", !d5.applies);
}

console.log("\n── Massbuild files: a total cannot be less than its parts ─");
{
  // USABCO/MASSBUILD, found 25 Aug 2026. One row per Article|Site and no "**"
  // line anywhere, so the ** oracle above never fires — which is exactly why
  // these loaded ~1000x short for months while VERIGREEN was fixed.
  //
  // `Curr Y/S` is a running year-to-date on the same row as the months feeding
  // it. Site B14 claims 1.104 units YTD against 689 sold in six months. That is
  // not a judgement call, it is arithmetic.
  const COLS = ["Mar26", "Apr26", "May26", "Jun26", "Jul26", "Aug26", "Curr Y/S"];
  const PARTS = { Mar26: "82", Apr26: "185", May26: "168", Jun26: "172", Jul26: "74", Aug26: "8" };

  /** A Massbuild-shaped file: `n` ordinary whole-number rows plus whatever
      `extra` rows the case under test needs. */
  const massbuild = (n: number, extra: Record<string, unknown>[] = []) => [
    ...Array.from({ length: n }, (_, i) => ({
      Article: `A${i}`, Site: `B${i % 50}`, UOM: "EA", Compo: "1",
      ...PARTS, "Curr Y/S": String(700 + (i % 170)),
    })),
    ...extra,
  ];
  const suspectRow = { Article: "X", Site: "B14", UOM: "EA", Compo: "1", ...PARTS, "Curr Y/S": "1.104" };

  const d6 = detectPeriodThousands(massbuild(100, [suspectRow]), COLS);
  ok("a year-to-date below its own months is rescaled", d6.applies);
  eq("  on the totals-exceed-parts oracle", d6.basis, "totals-exceed-parts");
  eq("  one impossible plain reading", d6.impossiblePlain, 1);
  eq("  which scaling repairs", d6.repairedByScaling, 1);
  ok("  and the shape backs it up", d6.shape.ok);

  // The guard. Each of these on its own is proof the period means something
  // else, and each must veto the rescale on its own.
  const withBigNumber = detectPeriodThousands(
    massbuild(100, [suspectRow, { Article: "Z", Site: "B01", UOM: "EA", Compo: "1", ...PARTS, "Curr Y/S": "4207" }]),
    COLS,
  );
  ok("one plain value reaching 1000 vetoes it", !withBigNumber.applies,
    "the export can write a thousand without a separator, so it had no need of a period");
  eq("  and the suspect is reported instead", withBigNumber.unjudged, 1);

  const withComma = detectPeriodThousands(
    massbuild(100, [suspectRow, { Article: "Z", Site: "B01", UOM: "EA", Compo: "1", ...PARTS, "Curr Y/S": "4,207" }]),
    COLS,
  );
  ok("one comma-separated value vetoes it", !withComma.applies,
    "this export separates thousands with a comma, so a period is a decimal point");

  // A file measured in kg or litres. Note "12.75" would NOT do here — by shape
  // it is indistinguishable from 12,750, and that is the point: what saves such
  // a file is that fractions are its CONVENTION, not a rare tail. So the guard
  // that has to hold is the share, and separately the presence of fractions no
  // period-thousand could produce (four decimal places).
  const fractional = detectPeriodThousands(
    massbuild(100, [
      suspectRow,
      ...Array.from({ length: 40 }, (_, i) => ({
        Article: `KG${i}`, Site: "B01", UOM: "KG", Compo: "1", ...PARTS, "Curr Y/S": "12.5",
      })),
    ]),
    COLS,
  );
  ok("a file where fractions are the convention vetoes it", !fractional.applies,
    "40 fractional quantities is a unit of measure, not a handful of items past a thousand");

  const fourPlaces = detectPeriodThousands(
    massbuild(100, [suspectRow, { Article: "Z", Site: "B01", UOM: "KG", Compo: "1", ...PARTS, "Curr Y/S": "12.3456" }]),
    COLS,
  );
  ok("one fraction no thousands separator could make vetoes it", !fourPlaces.applies,
    "12.3456 is a real decimal, so this file's periods are decimal points");

  const tooSmall = detectPeriodThousands(massbuild(2, [suspectRow]), COLS);
  ok("a handful of rows is not a corpus", !tooSmall.applies);

  // No witness: 1.5 with nothing on the row to contradict it stays put.
  const noWitness = detectPeriodThousands(
    massbuild(100, [{ Article: "X", Site: "B14", UOM: "EA", Compo: "1", Mar26: "1", "Curr Y/S": "1.5" }]),
    COLS,
  );
  ok("shape alone is not enough — something must be impossible", !noWitness.applies);
  eq("  nothing was contradicted", noWitness.impossiblePlain, 0);

  // The keyless footer row carries the same proof when no single row does. It
  // spans the whole report, so it can never be less than this file's own sum.
  // The 100 rows above carry 700..799 in `Curr Y/S`, so this file sums to
  // 74,950 — a grand total of sixty-nine is impossible, one of 98,354 is not.
  const footer = { Article: "", Site: "", UOM: "", Compo: "", ...PARTS, "Curr Y/S": "98.354" };
  const d7 = detectPeriodThousands(massbuild(100, [footer]), COLS);
  ok("a grand total below the rows it totals is rescaled", d7.applies);
  eq("  on the same oracle", d7.basis, "totals-exceed-parts");
  ok("  the footer's suspects are counted", d7.suspects >= 1);

  // The ** oracle stays in charge wherever it has anything to say: a file whose
  // ** lines vote "genuine decimals" must NOT be overridden by shape.
  const starSaysDecimal = detectPeriodThousands(
    [...massbuild(100), ...[
      { Article: "A", Site: "M01", UOM: "EA", Compo: "1", ...PARTS, "Curr Y/S": "1.5" },
      { Article: "A", Site: "M01", UOM: "CS", Compo: "25", ...PARTS, "Curr Y/S": "1" },
      { Article: "A", Site: "M01", UOM: "**", Compo: "1", ...PARTS, "Curr Y/S": "26.5" },
    ]],
    COLS,
  );
  ok("a ** verdict of 'genuine decimals' is not overridden", !starSaysDecimal.applies);
  ok("  because that ** line discriminated", starSaysDecimal.informative > 0);

  // …but a ** line on a group that sells in ONE uom is a copy of the selling
  // row. It reconciles whichever way you read it, so it has no verdict to give
  // and must not veto Oracle 2. CARTOON CANDY 8149 Jul-2026 Wk1: one EA line at
  // "2.248" with empty PAL and LAY lines, and a ** line reading "2.248" too.
  const starIsACopy = detectPeriodThousands(
    [...massbuild(100), ...[
      { Article: "A", Site: "W24", UOM: "EA", Compo: "1", ...PARTS, "Curr Y/S": "2.248" },
      { Article: "A", Site: "W24", UOM: "PAL", Compo: "184", ...PARTS, "Curr Y/S": "0" },
      { Article: "A", Site: "W24", UOM: "**", Compo: "1", ...PARTS, "Curr Y/S": "2.248" },
    ]],
    COLS,
  );
  eq("a ** line that reconciles both ways is no verdict", starIsACopy.informative, 0);
  ok("  so the second oracle still gets to look", starIsACopy.applies);
  eq("  and it rescales", starIsACopy.basis, "totals-exceed-parts");

  // LIBRA MARKETING 119 Aug-2026 Wk3 — the case that decides how MUCH gets
  // rewritten. SKI ROPE is sold by the metre, so "1.5" in a month column is a
  // real metre and a half; on another row a `Curr Y/S` of "1.065" is a real
  // 1,065. The file passes the shape guard, so a file-wide rescale would have
  // turned that rope into 1,500m. Only the witnessed cell may move.
  const rope = { Article: "38809", Site: "I004", UOM: "M", Compo: "1", ...PARTS, Jul26: "1.5", "Curr Y/S": "347" };
  const specOrd = { Article: "740103", Site: "M500", UOM: "EA", Compo: "1", Apr26: "15", "Curr Y/S": "1.065" };
  const mixedRows = [...massbuild(100), rope, specOrd];
  const d8 = detectPeriodThousands(mixedRows, [...COLS, "Jul26"]);
  ok("a per-metre file still gets its impossible totals fixed", d8.applies);
  const moved = applyWitnessedThousands(mixedRows, [...COLS, "Jul26"]);
  eq("  the special-order year-to-date is corrected", specOrd["Curr Y/S"], 1065);
  eq("  the metre and a half is left alone", rope.Jul26, "1.5");
  ok("  and the ones left alone are reported", d8.unjudged > 0);
  ok("  only witnessed cells moved", moved < d8.suspects,
    `moved ${moved} of ${d8.suspects} suspects`);
}

console.log("\n── Rescaling only touches the quantity columns ──────────");
{
  const rows = [
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", "07-2026": "1.5", "Incl SP": "43.99", MAC: "122.905" },
  ];
  const changed = applyPeriodThousands(rows, ["07-2026", "Curr Y/S"]);
  eq("one cell changed", changed, 1);
  eq("  the quantity is scaled", rows[0]["07-2026"], 1500);
  eq("  the selling price is untouched", rows[0]["Incl SP"], "43.99");
  eq("  MAC is untouched", rows[0]["MAC"], "122.905");
  ok("  a column not present is skipped without error", true);
}

console.log("\n── The \"**\" line is a CROSS-CHECK, never the value ─────");
{
  /* Sales are Σ(units × Compo) over the UOM lines. The "**" total row usually
     equals that, but it is NOT written in a consistent unit across exports, and
     an earlier version of this fix took its value directly — which zeroed or
     twelfthed real sales on two clients. Each case below is a real file. */
  const COLS = ["07-2026"];
  const run = (rows: Record<string, unknown>[]) => {
    const r = collapseForTest(rows, COLS);
    return r[0]["07-2026"];
  };

  // VERIGREEN 9677 / Rhodes 10225: "**" in base units, agrees with the sum.
  eq("32 eaches + 1 case of 25 is 57", run([
    { Article: "A", Site: "M07", UOM: "EA", Compo: "1", SOH: "100", "07-2026": "32" },
    { Article: "A", Site: "M07", UOM: "CS", Compo: "25", SOH: "0", "07-2026": "1" },
    { Article: "A", Site: "M07", UOM: "**", Compo: "1", SOH: "0", "07-2026": "57" },
  ]), 57);

  // Rhodes 10225 at M16 — the selling row is a sliver of the real number.
  eq("1,847 eaches + 16,029 shrink-wraps of 6 is 98,021", run([
    { Article: "A", Site: "M16", UOM: "EA", Compo: "1", SOH: "500", "07-2026": "1847" },
    { Article: "A", Site: "M16", UOM: "SW", Compo: "6", SOH: "0", "07-2026": "16029" },
    { Article: "A", Site: "M16", UOM: "**", Compo: "1", SOH: "0", "07-2026": "98021" },
  ]), 98021);

  // SERANO 7629 (Jun): "**" is all zeros while the EA line has real sales.
  // Taking "**" would have wiped these.
  eq("an all-zero ** does not wipe the EA line", run([
    { Article: "A", Site: "A01", UOM: "EA", Compo: "1", SOH: "50", "07-2026": "3" },
    { Article: "A", Site: "A01", UOM: "CS", Compo: "18", SOH: "0", "07-2026": "0" },
    { Article: "A", Site: "A01", UOM: "**", Compo: "1", SOH: "0", "07-2026": "0" },
  ]), 3);

  // BISCO 10548 (Jun): "**" is written in ORDER units — EA 8, "**" 1.
  eq("an order-unit ** does not shrink the EA line", run([
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", SOH: "40", "07-2026": "8" },
    { Article: "A", Site: "M01", UOM: "CS", Compo: "12", SOH: "0", "07-2026": "0" },
    { Article: "A", Site: "M01", UOM: "**", Compo: "1", SOH: "0", "07-2026": "1" },
  ]), 8);

  // A group with no "**" line at all still sums its UOM rows.
  eq("no ** line is fine — the sum stands", run([
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", SOH: "40", "07-2026": "10" },
    { Article: "A", Site: "M01", UOM: "CS", Compo: "12", SOH: "0", "07-2026": "2" },
  ]), 34);

  // A repeated UOM is NOT a clean UOM listing — it may be the direct-from-vendor
  // / via-DC pair the Article|Site key cannot represent. Fall back, do not sum.
  // The fallback returns the selling row UNTOUCHED, so its value is still the
  // raw string — only the summing path produces a number. That distinction is
  // deliberate: a row we did not compute is a row we did not alter.
  eq("a repeated UOM falls back to the selling row, unaltered", run([
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", SOH: "40", "07-2026": "10" },
    { Article: "A", Site: "M01", UOM: "EA", Compo: "1", SOH: "5", "07-2026": "7" },
  ]), "10");

  // Stock, prices and status keep coming off the selling row.
  {
    const r = collapseForTest([
      { Article: "A", Site: "M07", UOM: "EA", Compo: "1", SOH: "1040", "Incl SP": "48.95", "07-2026": "32" },
      { Article: "A", Site: "M07", UOM: "CS", Compo: "25", SOH: "0", "Incl SP": "1194.95", "07-2026": "1" },
    ], COLS);
    eq("SOH is the selling row's", r[0]["SOH"], "1040");
    eq("the price is the selling row's, not the case price", r[0]["Incl SP"], "48.95");
    eq("the UOM is the selling unit", r[0]["UOM"], "EA");
  }

  // A single row per Article|Site (Massbuild) must NOT be multiplied by Compo.
  eq("a lone row is never multiplied by its pack size", run([
    { Article: "A", Site: "M01", UOM: "CS", Compo: "12", SOH: "40", "07-2026": "9" },
  ]), "9");
}

console.log("\n── readQty stays the plain reading ──────────────────────");
{
  eq("commas stripped", readQty("1,650"), 1650);
  eq("quotes stripped", readQty('"1,040.000"'), 1040);
  eq("a period is a decimal point here", readQty("1.5"), 1.5);
  eq("junk is zero", readQty("n/a"), 0);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
