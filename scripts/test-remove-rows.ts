/* removeLedgerRows must take out exactly one wrong-channel load and nothing else.

   Its sibling, overwriteSalesLedger, refuses any row-count change at all — that
   single line is what stops an in-place repair becoming a truncation. This one
   is ALLOWED to shrink the ledger, so it has to earn the same safety by hand:
   an expected count the caller states up front, and a refusal to empty the
   ledger or to write when nothing matched.

   The tests that matter here are the NEGATIVE ones. A guard that never fires is
   indistinguishable from a guard that is missing, so each one is checked to
   throw AND to have written nothing when it did.

   Writes to the local data/ folder only. No external DISPO file needed.
   Run: npx tsx scripts/test-remove-rows.ts                                    */

import { rmSync, existsSync } from "fs";
import {
  mergeDispo,
  removeLedgerRows,
  getSalesLedger,
  getSalesLedgerMeta,
  getAllSalesLedgers,
} from "../lib/salesData";

const CLIENT = "__test_remove_client";
const CHANNEL = "__test_remove_massbuild";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };
const eq = (l: string, a: unknown, b: unknown) =>
  ok(l, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

async function throws(l: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); ok(l, false, "did not throw"); }
  catch { ok(l, true); }
}

if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("REFUSING TO RUN: BLOB_READ_WRITE_TOKEN is set — this would write to real storage.");
  process.exit(1);
}

/* Two loads into ONE ledger, mirroring Tramontina/MASSBUILD on 4 Aug 2026:
   the client's real vendor, and a foreign vendor whose file was pointed at the
   wrong channel. Distinct sites, so the wrong load ADDED rows rather than
   overwriting real ones — which is what made it removable. */
const row = (site: string, article: string, vendor: string) => ({
  Site: site, Article: article, "Article Desc": `SKU ${article}`,
  SOH: 5, MAC: 100, "Nett Cost": 90, _vendor: vendor, "08-2026": 3,
});

const GOOD = ["M001", "M002", "M003"].flatMap((s) => ["A1", "A2"].map((a) => row(s, a, "1993")));
const BAD = ["M901", "M902"].map((s) => row(s, "A9", "12908"));

const base = {
  clientId: CLIENT, clientName: "Test Client",
  channelId: CHANNEL, channelName: "MASSBUILD",
  dateColumns: ["08-2026"],
};

const vendorIs = (v: string) => (r: Record<string, unknown>) => String(r["_vendor"] ?? "") === v;

async function main() {
  const dir = `data/sales/${CLIENT}`;
  const clean = () => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); };
  clean();

  try {
    console.log("\nSetup — one good load, one wrong-channel load, same ledger");
    await mergeDispo({ ...base, vendorNumber: "1993", rows: GOOD.map((r) => ({ ...r })), uploadId: "u-good", reportYear: 2026, reportMonth: 8, reportWeek: 4 });
    await mergeDispo({ ...base, vendorNumber: "12908", rows: BAD.map((r) => ({ ...r })), uploadId: "u-bad", reportYear: 2026, reportMonth: 8, reportWeek: 4 });
    eq("ledger holds both loads", (await getSalesLedger(CLIENT, CHANNEL)).length, 8);
    ok("...and meta claims both uploads",
      (await getSalesLedgerMeta(CLIENT, CHANNEL))!.mergedUploadIds.includes("u-bad"));

    console.log("\nThe guards — each must throw AND leave the ledger untouched");
    await throws("a wrong expect count is refused", () =>
      removeLedgerRows(CLIENT, CHANNEL, vendorIs("12908"), 3));
    eq("...and nothing was written", (await getSalesLedger(CLIENT, CHANNEL)).length, 8);

    await throws("a predicate that matches nothing is refused", () =>
      removeLedgerRows(CLIENT, CHANNEL, vendorIs("99999"), 1));
    eq("...and nothing was written", (await getSalesLedger(CLIENT, CHANNEL)).length, 8);

    await throws("emptying the ledger is refused", () =>
      removeLedgerRows(CLIENT, CHANNEL, () => true, 8));
    eq("...and nothing was written", (await getSalesLedger(CLIENT, CHANNEL)).length, 8);

    console.log("\nThe removal itself");
    const res = await removeLedgerRows(CLIENT, CHANNEL, vendorIs("12908"), 2, "u-bad");
    eq("reports before/removed/kept", res, { before: 8, removed: 2, kept: 6 });

    const rows = await getSalesLedger(CLIENT, CHANNEL);
    eq("the wrong load's rows are gone", rows.filter((r) => String(r["_vendor"]) === "12908").length, 0);
    eq("the real load's rows are all still there", rows.filter((r) => String(r["_vendor"]) === "1993").length, 6);
    eq("no real site was taken with them",
      [...new Set(rows.map((r) => String(r["Site"])))].sort(), ["M001", "M002", "M003"]);

    console.log("\nMeta — BOTH copies, or the two views start disagreeing");
    const meta = (await getSalesLedgerMeta(CLIENT, CHANNEL))!;
    eq("meta blob row count follows the ledger", meta.totalRows, 6);
    eq("meta no longer claims the undone upload", meta.mergedUploadIds.includes("u-bad"), false);
    ok("...but still claims the real one", meta.mergedUploadIds.includes("u-good"));
    const idx = (await getAllSalesLedgers(CLIENT)).find((m) => m.channelId === CHANNEL)!;
    eq("the client index agrees with the meta blob", idx.totalRows, meta.totalRows);
    eq("...on mergedUploadIds too", idx.mergedUploadIds, meta.mergedUploadIds);

    console.log("\nRe-running it is refused rather than silently doing nothing");
    await throws("the same removal a second time throws", () =>
      removeLedgerRows(CLIENT, CHANNEL, vendorIs("12908"), 2));
    eq("...and the ledger is unchanged", (await getSalesLedger(CLIENT, CHANNEL)).length, 6);
  } finally {
    clean();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
