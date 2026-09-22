/* The send ledger doubles as the dedup ledger, and NOT every record in it is a
   send. `addSend` writes `status: "skipped_no_data"` for a clean store and for
   a site that is in no loaded DISPO, so the poller does not re-render them
   every three minutes.

   The old `hasProcessedVisit` returned a bare boolean, so from the second poll
   of the day onward every one of those visits reported as "Already sent today".
   On 22 Sep 2026 a run read "46 visits · 0 sent · 41 already sent today" while
   a BEX rep had received nothing — the 41 was the only number anyone looked at,
   and it was not a count of reports.

   These assertions pin the distinction: a ledger HIT is not a SEND. */
import { rmSync, existsSync } from "fs";
import { join } from "path";

// lib/blob.ts writes to ./data when there is no Blob token. Assert that, or
// this test would write to PRODUCTION storage.
if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("REFUSING TO RUN: BLOB_READ_WRITE_TOKEN is set — this test writes blobs.");
  process.exit(1);
}

import { addSend, processedVisitStatus, hasProcessedVisit, hasSent } from "../lib/storeReportLog";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

const DAY = "2099-01-02"; // far future so it cannot collide with real data
const keyPath = join(process.cwd(), "data", "store-reports", "sends", `${DAY}.json`);
if (existsSync(keyPath)) rmSync(keyPath);

async function main() {
  const base = {
    periodKey: DAY,
    storeName: "MAKRO SPRINGFIELD",
    sentAt: new Date().toISOString(),
    includedStreams: [],
  };

  // A real send, and a visit that was processed but never emailed.
  await addSend({ ...base, siteCode: "M12", repEmail: "sent@iram.co.za", visitGuid: "guid-sent", status: "sent" });
  await addSend({ ...base, siteCode: "S72X", repEmail: "bex@iram.co.za", visitGuid: "guid-nodata", status: "skipped_no_data" });
  await addSend({ ...base, siteCode: "M99", repEmail: "broke@iram.co.za", visitGuid: "guid-failed", status: "failed" });

  check("a real send reports 'sent'", await processedVisitStatus(DAY, "guid-sent"), "sent");

  // 🔴 The load-bearing one. This visit is IN the ledger, so the old boolean said
  // "already processed" and the run summary said "Already sent today" — but no
  // report was ever emailed to this rep.
  check("a no-data visit does NOT report 'sent'", await processedVisitStatus(DAY, "guid-nodata"), "skipped_no_data");
  check("a failed visit does NOT report 'sent'", await processedVisitStatus(DAY, "guid-failed"), "failed");
  check("an unseen visit reports null", await processedVisitStatus(DAY, "guid-new"), null);
  check("a blank GUID reports null", await processedVisitStatus(DAY, ""), null);

  // The runner branches on `prior === "sent"`. Prove the branch splits.
  const bucket = async (guid: string) =>
    (await processedVisitStatus(DAY, guid)) === "sent" ? "skipped-duplicate" : "skipped-repeat-not-sent";
  check("a sent visit buckets as already-sent", await bucket("guid-sent"), "skipped-duplicate");
  check("a no-data visit buckets as nothing-sent", await bucket("guid-nodata"), "skipped-repeat-not-sent");
  check("a failed visit buckets as nothing-sent", await bucket("guid-failed"), "skipped-repeat-not-sent");

  // The old boolean is kept as a wrapper. It must still answer "seen at all?",
  // which is exactly why it could not answer "was it sent?".
  check("hasProcessedVisit still true for a no-data visit", await hasProcessedVisit(DAY, "guid-nodata"), true);
  check("hasProcessedVisit false for an unseen visit", await hasProcessedVisit(DAY, "guid-new"), false);

  // hasSent is the store×rep gate and was always status-aware — confirm the
  // no-data rep is not treated as sent by it either, so a later poll on a NEW
  // visit GUID would still be free to send.
  check("hasSent false for the no-data rep", await hasSent(DAY, "S72X", "bex@iram.co.za"), false);
  check("hasSent true for the real send", await hasSent(DAY, "M12", "sent@iram.co.za"), true);
  check("hasSent ignores email case", await hasSent(DAY, "M12", "SENT@IRAM.CO.ZA"), true);

  rmSync(keyPath, { force: true });
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
