/* The rules that decide which clients a check-in's store report may carry
   (lib/storeReportScope.ts), and the signed link that carries the answer.

   Run: npx tsx scripts/test-store-report-scope-rules.ts                      */

import type { User } from "../lib/types";
import { buildScopeIndex, scopeForEmail, normReportEmail } from "../lib/storeReportScope";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
}

function user(p: Partial<User> & { email: string }): User {
  return {
    id: p.email, name: p.email, password: "", role: "cam", forcePasswordChange: false,
    active: true, createdAt: "2026-09-28T00:00:00.000Z", ...p,
  } as User;
}

async function main() {
  process.env.REPORT_LINK_SECRET = "rules-test-secret";
  const { signReportLink, verifyReportLink, linkClientIds } = await import("../lib/reportLink");

  console.log("\nScope rules");
  const idx = buildScopeIndex([
    user({ email: "admin@iram.co.za", role: "admin" }),
    user({ email: "rep@alpha.co.za", role: "rep", storeReportClientIds: ["alpha"] }),
    user({ email: "rep-empty@alpha.co.za", role: "rep" }),
    user({ email: "rep-off@alpha.co.za", role: "rep", active: false, storeReportClientIds: ["alpha"] }),
    user({ email: "manager@alpha.co.za", role: "admin", storeReportOwnClientsOnly: true, storeReportClientIds: ["alpha", "alpha2"] }),
    user({ email: "manager-unticked@iram.co.za", role: "admin", storeReportOwnClientsOnly: false, storeReportClientIds: ["alpha"] }),
    user({ email: "Dup@x.co.za", role: "rep", storeReportClientIds: ["alpha"] }),
    user({ email: "dup@x.co.za ", role: "cam" }),
  ]);

  const s = (e: string) => scopeForEmail(idx, e);
  check("no account → all (iRam reps untouched)", s("merch@iram.co.za").kind === "all");
  check("account not limited → all", s("admin@iram.co.za").kind === "all");
  const rep = s("rep@alpha.co.za");
  check("rep → only their client", rep.kind === "clients" && rep.clientIds.join(",") === "alpha");
  check("rep with nothing ticked → blocked", s("rep-empty@alpha.co.za").kind === "blocked");
  check("deactivated rep → blocked, not all", s("rep-off@alpha.co.za").kind === "blocked");
  const mgr = s("manager@alpha.co.za");
  check("admin with the box ticked → limited too", mgr.kind === "clients" && mgr.clientIds.join(",") === "alpha,alpha2");
  check("box unticked → the client list is ignored (all)", s("manager-unticked@iram.co.za").kind === "all");
  check("two accounts on one email, one limited → blocked", s("dup@x.co.za").kind === "blocked");

  console.log("\nEmail matching");
  check("case + spaces", s("  REP@Alpha.co.za ").kind === "clients");
  check("zero-width space", s("rep@alpha.co.za​").kind === "clients");
  check("normalises NBSP", normReportEmail("rep@alpha.co.za ") === "rep@alpha.co.za");
  check("a different address is NOT matched", s("rep2@alpha.co.za").kind === "all");

  console.log("\nSigned link");
  const tok = signReportLink({ site: "M27", clientIds: ["alpha", "alpha2"], year: 2026, month: 9, week: 3 });
  const v = verifyReportLink(tok);
  check("multi-client link round-trips", v.ok && linkClientIds(v.payload)?.join(",") === "alpha,alpha2");
  const legacy = verifyReportLink(signReportLink({ site: "M27", clientId: "solo" }));
  check("single-client link still reads", legacy.ok && linkClientIds(legacy.payload)?.join(",") === "solo");
  const open = verifyReportLink(signReportLink({ site: "M27" }));
  check("unscoped link reads as unscoped", open.ok && linkClientIds(open.payload) === undefined);

  // A client list that is present but unreadable must not decode as "all".
  const crypto = await import("crypto");
  const b64 = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const forge = (data: object) => {
    const body = b64(Buffer.from(JSON.stringify(data)));
    return `${body}.${b64(crypto.createHmac("sha256", "rules-test-secret").update(body).digest())}`;
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  check("cs: [] refused", !verifyReportLink(forge({ s: "M27", e: exp, cs: [] })).ok);
  check("cs: \"alpha\" (not a list) refused", !verifyReportLink(forge({ s: "M27", e: exp, cs: "alpha" })).ok);
  check("cs with a blank refused", !verifyReportLink(forge({ s: "M27", e: exp, cs: ["alpha", ""] })).ok);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
