/* The audit ledger's repeat filter.

   The poller re-reports the same visits every 3 minutes all day. On 11 Sep 2026
   that turned 66 real visits into 5 201 rows, 5 161 of them identical. The
   filter must kill those WITHOUT ever hiding a change of outcome. */
import { rmSync, existsSync } from "fs";
import { join } from "path";

// lib/blob.ts writes to ./data when there is no Blob token. Assert that, or
// this test would write to PRODUCTION storage.
if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("REFUSING TO RUN: BLOB_READ_WRITE_TOKEN is set — this test writes blobs.");
  process.exit(1);
}

import { recordAuditOutcomes, getAuditForDay } from "../lib/storeReportAudit";
import type { RunVisitOutcome } from "../lib/storeReportRunner";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

const DAY = "2099-01-01"; // far future so it cannot collide with real data
const keyPath = join(process.cwd(), "data", "store-reports", "audit", `${DAY}.json`);
function reset() {
  if (existsSync(keyPath)) rmSync(keyPath);
}

function outcome(over: Partial<RunVisitOutcome> = {}): RunVisitOutcome {
  return {
    siteCode: "M29L",
    repEmail: "Chumaninande@Iram.co.za",
    store: "MAKRO LIQUOR PORT ELIZABETH",
    status: "sent",
    repName: "Chumaninande Bless",
    channel: "MAKRO-LIQUOR",
    actions: 12,
    ...over,
  };
}

async function main() {
reset();

// First run records it
await recordAuditOutcomes(DAY, [outcome()]);
check("the first outcome is recorded", (await getAuditForDay(DAY)).length, 1);

// The same outcome again, and again, and again — the 3-minute poller
await recordAuditOutcomes(DAY, [outcome()]);
await recordAuditOutcomes(DAY, [outcome()]);
await recordAuditOutcomes(DAY, [outcome()]);
check("identical repeats are dropped", (await getAuditForDay(DAY)).length, 1);

// ⚠️ A CHANGE of outcome for the same rep+store must NOT be dropped
await recordAuditOutcomes(DAY, [outcome({ status: "skipped-duplicate", detail: "already sent" })]);
const afterChange = await getAuditForDay(DAY);
check("a DIFFERENT outcome for the same rep+store is kept", afterChange.length, 2);
check("newest first", afterChange[0].status, "skipped-duplicate");
check("the original is still there", afterChange[1].status, "sent");

// ...and then that new one also stops repeating
await recordAuditOutcomes(DAY, [outcome({ status: "skipped-duplicate" })]);
check("the new outcome then dedupes too", (await getAuditForDay(DAY)).length, 2);

// A different rep at the same store is its own row
await recordAuditOutcomes(DAY, [outcome({ repEmail: "someone.else@iram.co.za" })]);
check("a different rep at the same store is kept", (await getAuditForDay(DAY)).length, 3);

// A different store for the same rep is its own row
await recordAuditOutcomes(DAY, [outcome({ siteCode: "M19L" })]);
check("a different store for the same rep is kept", (await getAuditForDay(DAY)).length, 4);

// Email case must not create a phantom duplicate row
await recordAuditOutcomes(DAY, [outcome({ repEmail: "chumaninande@iram.co.za" })]);
check("email case is ignored when deduping", (await getAuditForDay(DAY)).length, 4);

// A whole run of repeats plus one new thing keeps only the new thing
const before = (await getAuditForDay(DAY)).length;
await recordAuditOutcomes(DAY, [
  outcome(),
  outcome({ status: "skipped-duplicate" }),
  outcome({ siteCode: "M19L" }),
  outcome({ siteCode: "G131", status: "skipped-no-mapping", actions: 0 }),
]);
check("a mixed run adds only what is new", (await getAuditForDay(DAY)).length, before + 1);

// The realistic shape: 66 visits, polled all day
reset();
const visits: RunVisitOutcome[] = Array.from({ length: 66 }, (_, i) =>
  outcome({ siteCode: `S${i}`, repEmail: `rep${i}@iram.co.za`, status: "skipped-duplicate" }),
);
for (let poll = 0; poll < 80; poll++) await recordAuditOutcomes(DAY, visits);
check("66 visits polled 80 times = 66 rows, not 5 280", (await getAuditForDay(DAY)).length, 66);

reset();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
}

main();
