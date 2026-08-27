/* The ledger period stamp must never walk BACKWARDS on a back-load.

   Fails on the code as it stood on 27 Aug 2026, where mergeDispo wrote

       reportWeek: reportWeek ?? existingMeta?.reportWeek,

   i.e. last-load-wins. That let one morning of Dec-2025 back-loads leave 23 of
   52 live ledgers stamped Dec 2025 Wk4 over data running to Aug 2026 — and
   because Month-End derives its Phantom reference date and its Numerical
   Distribution window from the resolved YEAR and MONTH, that is a data defect,
   not just a wrong header.

   Writes to the local data/ folder only. No external DISPO file needed.
   Run: npx tsx scripts/test-ledger-stamp.ts                                   */

import { rmSync, existsSync } from "fs";
import { winningStamp, periodScore } from "../lib/dispoSnapshot";
import { mergeDispo, getSalesLedgerMeta, getAllSalesLedgers } from "../lib/salesData";
import { resolveReportPeriod } from "../lib/reportPeriod";

const CLIENT = "__test_stamp_client";
const CHANNEL_A = "__test_stamp_makro";
const CHANNEL_B = "__test_stamp_massbuild";
const CHANNEL_C = "__test_stamp_walmart";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };
const eq = (l: string, a: unknown, b: unknown) =>
  ok(l, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("REFUSING TO RUN: BLOB_READ_WRITE_TOKEN is set — this would write to real storage.");
  process.exit(1);
}

const S = (y?: number, m?: number, w?: number) => ({ reportYear: y, reportMonth: m, reportWeek: w });
const label = (s: { reportYear?: number; reportMonth?: number; reportWeek?: number }) =>
  `${s.reportYear}-${s.reportMonth}Wk${s.reportWeek}`;

/* A DISPO row carrying one month of sales. Article|Site is the ledger key. */
function rows(month: string, n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    Article: `ART${i}`,
    Site: `S${i}`,
    "SOH": 10 + i,
    [month]: 100 + i,
  }));
}

function unit() {
  console.log("\nwinningStamp — the rule in isolation");

  eq("older week is REFUSED", winningStamp(S(2026, 8, 3), S(2026, 7, 5)), S(2026, 8, 3));
  eq("older month is REFUSED", winningStamp(S(2026, 8, 3), S(2026, 6, 4)), S(2026, 8, 3));
  eq("older YEAR is REFUSED (the live case)", winningStamp(S(2026, 8, 3), S(2025, 12, 4)), S(2026, 8, 3));
  eq("newer week is taken", winningStamp(S(2026, 8, 3), S(2026, 8, 4)), S(2026, 8, 4));
  eq("newer month is taken", winningStamp(S(2026, 8, 3), S(2026, 9, 1)), S(2026, 9, 1));
  eq("newer year is taken", winningStamp(S(2025, 12, 4), S(2026, 1, 1)), S(2026, 1, 1));
  eq("EQUAL period is taken (re-loading a bad file must still correct it)",
    winningStamp(S(2026, 8, 3), S(2026, 8, 3)), S(2026, 8, 3));
  eq("no existing stamp → take the incoming one", winningStamp(null, S(2026, 8, 3)), S(2026, 8, 3));
  eq("no existing stamp, unstamped load → still nothing", winningStamp(null, S()), S());
  eq("UNSTAMPED load must not blank a good stamp", winningStamp(S(2026, 8, 3), S()), S(2026, 8, 3));

  /* The three fields move together. The old `??` chain resolved them
     independently, so a load carrying only a year could pair 2026 with a week
     left over from a different month — a period nobody ever loaded. */
  eq("a PARTIAL incoming stamp cannot mix with the old one",
    winningStamp(S(2026, 8, 3), S(2027, undefined, undefined)), S(2027, undefined, undefined));

  console.log("\nperiodScore ordering");
  ok("Dec 2025 Wk4 sorts BELOW Aug 2026 Wk3",
    periodScore(2025, 12, 4) < periodScore(2026, 8, 3));
  ok("Jul 2026 Wk5 sorts BELOW Aug 2026 Wk1",
    periodScore(2026, 7, 5) < periodScore(2026, 8, 1));
}

