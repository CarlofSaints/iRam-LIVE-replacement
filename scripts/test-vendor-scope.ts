/* Vendor scope — proof against the traps, not just the happy path. */
import {
  buildVendorOptions,
  filterRowsByVendor,
  parseVendorParam,
  collectVendorNames,
  vendorLabel,
} from "../lib/vendorScope";
import { reportVendorPart } from "../lib/reportPeriod";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

/* USABCO's shape: two vendor numbers, an Account Manager on each.
   Row 3 is the trap — a DISTRIBUTION CENTRE line. Its own Vendor cell is a
   "D" code and its Name is the DC's, but `_vendor` was INHERITED as 9677. */
const rows = [
  { _vendor: "9677", Vendor: "9677", Name: "USABCO NORTH", Article: "A1", SOH: 5 },
  { _vendor: "9677", Vendor: "9677", Name: "USABCO NORTH", Article: "A2", SOH: 0 },
  { _vendor: "9677", Vendor: "D404", Name: "MAKRO DC GAUTENG", Article: "A3", SOH: 9 },
  { _vendor: "1544", Vendor: "1544", Name: "USABCO SOUTH", Article: "B1", SOH: 2 },
  { _vendor: "", Vendor: "D404", Name: "MAKRO DC GAUTENG", Article: "C1", SOH: 7 },
];

// ── The DC trap: a vendor must never be labelled with a DC's name ──
const names = collectVendorNames(rows);
check("9677 named from its OWN row, not the DC line", names.get("9677"), "USABCO NORTH");
check("1544 named", names.get("1544"), "USABCO SOUTH");

// ── Options ──
const declared = ["9677", "1544"];
const scope = buildVendorOptions(rows, declared);
check("two vendors offered", scope.vendors.length, 2);
check("declared order preserved", scope.vendors.map((v) => v.vendor), ["9677", "1544"]);
check("row counts include the inherited DC line", scope.vendors[0].rowCount, 3);
check("unresolved rows counted, not attributed", scope.rowsWithoutVendor, 1);
check("label carries the name", vendorLabel(scope.vendors[0]), "9677 - USABCO NORTH");

// ── A vendor in the DATA but not declared is still offered ──
const undeclared = buildVendorOptions(rows, ["9677"]);
check("undeclared vendor still offered", undeclared.vendors.map((v) => v.vendor), ["9677", "1544"]);
check("and flagged as not declared", undeclared.vendors[1].declared, false);

// ── Filtering ──
check("empty selection = every row, untouched", filterRowsByVendor(rows, []).length, 5);
check("one vendor selected", filterRowsByVendor(rows, ["9677"]).length, 3);
check("the other vendor", filterRowsByVendor(rows, ["1544"]).length, 1);
check("both selected", filterRowsByVendor(rows, ["9677", "1544"]).length, 4);
check(
  "a vendorless row is NEVER folded into a scope",
  filterRowsByVendor(rows, ["9677"]).some((r) => r.Article === "C1"),
  false,
);

// ── The filename follows the scope, with no second source of truth ──
check("unscoped filename names both", reportVendorPart(rows, declared), "9677+1544");
check(
  "scoped filename names only that vendor",
  reportVendorPart(filterRowsByVendor(rows, ["1544"]), declared),
  "1544",
);
check(
  "scoped filename, other vendor",
  reportVendorPart(filterRowsByVendor(rows, ["9677"]), declared),
  "9677",
);

// ── Param parsing ──
check("null param = no scoping", parseVendorParam(null), []);
check("empty param = no scoping", parseVendorParam(""), []);
check("whitespace and blanks stripped", parseVendorParam(" 9677 , ,1544 "), ["9677", "1544"]);

// ── A single-vendor client is completely unaffected ──
const single = [{ _vendor: "9677", Vendor: "9677", Name: "USABCO NORTH", Article: "A1" }];
const singleScope = buildVendorOptions(single, ["9677"]);
check("single vendor -> one option (control hides below 2)", singleScope.vendors.length, 1);
check("single vendor, nothing unresolved", singleScope.rowsWithoutVendor, 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
