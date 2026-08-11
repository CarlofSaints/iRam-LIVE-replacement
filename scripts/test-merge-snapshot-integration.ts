/* Integration: run the REAL mergeDispo over the REAL DISPO that exposed the bug,
   then back-load an older period and prove stock is not rolled back while sales
   still merge. Writes to the local data/ folder only (no BLOB token = local fs).
   Run: npx tsx scripts/test-merge-snapshot-integration.ts                     */

import { readFileSync, rmSync, existsSync } from "fs";
import { parseDispo } from "../lib/dispoParser";
import { mergeDispo, getSalesLedger } from "../lib/salesData";

const DISPO = "C:/Users/CarlDosSantos-(OUTER/eXceler8/OuterJoin - Clients/IRAM/ARIA/04_Operations/Projects/iRam LIVE Replacement/SOH BUG/USABCO (1063-W5) MB.xlsx";
const CLIENT = "__test_soh_client";
const CHANNEL = "__test_soh_channel";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };
const eq = (l: string, a: unknown, b: unknown) => ok(l, a === b, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("REFUSING TO RUN: BLOB_READ_WRITE_TOKEN is set — this would write to real storage.");
  process.exit(1);
}

/* Through the REAL parser, not a raw sheet read. The parser collapses the
   duplicate Article|Site rows a DISPO carries (one per UOM, pack rows at
   SOH=0) via collapseUomRows — bypassing it tests a shape production never
   sees, and wrongly looks like a bug. */
function loadDispo() {
  const parsed = parseDispo(readFileSync(DISPO));
  return { rows: parsed.rows, dateColumns: parsed.dateColumns };
}

async function main() {
  const cleanup = () => { const p = `data/sales/${CLIENT}`; if (existsSync(p)) rmSync(p, { recursive: true, force: true }); };
  cleanup();

  const { rows, dateColumns: dateCols } = loadDispo();
  console.log(`parsed: ${rows.length} rows, date columns: ${dateCols.join(", ")}`);
  const base = {
    clientId: CLIENT, clientName: "USABCO", channelId: CHANNEL, channelName: "MASSBUILD",
    vendorNumber: "1063", dateColumns: dateCols, uploadId: "u1",
  };

  // 1. Load the real Wk5 file.
  const r1 = await mergeDispo({ ...base, rows, reportYear: 2026, reportMonth: 7, reportWeek: 5 });
  console.log(`\nWk5 load: inserted ${r1.inserted}, updated ${r1.updated}, unchanged ${r1.unchanged}`);
  let ledger = await getSalesLedger(CLIENT, CHANNEL);
  const find = (l: Record<string, unknown>[], art: string, site: string) =>
    l.find((r) => String(r["Article"]).trim() === art && String(r["Site"]).trim() === site);

  const b28 = find(ledger, "309733", "B28")!;
  eq("the real B28 row lands with the DISPO's SOH", Number(b28["SOH"]), 44);
  const srcB28 = rows.find((r) => String(r["Article"]).trim() === "309733" && String(r["Site"]).trim() === "B28")!;
  ok("and its Jul-2026 sales carried through", Number(b28["07-2026"] ?? 0) === Number(srcB28["Jul26"] ?? srcB28["07-2026"] ?? 0),
    `ledger=${b28["07-2026"]} dispo=${srcB28["Jul26"] ?? srcB28["07-2026"]}`);

  // 2. Back-load an OLDER period whose stock differs — the reported scenario.
  //    Same sales for the closed month (as a real older file would have).
  const older = rows.map((r) => ({ ...r, SOH: Number(r["SOH"] ?? 0) + 229 }));
  const r2 = await mergeDispo({ ...base, rows: older, uploadId: "u2", reportYear: 2026, reportMonth: 7, reportWeek: 3 });
  console.log(`Wk3 back-load: inserted ${r2.inserted}, updated ${r2.updated}, unchanged ${r2.unchanged}`);
  ledger = await getSalesLedger(CLIENT, CHANNEL);

  const b28b = find(ledger, "309733", "B28")!;
  eq("an OLDER load does NOT roll stock back", Number(b28b["SOH"]), 44);

  let rolledBack = 0;
  for (const r of ledger) {
    const src = rows.find((x) => String(x["Article"]).trim() === String(r["Article"]).trim() && String(x["Site"]).trim() === String(r["Site"]).trim());
    if (src && Number(r["SOH"] ?? 0) !== Number(src["SOH"] ?? 0)) rolledBack++;
  }
  eq("NO row in the whole ledger was rolled back", rolledBack, 0);

  // 3. A genuinely newer period must still update stock.
  const newer = rows.map((r) => ({ ...r, SOH: 7 }));
  await mergeDispo({ ...base, rows: newer, uploadId: "u3", reportYear: 2026, reportMonth: 8, reportWeek: 1 });
  ledger = await getSalesLedger(CLIENT, CHANNEL);
  eq("a NEWER load does update stock", Number(find(ledger, "309733", "B28")!["SOH"]), 7);

  // 4. Re-loading the SAME period must still correct a bad file.
  const corrected = rows.map((r) => ({ ...r, SOH: 99 }));
  await mergeDispo({ ...base, rows: corrected, uploadId: "u4", reportYear: 2026, reportMonth: 8, reportWeek: 1 });
  ledger = await getSalesLedger(CLIENT, CHANNEL);
  eq("re-uploading the SAME period still corrects stock", Number(find(ledger, "309733", "B28")!["SOH"]), 99);

  console.log(`\nledger rows: ${ledger.length}`);
  cleanup();
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
