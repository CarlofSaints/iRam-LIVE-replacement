/* Buyer name cleanup.

   The cases below are not invented — they are every distinct "Buyer" value
   found across all client DISPOs on disk with that column (Aug 2026), plus
   the defensive edges. The important ones are the two positions: Rovic's
   code comes FIRST, Ultrachem's comes LAST, which is why the obvious
   "split on the first space" rule is wrong.

   Run: npx tsx scripts/test-buyer-name.ts */

import { cleanBuyerName } from "../lib/buyerName";

let failures = 0;
function eq(input: unknown, expected: string, note = "") {
  const actual = cleanBuyerName(input);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)} -> ${JSON.stringify(actual)}` +
      (ok ? "" : `  EXPECTED ${JSON.stringify(expected)}`) +
      (note ? `   (${note})` : ""),
  );
}

console.log("— code first (the reported case) —");
eq("W_mm8_b02 Rowen armstrong", "Rowen Armstrong", "Sihle's Rovic report");
eq("W_mm1_b01 Brendan naidoo", "Brendan Naidoo");
eq("W_mm20_b02 Michelle lee", "Michelle Lee");

console.log("\n— code LAST: breaks any split-on-first-space rule —");
eq("Mauritz swart W_mm23_b01", "Mauritz Swart", "would give 'swart W_mm23_b01'");

console.log("\n— Proper Case merges the source's inconsistent casing —");
eq("Mauritz swart W_mm23_b01", "Mauritz Swart");
eq("Mauritz Swart", "Mauritz Swart", "same buyer, both spellings now agree");
eq("W_mm8_b02 Rowen armstrong", "Rowen Armstrong");
eq("Rowen Armstrong", "Rowen Armstrong", "same buyer, both spellings now agree");
eq("ALECIA NAIDU", "Alecia Naidu", "shouting is normalised too");

console.log("\n— 'Vacant' is a real value, not a blank —");
eq("W_mm13_b06 Vacant", "Vacant");
eq("W_mm8_b04 Vacant", "Vacant");

console.log("\n— already clean and already Proper Case: unchanged —");
for (const name of [
  "Alecia Naidu", "Amelia Rajkumar", "Candace Booysen", "Deena Govender",
  "Dhanisha Naidoo", "Koovan Govender", "Lebogang Sithole", "Lesego Motshaisa",
  "Mauritz Swart", "Mpeyake Khosa", "Neo Mokobedi", "Rowen Armstrong",
  "Thozama Faku", "Yohina Maharaj",
]) eq(name, name);

console.log("\n— edges —");
eq("", "", "empty stays empty");
eq(null, "");
eq(undefined, "");
eq("   ", "", "whitespace only");
eq("W_mm8_b02", "W_mm8_b02", "code with no name: kept as-is, and NOT cased");
eq("  W_mm8_b02   Rowen   armstrong  ", "Rowen Armstrong", "padding + inner runs collapse");
eq("W_mm8_b02 Rowen armstrong W_mm23_b01", "Rowen Armstrong", "code at both ends");
eq(12345, "12345", "non-string passes through as text");
eq("anne-marie o'brien", "Anne-Marie O'Brien", "hyphen + apostrophe are word boundaries");
eq("ANNE-MARIE O'BRIEN", "Anne-Marie O'Brien");
eq("mauritz's desk", "Mauritz's Desk", "possessive not turned into \"'S\"");
/* Known and accepted (Carl's call, 10 Aug 2026): irregular capitalisation is
   flattened. No such name exists in the data today; if one appears, fix it in
   properCase() rather than reverting the casing. */
eq("van der Merwe", "Van Der Merwe", "ACCEPTED: flattened, no exception list");
eq("McDonald", "Mcdonald", "ACCEPTED: flattened, no exception list");

console.log(failures === 0 ? "\nAll assertions passed\n" : `\n${failures} FAILED\n`);
process.exit(failures > 0 ? 1 : 0);