async function integration() {
  console.log("\nmergeDispo — through the real merge, against local data/");

  const base = {
    clientId: CLIENT, clientName: "VERMONT SALES", channelId: CHANNEL_A,
    channelName: "MAKRO", vendorNumber: "2064",
  };

  // 1. The current week lands.
  await mergeDispo({ ...base, rows: rows("08-2026"), dateColumns: ["08-2026"], uploadId: "u1", ...S(2026, 8, 3) });
  let meta = await getSalesLedgerMeta(CLIENT, CHANNEL_A);
  eq("after the Aug Wk3 load the stamp is Aug 2026 Wk3", label(meta!), "2026-8Wk3");

  // 2. THE BUG: a Dec-2025 back-load, exactly what happened on 25 Aug 2026.
  await mergeDispo({ ...base, rows: rows("12-2025"), dateColumns: ["12-2025"], uploadId: "u2", ...S(2025, 12, 4) });
  meta = await getSalesLedgerMeta(CLIENT, CHANNEL_A);
  eq("a Dec 2025 back-load does NOT drag the stamp backwards", label(meta!), "2026-8Wk3");
  ok("...and its sales STILL merged (back-loading history must keep working)",
    (meta!.dateColumns ?? []).includes("12-2025"),
    `dateColumns = ${(meta!.dateColumns ?? []).join(", ")}`);
  ok("...and the client index agrees with the meta blob",
    (await getAllSalesLedgers(CLIENT)).find((m) => m.channelId === CHANNEL_A)?.reportMonth === 8);

  // 3. Re-loading the SAME period is how a bad file gets corrected.
  await mergeDispo({ ...base, rows: rows("08-2026"), dateColumns: ["08-2026"], uploadId: "u3", ...S(2026, 8, 3) });
  eq("re-loading the same week is still accepted",
    label((await getSalesLedgerMeta(CLIENT, CHANNEL_A))!), "2026-8Wk3");

  // 4. Forward still moves.
  await mergeDispo({ ...base, rows: rows("09-2026"), dateColumns: ["09-2026"], uploadId: "u4", ...S(2026, 9, 1) });
  eq("a newer period DOES move the stamp forward",
    label((await getSalesLedgerMeta(CLIENT, CHANNEL_A))!), "2026-9Wk1");

  // 5. An unstamped load must not blank it.
  await mergeDispo({ ...base, rows: rows("09-2026"), dateColumns: ["09-2026"], uploadId: "u5" });
  eq("an unstamped load leaves the stamp alone",
    label((await getSalesLedgerMeta(CLIENT, CHANNEL_A))!), "2026-9Wk1");

  console.log("\nWhat the load dialog now reports (mergeDispo's return value)");

  /* The dialog is driven entirely by these fields. Until they existed, a
     back-load and a current-week load produced an identical green tick, which
     is how 45 of them went unnoticed. Assert the SHAPE the UI reads, not just
     the stamp that ends up stored. */
  const fresh = { ...base, channelId: CHANNEL_C, channelName: "WALMART" };
  const first = await mergeDispo({ ...fresh, rows: rows("08-2026"), dateColumns: ["08-2026"], uploadId: "v1", ...S(2026, 8, 3) });
  ok("a current-week load reports its stamp ACCEPTED", first.stampAccepted === true);
  eq("...and names the period the ledger now speaks for", label(first.ledgerPeriod), "2026-8Wk3");
  eq("...with nothing skipped on a first load", first.snapshotsSkipped, 0);

  const back = await mergeDispo({ ...fresh, rows: rows("12-2025"), dateColumns: ["12-2025"], uploadId: "v2", ...S(2025, 12, 4) });
  ok("a back-load reports its stamp REFUSED", back.stampAccepted === false);
  eq("...and still names Aug 2026 Wk3 as the ledger period", label(back.ledgerPeriod), "2026-8Wk3");
  ok("...and reports the stock rows it was not allowed to touch", back.snapshotsSkipped > 0,
    `snapshotsSkipped = ${back.snapshotsSkipped}`);
  ok("...while its SALES still merged", back.inserted + back.updated > 0);

  /* An unstamped load has no period to refuse, so it must NOT raise the amber
     block — otherwise every legacy load shouts at the user for no reason. */
  const bare = await mergeDispo({ ...fresh, rows: rows("08-2026"), dateColumns: ["08-2026"], uploadId: "v3" });
  ok("an unstamped load is not reported as refused", bare.stampAccepted === true);

  console.log("\nWhat the Reports page then resolves on Auto");

  // The live shape: MAKRO dragged back, MASSBUILD healthy. Rebuild MAKRO at the
  // broken value by hand so we test the RESOLVER, not the merge.
  await mergeDispo({
    ...base, channelId: CHANNEL_B, channelName: "MASSBUILD", vendorNumber: "2715",
    rows: rows("08-2026"), dateColumns: ["08-2026"], uploadId: "u6", ...S(2026, 8, 3),
  });
  const metas = await getAllSalesLedgers(CLIENT);

  const auto = resolveReportPeriod(metas, { year: null, month: null, week: null });
  eq("Auto over both ledgers reads the LATEST period", auto.label, "Sep 2026 Wk1");

  // Scoped to the broken channel alone — this is what Sihle saw.
  const scopedBroken = resolveReportPeriod([{ ...S(2025, 12, 4) }], { year: null, month: null, week: null });
  eq("a ledger stamped Dec 2025 labels the report Dec 2025 Wk4", scopedBroken.label, "Dec 2025 Wk4");
  ok("...and that YEAR/MONTH is what month-end builds its reference date from",
    scopedBroken.year === 2025 && scopedBroken.month === 12);

  const chosen = resolveReportPeriod([{ ...S(2025, 12, 4) }], { year: 2026, month: 7, week: 5 });
  eq("an explicit choice still overrides a bad stamp", chosen.label, "Jul 2026 Wk5");
  eq("...and is reported as chosen, not stamped", chosen.source.month, "chosen");
}

async function main() {
  const dir = `data/sales/${CLIENT}`;
  const clean = () => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); };
  clean();
  try {
    unit();
    await integration();
  } finally {
    clean();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
