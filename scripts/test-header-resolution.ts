/* Header + date-column resolution, pinned to the REAL values found in the
   corpus of 667 uploaded DISPOs (sampled per client × channel × upload month,
   111 groups, 12 Aug 2026).

   Run: npx tsx scripts/test-header-resolution.ts
*/

import { resolveHeader, DATE_COL_REGEX } from "../lib/headers";
import { normalizeDateCol } from "../lib/salesData";

let pass = 0;
const fails: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── 1. Long-form Massbuild/SAP headers must resolve to the canonical name ──
// Every one of these was found live and was passing through unresolved, which
// is what left 43 uploads with no vendor number.
const LONG_FORM: [string, string][] = [
  ["Vendor Number", "Vendor"],
  ["VENDOR NUMBER", "Vendor"],            // Genkem exports it upper-cased
  ["Rounding Profile", "R. Profile"],
  ["Promotion SP", "Prom SP"],
  ["Last Receipt Date", "Last Recv"],
  ["Last Sold Date", "Last Sold"],
  ["Base Merchandise Category", "BMC"],
  ["BASE MERCHANDISE CATEGORY", "BMC"],
  ["Vendor Product Code", "Vendor Prod Code"],
  ["Terms of Payment", "P Term"],
  ["Future Prom", "Future Promo"],
];
for (const [raw, want] of LONG_FORM) eq(resolveHeader(raw), want, `resolveHeader("${raw}")`);

// The short style must keep working exactly as before.
const SHORT_FORM: [string, string][] = [
  ["Vendor", "Vendor"],
  ["R. Profile", "R. Profile"],
  ["Prom SP", "Prom SP"],
  ["Last Recv", "Last Recv"],
  ["PR ST", "Status"],
  ["Article Desc", "Article Desc"],
  ["vend prod", "Vendor Prod Code"],
];
for (const [raw, want] of SHORT_FORM) eq(resolveHeader(raw), want, `resolveHeader("${raw}")`);

// "Description" appears ALONGSIDE "Article Desc" in 13 live files, so it is a
// different column and must NOT be folded into it.
eq(resolveHeader("Description"), "Description", 'resolveHeader("Description") stays put');

// Extra columns with no canonical equivalent pass through untouched.
for (const raw of ["Free Stock", "Seq No", "KMC", "EMT", "Tally", "EcoWise", "Buyer", "STO", "Excl SP", "ATP"]) {
  eq(resolveHeader(raw), raw, `resolveHeader("${raw}") passes through`);
}

// ── 2. Date columns: every shape seen in the corpus ──
const DATES: [string, string | null][] = [
  // already working
  ["Jul26", "07-2026"],
  ["Jun26", "06-2026"],
  ["Jul25", "07-2025"],
  ["Jul-2026", "07-2026"],
  ["July-2026", "07-2026"],
  ["Jan-2025", "01-2025"],
  ["07-2026", "07-2026"],
  ["2026-07", "07-2026"],
  // "Sept" was detected as a date column but MONTH_MAP had no entry, so it
  // normalised to null and the month was dropped at merge.
  ["Sept-2025", "09-2025"],
  // year-first + month name (Vermont, Topline, Clippa, Safe Top)
  ["26-Jul", "07-2026"],
  ["26-Feb", "02-2026"],
  ["25-Jul", "07-2025"],
  // Excel-rendered date serials (Cartoon Candy). The neighbouring "Sept-2025"
  // column proves these are month-first: Aug, Oct, Nov, Dec 2025.
  ["8/1/25", "08-2025"],
  ["10/1/25", "10-2025"],
  ["11/1/25", "11-2025"],
  ["12/1/25", "12-2025"],
  // day-first is unambiguous when the first part can't be a month
  ["25/8/25", "08-2025"],
  // not date columns
  ["Curr Y/S", null],
  ["Compo", null],
  ["Vendor Number", null],
  ["Free Stock", null],
  ["Description", null],
];
for (const [raw, want] of DATES) {
  eq(normalizeDateCol(raw), want, `normalizeDateCol("${raw}")`);
  // Anything that normalises must also be DETECTED, or mergeDispo never asks.
  if (want !== null) eq(DATE_COL_REGEX.test(raw), true, `DATE_COL_REGEX detects "${raw}"`);
}

// Ordinary text headers must never be mistaken for a date column — that would
// turn a real field into a sales month.
for (const raw of ["Compo", "Curr Y/S", "Status", "Buyer", "Free Stock", "Class", "Exch. Rate"]) {
  eq(DATE_COL_REGEX.test(raw), false, `DATE_COL_REGEX rejects "${raw}"`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All header + date-column assertions passed.\n");
