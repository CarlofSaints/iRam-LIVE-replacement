/* Hand-typed recipient lists — what a rep may put in the "Email to" box.
   Run: npx tsx scripts/test-email-list.ts                                    */

import { parseEmailList, isEmail } from "../lib/emailList";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function list(raw: string, max = 10): string[] | string {
  const r = parseEmailList(raw, max);
  return r.ok ? r.list : r.error;
}

console.log("\n── Separators ───────────────────────────────────────────");
ok("single address", JSON.stringify(list("buyer@store.co.za")) === JSON.stringify(["buyer@store.co.za"]));
ok("comma separated",
  JSON.stringify(list("a@x.co.za,b@x.co.za")) === JSON.stringify(["a@x.co.za", "b@x.co.za"]));
ok("comma + spaces, as anyone actually types it",
  JSON.stringify(list("a@x.co.za , b@x.co.za ,  c@x.co.za")) === JSON.stringify(["a@x.co.za", "b@x.co.za", "c@x.co.za"]));
// Outlook joins with semicolons. Rejecting that would look like our bug.
ok("semicolons work too",
  JSON.stringify(list("a@x.co.za; b@x.co.za")) === JSON.stringify(["a@x.co.za", "b@x.co.za"]));
ok("mixed separators", JSON.stringify(list("a@x.co.za; b@x.co.za, c@x.co.za")).includes("c@x.co.za"));

console.log("\n── Forgiving of stray punctuation ───────────────────────");
ok("trailing comma is not an empty recipient",
  JSON.stringify(list("a@x.co.za,")) === JSON.stringify(["a@x.co.za"]));
ok("leading comma likewise", JSON.stringify(list(",a@x.co.za")) === JSON.stringify(["a@x.co.za"]));
ok("double separators collapse", JSON.stringify(list("a@x.co.za,,b@x.co.za")).includes("b@x.co.za"));

console.log("\n── De-duplication ───────────────────────────────────────");
// Two copies of the same email is a support call, not a feature.
ok("exact duplicate sent once", JSON.stringify(list("a@x.co.za, a@x.co.za")) === JSON.stringify(["a@x.co.za"]));
ok("case-different duplicate sent once", JSON.stringify(list("A@X.co.za, a@x.co.za")) === JSON.stringify(["a@x.co.za"]));
ok("addresses are lower-cased", JSON.stringify(list("Buyer@Store.CO.ZA")) === JSON.stringify(["buyer@store.co.za"]));

console.log("\n── Rejection ────────────────────────────────────────────");
ok("one bad address names it", String(list("a@x.co.za, notanemail")).includes('"notanemail"'));
ok("several bad addresses are all listed",
  String(list("nope, alsonope, a@x.co.za")).includes("nope") && String(list("nope, alsonope")).includes("alsonope"));
ok("a bad address rejects the WHOLE list, no partial send",
  typeof list("a@x.co.za, notanemail") === "string");
ok("missing domain dot rejected", typeof list("a@localhost") === "string");
ok("spaces inside an address rejected", typeof list("a b@x.co.za") === "string");

console.log("\n── Cap (this endpoint is public) ────────────────────────");
const eleven = Array.from({ length: 11 }, (_, i) => `r${i}@x.co.za`).join(",");
ok("over the cap is refused", typeof list(eleven, 10) === "string");
ok("and says how many were given", String(list(eleven, 10)).includes("11"));
const ten = Array.from({ length: 10 }, (_, i) => `r${i}@x.co.za`).join(",");
ok("exactly the cap is allowed", Array.isArray(list(ten, 10)));
// Duplicates must not let someone slip past the cap by... they can't: the cap is
// applied to what was TYPED, before de-duplication. That is the safe order.
ok("cap counts typed entries, not de-duplicated ones",
  typeof list(Array(11).fill("same@x.co.za").join(","), 10) === "string");

console.log("\n── isEmail directly ─────────────────────────────────────");
ok("accepts a normal address", isEmail("carl@outerjoin.co.za"));
ok("rejects empty", !isEmail(""));
ok("rejects a bare name", !isEmail("carl"));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
