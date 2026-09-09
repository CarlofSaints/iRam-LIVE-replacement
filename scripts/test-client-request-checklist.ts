/* The PMF / Links file / Ranging answers must survive the whole way to the
   mail, including when they are NO — that is the half Mark acts on.

   This drives the REAL sendNewClientRequestEmail by stubbing global fetch, so
   what it asserts on is the HTML Resend would have been handed, not a copy of
   the template rewritten in the test. */

process.env.RESEND_API_KEY = "re_test_not_a_real_key";

import {
  readChecklist,
  outstandingItems,
  checklistSummary,
  emptyChecklist,
} from "../lib/clientRequestChecklist";
import { sendNewClientRequestEmail } from "../lib/email";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name + (extra ? ` — ${extra}` : "")); console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
}

const sent: { html: string; subject: string }[] = [];

async function render(checklist: ReturnType<typeof readChecklist>) {
  sent.length = 0;
  await sendNewClientRequestEmail({
    to: "mark@outerjoin.co.za",
    clientName: "ACME TRADING",
    vendorNumbers: "1234",
    channels: "MAKRO",
    notes: "",
    checklist,
    requestedByName: "Sihle",
    requestedByEmail: "sihle@iram.co.za",
  });
  if (sent.length !== 1) throw new Error(`expected 1 send, got ${sent.length}`);
  return sent[0].html;
}

async function main() {
  // ---- readChecklist: only a literal true means done ---------------------
  console.log("\nreadChecklist");
  const all = readChecklist({ pmfDone: true, linksDone: true, rangingDone: true });
  check("all three true", all.pmfDone && all.linksDone && all.rangingDone);

  const none = readChecklist({});
  check("missing keys read false", !none.pmfDone && !none.linksDone && !none.rangingDone);

  const junk = readChecklist({ pmfDone: "false", linksDone: 1, rangingDone: "true" });
  check('string "false" is not done', junk.pmfDone === false);
  check("1 is not done", junk.linksDone === false, "a truthy non-boolean must never read as finished");
  check('string "true" is not done', junk.rangingDone === false);

  check("emptyChecklist is all false", Object.values(emptyChecklist()).every((v) => v === false));
  check("no extra keys smuggled in",
    Object.keys(readChecklist({ role: "super_admin" })).join(",") === "pmfDone,linksDone,rangingDone");

  // ---- the derived lines -------------------------------------------------
  console.log("\nsummary + outstanding");
  const partial = readChecklist({ pmfDone: true });
  check("outstanding names the two undone",
    outstandingItems(partial).join(" | ") === "Links file done | Ranging done");
  check("outstanding is empty when all done", outstandingItems(all).length === 0);
  check("log line names every item",
    checklistSummary(partial) === "PMF done: yes, Links file done: no, Ranging done: no");

  // ---- the real mailer ---------------------------------------------------
  console.log("\nsendNewClientRequestEmail (real function, stubbed transport)");

  const htmlPartial = await render(partial);
  for (const label of ["PMF done", "Links file done", "Ranging done"]) {
    check(`"${label}" appears in the mail`, htmlPartial.includes(label));
  }
  check("a done item renders Yes in green", htmlPartial.includes('#2F855A;">Yes<'));
  check("an undone item renders No in red", htmlPartial.includes('#C53030;">No<'));
  check("exactly one Yes", (htmlPartial.match(/>Yes</g) ?? []).length === 1);
  check("exactly two No", (htmlPartial.match(/>No</g) ?? []).length === 2);
  check("outstanding line names both",
    htmlPartial.includes("Still outstanding: <strong>Links file done, Ranging done</strong>"));

  const htmlNone = await render(readChecklist({}));
  check("nothing ticked still lists all three rows", (htmlNone.match(/>No</g) ?? []).length === 3);
  check("nothing ticked shows no Yes", !htmlNone.includes(">Yes<"));
  check("nothing ticked names all three as outstanding",
    htmlNone.includes("Still outstanding: <strong>PMF done, Links file done, Ranging done</strong>"));

  const htmlAll = await render(all);
  check("all ticked says so", htmlAll.includes("All three are done."));
  check("all ticked has no outstanding line", !htmlAll.includes("Still outstanding"));
  check("all ticked renders three Yes", (htmlAll.match(/>Yes</g) ?? []).length === 3);

  check("the rest of the mail is untouched",
    htmlAll.includes("New Client Request") && htmlAll.includes("ACME TRADING"));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? "{}");
  sent.push({ html: String(body.html ?? ""), subject: String(body.subject ?? "") });
  return new Response(JSON.stringify({ id: "test-message-id" }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

main().finally(() => { globalThis.fetch = realFetch; });
