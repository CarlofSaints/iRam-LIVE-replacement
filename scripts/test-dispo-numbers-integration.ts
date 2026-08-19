/* Integration: run the REAL parseDispo over the REAL DISPO that produced the
   wrong Vital Signs sheet, and check the totals it now yields against the
   numbers the file's own "**" grand-total lines say are true.

     VERIGREEN 9677 / MAKRO / Aug-2026 Wk2 — what the shipped report printed
     against what the file actually contains:

                       report      true    cause
       Curr Y/S Units   41,404   135,830   period-thousands + dropped cases
       Aug-2025 Units   16,812    22,839   period-thousands + dropped cases
       Jul-2026 Units   18,298    20,846   period-thousands + dropped cases
       Aug-2026 Units    8,767     9,448   dropped cases

     The residual after both fixes is A01/A02/A03 — the open channel-routing
     split — which lives in the upload route, not the parser, so it is NOT
     expected to close here.

   Run: npx tsx scripts/test-dispo-numbers-integration.ts

   Reads one .xls off disk and writes nothing. */

import { readFileSync, existsSync } from "fs";
import { parseDispo } from "../lib/dispoParser";
import { readQty } from "../lib/dispoNumbers";

const DISPO =
  "C:/Users/CarlDosSantos-(OUTER/IRAM/IRAM - Clients/CLIENTS/VERIGREEN/DISPO's & DATA SOURCES/2026/2026-08/WK2/9677 - DISPO.xls";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${l}`); }
  else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); }
};
const eq = (l: string, actual: number, expected: number) =>
  ok(l, actual === expected, `got ${actual}, expected ${expected}`);

if (!existsSync(DISPO)) {
  console.error(`SKIPPED: source DISPO not on this machine —\n  ${DISPO}`);
  process.exit(0);
}

const parsed = parseDispo(readFileSync(DISPO));

console.log("\n── The file is recognised for what it is ────────────────");
{
  eq("1,378 data rows collapse to 354 Article|Site keys", parsed.totalRows, 354);
  ok("period-thousands detected", parsed.thousands.applies);
  eq("  every judgeable key agrees scaled",
    parsed.thousands.reconciledScaled, parsed.thousands.judged);
  ok("  and the plain reading was worse",
    parsed.thousands.reconciledPlain < parsed.thousands.judged,
    `plain reconciled ${parsed.thousands.reconciledPlain} of ${parsed.thousands.judged}`);
  eq("91 cells rescaled", parsed.thousands.cellsRescaled, 91);
  ok("  nothing left unjudged", parsed.thousands.unjudged === 0,
    `${parsed.thousands.unjudged} unjudged`);
  console.log(`     note: ${parsed.thousands.notes[0] ?? "(none)"}`);
}

console.log("\n── Totals now match the file's own ** grand totals ──────");
{
  const total = (col: string) =>
    Math.round(parsed.rows.reduce((a, r) => a + readQty(r[col]), 0));

  // Expected values were derived independently from the raw text file by
  // summing each key's "**" line under the thousands reading.
  const EXPECTED: Record<string, number> = {
    "03-2026": 14290,
    "04-2026": 13133,
    "05-2026": 22036,
    "06-2026": 18029,
    "07-2026": 20846,
    "08-2026": 9448,
    "08-2025": 22839,
    "Curr Y/S": 135830,
  };
  for (const [col, want] of Object.entries(EXPECTED)) {
    eq(`${col} totals ${want.toLocaleString()}`, total(col), want);
  }

  // The two headline regressions, stated as the user would feel them.
  ok("Curr Y/S is no longer ~70% short",
    total("Curr Y/S") > 130000, `got ${total("Curr Y/S")}, report shipped 41,404`);
  ok("last-year units are no longer ~26% short",
    total("08-2025") > 22000, `got ${total("08-2025")}, report shipped 16,812`);
}

console.log("\n── Stock and prices still come off the selling row ──────");
{
  const row = parsed.rows.find(
    (r) => String(r["Article"]) === "303554" && String(r["Site"]) === "M07",
  );
  ok("the M07 row exists", !!row);
  if (row) {
    // "1,040.000" on the EA line — comma-separated, and NOT a thousands suspect.
    eq("  SOH is the selling row's 1,040", readQty(row["SOH"]), 1040);
    eq("  UOM is the selling unit, not **", String(row["UOM"]) === "EA" ? 1 : 0, 1);
    ok("  a price is still present", readQty(row["Incl SP"]) > 0);
  }

  // No collapsed row may keep "**" as its UOM — that would mean the total line
  // won the selling-row contest and took its zero stock with it.
  const starRows = parsed.rows.filter((r) => String(r["UOM"] ?? "").trim() === "**");
  eq("no ** line survives as a row", starRows.length, 0);
}

console.log("\n── Case sales are no longer dropped ─────────────────────");
{
  // 303382|M07 Apr-2026: 32 eaches + 1 case of 25 = 57. The old collapse
  // printed 32.
  const row = parsed.rows.find(
    (r) => String(r["Article"]) === "303382" && String(r["Site"]) === "M07",
  );
  ok("the M07 row exists", !!row);
  if (row) eq("  Apr-2026 counts the case too", readQty(row["04-2026"]), 57);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
