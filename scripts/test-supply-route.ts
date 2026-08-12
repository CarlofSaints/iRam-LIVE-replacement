/* Vendor × Source of Supply rules.
   Run: npx tsx scripts/test-supply-route.ts */

import { vendorKind, sourceOfSupply, judge, scanSupplyRoutes, issueSheetRows } from "../lib/supplyRoute";
import { resolveHeader } from "../lib/headers";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── Both spellings of the column must land on one key ──
eq(resolveHeader("SS"), "Source of Supply", 'resolveHeader("SS")');
eq(resolveHeader("Source of Supply"), "Source of Supply", 'resolveHeader("Source of Supply")');
eq(resolveHeader("SOURCE OF SUPPLY"), "Source of Supply", "…case-insensitively");

// ── Vendor column holds a number or a D-prefixed DC code ──
eq(vendorKind("1063"), "vendor", "numeric is a vendor number");
eq(vendorKind("12908"), "vendor", "longer numbers too");
eq(vendorKind("D102"), "dc", "D-prefixed is a DC code");
eq(vendorKind("d102"), "dc", "lower-case d too");
eq(vendorKind(""), "unknown", "blank is unknown");
eq(vendorKind("ABC"), "unknown", "anything else is unknown, not assumed");

// ── The three combinations that work ──
eq(judge("vendor", "ZL"), "ok", "vendor + ZL — local supplier direct");
eq(judge("dc", "ZD"), "ok", "DC + ZD — DC delivering to store");
eq(judge("vendor", "ZF"), "ok", "vendor + ZF — supplier direct across border");

// ── The ones that mean the order is never placed ──
eq(judge("dc", "ZL"), "mismatch", "DC + ZL is a mismatch");
eq(judge("vendor", "ZD"), "mismatch", "vendor + ZD is a mismatch");
eq(judge("dc", "ZF"), "mismatch", "DC + ZF is a mismatch");

// An unrecognised code can't be checked against the rules, so it is reported
// rather than quietly passed.
eq(judge("vendor", "ZX"), "mismatch", "an unknown source-of-supply code is reported");
// Blank is its own outcome — the column may simply not be filled in, which is
// not the same as the customer having set it wrongly.
eq(judge("vendor", ""), "no source of supply", "blank is reported separately");
eq(judge("unknown", "ZL"), "unknown vendor", "an unreadable vendor value is its own outcome");

// ── sourceOfSupply reads either key, including rows already in the ledger ──
eq(sourceOfSupply({ "Source of Supply": "zl" }), "ZL", "canonical key, upper-cased");
eq(sourceOfSupply({ SS: "ZD" }), "ZD", "legacy SS key still read");
eq(sourceOfSupply({}), "", "absent is blank");

// ── A whole file ──
const rows = [
  { Vendor: "1063", SS: "ZL", Site: "0100", "Site Name": "MAKRO WOODMEAD", Article: "A1", "Article Desc": "Widget", SOH: "5" },
  { Vendor: "D102", SS: "ZD", Site: "0100", Article: "A2", "Article Desc": "Gadget", SOH: "3" },
  { Vendor: "1063", SS: "ZF", Site: "0200", Article: "A3", "Article Desc": "Cross-border", SOH: "1" },
  // the live failure: a vendor number against ZD (1,677 rows of this in USABCO)
  { Vendor: "1063", SS: "ZD", Site: "0300", Article: "A4", "Article Desc": "Will not order", SOH: "9" },
  { Vendor: "D102", SS: "ZL", Site: "0400", Article: "A5", "Article Desc": "Also wrong", SOH: "0" },
  { Vendor: "1063", SS: "", Site: "0500", Article: "A6", "Article Desc": "No SS", SOH: "2" },
];
const scan = scanSupplyRoutes(rows, (site) => (site === "0300" ? "BUILDERS RANDBURG" : ""));

eq(scan.ok, 3, "three rows are orderable");
eq(scan.mismatches.length, 2, "two rows will never be ordered");
eq(scan.blank, 1, "one row has no source of supply");
eq(scan.hasColumn, true, "the file carried the column");
eq(scan.mismatches.map((m) => m.article), ["A4", "A5"], "the right rows are flagged");
eq(scan.mismatches[0].siteName, "BUILDERS RANDBURG", "site name filled in from the store master");
eq(scan.mismatches[0].vendorKind, "vendor", "records which kind the value was");
eq(scan.mismatches[1].vendor, "D102", "keeps the DC code as written");

// A file with no source-of-supply column at all must not accuse anyone.
const noCol = scanSupplyRoutes([{ Vendor: "1063", Site: "1", Article: "A" }]);
eq(noCol.mismatches.length, 0, "no column ⇒ no mismatches");
eq(noCol.hasColumn, false, "…and that is reported");
eq(noCol.blank, 1, "…the rows are counted as having no source of supply");

// ── The attachment carries exactly what was asked for ──
const sheet = issueSheetRows(scan.mismatches);
eq(Object.keys(sheet[0]), [
  "Site Number", "Site Name", "Vendor / DC", "Vendor Type",
  "Source of Supply", "Article", "Product Description", "SOH",
  "Why it will not be ordered",
], "attachment columns");
eq(sheet[0]["Site Number"], "0300", "site number");
eq(sheet[0]["SOH"], "9", "SOH");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All supply-route assertions passed.\n");
