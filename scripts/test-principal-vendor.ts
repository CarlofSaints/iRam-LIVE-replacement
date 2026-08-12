/* Which vendor a SKU belongs to, via the PMF's PRODUCT PRINCIPLE.
   Run: npx tsx scripts/test-principal-vendor.ts */

import { buildPrincipalMap, principalCoverage, resolveVendors, conflictSheetRows } from "../lib/principalVendor";
import { autoMatchHeaders } from "../lib/productMasterData";
import type { ProductMaster } from "../lib/types";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── The column the PMFs actually use must auto-match ──
// "PRODUCT PRINCIPLE" (their spelling) is in 13 of the 14 PMFs sampled.
eq(autoMatchHeaders(["CLIENT PRODUCT ID", "PRODUCT PRINCIPLE"]).principal, "PRODUCT PRINCIPLE",
  'autoMatchHeaders finds "PRODUCT PRINCIPLE"');
eq(autoMatchHeaders(["Product Principal"]).principal, "Product Principal", "…and the correct spelling");
eq(autoMatchHeaders(["Principal"]).principal, "Principal", "…and the bare form");
eq(autoMatchHeaders(["PRODUCT BRAND"]).principal, undefined, "…and nothing when absent");

// ── Tolerant read: only a declared vendor number counts ──
// The column was filled in with whatever was to hand, so names must be ignored
// rather than treated as vendors — that is what lets the PMFs be corrected SKU
// by SKU instead of all at once.
const DECLARED = ["1063", "280"];
const products: ProductMaster[] = [
  { clientProductId: "CP1", principal: "1063" },      // done
  { clientProductId: "CP2", principal: "280" },       // done
  { clientProductId: "CP3", principal: "Addis" },     // still a name
  { clientProductId: "CP4", principal: "9999" },      // a number, but not this client's
  { clientProductId: "CP5" },                         // blank
];
const pmap = buildPrincipalMap(products, DECLARED);
eq(pmap.get("CP1"), "1063", "a declared vendor number is used");
eq(pmap.get("CP2"), "280", "…for each vendor");
eq(pmap.has("CP3"), false, "a name is ignored, not guessed at");
eq(pmap.has("CP4"), false, "a number that isn't this client's is ignored");
eq(pmap.has("CP5"), false, "blank is ignored");

eq(principalCoverage(products, DECLARED), { total: 5, withPrincipal: 4, usable: 2 },
  "coverage separates 'filled in' from 'usable'");

// ── Resolution order ──
const links = new Map([["a1", "CP1"], ["a2", "CP2"], ["a3", "CP3"], ["a9", "CP9"]]);

// The case this was built for: a multi-vendor DISPO with DC lines. Without the
// PMF, A2's DC row would inherit or fall back to the dominant vendor (1063)
// and be attributed to the wrong vendor entirely.
const rows: Record<string, unknown>[] = [
  { Vendor: "1063", Article: "A1" },   // stated outright
  { Vendor: "D102", Article: "A2" },   // DC line — PMF says 280
  { Vendor: "D102", Article: "A3" },   // DC line — PMF has only a name
  { Vendor: "D102", Article: "A9" },   // DC line — nothing anywhere
];
const res = resolveVendors(rows, links, pmap, "1063");

eq(rows[0]["_vendor"], "1063", "numeric cell wins");
eq(rows[0]["_vendorSource"], "cell", "…and is recorded as such");
eq(rows[1]["_vendor"], "280", "DC line takes the PMF principal — NOT the dominant vendor");
eq(rows[1]["_vendorSource"], "pmf", "…recorded as coming from the PMF");
eq(rows[2]["_vendor"], "1063", "no usable principal ⇒ falls back");
eq(rows[3]["_vendorSource"], "fallback", "…and an unmatched article is a guess");
eq(res.counts, { cell: 1, pmf: 1, inherited: 0, fallback: 2, none: 0 }, "counts by source");
eq(res.unresolved, 2, "guesses are counted, not hidden");

// Same-article inheritance still works where the PMF can't help.
const inheritRows: Record<string, unknown>[] = [
  { Vendor: "280", Article: "A3" },
  { Vendor: "D102", Article: "A3" },
];
const res2 = resolveVendors(inheritRows, links, pmap, "1063");
eq(inheritRows[1]["_vendor"], "280", "inherits from a numeric row for the same article");
eq(inheritRows[1]["_vendorSource"], "inherited", "…recorded as inherited, not as fact");
eq(res2.unresolved, 0, "nothing guessed here");

// ── PMF vs DISPO conflicts are reported, but the file still wins ──
const conflictRows: Record<string, unknown>[] = [
  { Vendor: "1063", Article: "A2" },   // PMF says 280
  { Vendor: "1063", Article: "A2" },   // same conflict, must not double-report
];
const res3 = resolveVendors(conflictRows, links, pmap, "1063");
eq(conflictRows[0]["_vendor"], "1063", "the DISPO's own vendor still wins");
eq(res3.conflicts.length, 1, "the disagreement is reported once");
eq(res3.conflicts[0], { article: "A2", clientProductId: "CP2", cellVendor: "1063", pmfVendor: "280" },
  "…with both sides named");
eq(Object.keys(conflictSheetRows(res3.conflicts)[0]),
  ["Article", "Client Product ID", "Product Description", "Vendor on the DISPO", "Principal on the PMF"],
  "conflict attachment columns");

// ── An empty PMF must change nothing ──
const before: Record<string, unknown>[] = [{ Vendor: "D102", Article: "A1" }];
resolveVendors(before, links, new Map(), "1063");
eq(before[0]["_vendor"], "1063", "no principals ⇒ behaves exactly as before");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All principal-vendor assertions passed.\n");
