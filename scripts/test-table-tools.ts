/* Sorting and searching rules shared by every grid.
   Run: npx tsx scripts/test-table-tools.ts */

import { rowText, matchesQuery } from "../lib/useTableTools";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── rowText: everything the grid could show must be searchable ──
const row = {
  id: "8f2c-uuid-noise",
  clientId: "abc-123",
  clientName: "TOPLINE DISTRIBUTORS (PTY) LTD.",
  vendorNumber: "1142",
  channel: { name: "MASSBUILD", subs: ["BWH", "BEX"] },
  rowCount: 19130,
  active: true,
  _internal: "should not be searchable",
};
const text = rowText(row).toLowerCase();

for (const term of ["topline", "1142", "massbuild", "bwh", "bex", "19130", "true"]) {
  eq(text.includes(term), true, `rowText includes "${term}"`);
}
// Ids and underscore-prefixed internals are noise — searching "abc" should not
// hit a uuid the user never sees.
eq(text.includes("8f2c"), false, "rowText excludes the id");
eq(text.includes("abc-123"), false, "rowText excludes clientId");
eq(text.includes("should not be searchable"), false, "rowText excludes _internal fields");

// Depth guard: a self-referencing object must not hang the search.
const deep: Record<string, unknown> = { name: "x" };
deep.self = deep;
eq(typeof rowText(deep), "string", "rowText survives a cyclic object");

// ── matchesQuery: all terms must hit (AND), not any ──
eq(matchesQuery(text, "topline"), true, "single term matches");
eq(matchesQuery(text, "topline massbuild"), true, "both terms present");
eq(matchesQuery(text, "topline makro"), false, "one term missing ⇒ no match");
eq(matchesQuery(text, "TOPLINE"), true, "search is case-insensitive");
eq(matchesQuery(text, "  "), true, "a blank query matches everything");
eq(matchesQuery(text, ""), true, "an empty query matches everything");
eq(matchesQuery(text, "1142"), true, "numbers are searchable");

// Partial words match, so "mass" finds MASSBUILD without typing it out.
eq(matchesQuery(text, "mass"), true, "partial words match");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All table-tools assertions passed.\n");
