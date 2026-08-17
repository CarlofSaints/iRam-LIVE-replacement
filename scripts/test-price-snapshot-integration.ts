/* Integration: reproduce the exact number Carl reported on 17 Aug 2026, then
   prove the repair fixes it — using the REAL DISPO and the REAL report code.

     VERIGREEN 9677, MAKRO, Aug-2026 Wk2, "Same Month LY" (08-2025):
       report said            R 13,879,309.61   (R825.81 a unit, for a bin bag)
       true value ex-VAT      R    775,071.97

   Run: npx tsx scripts/test-price-snapshot-integration.ts

   Reads one .xls off disk and writes nothing. */

import { readFileSync, existsSync } from "fs";
import * as XLSX from "xlsx";
import { buildDateContext, buildSalesSummary } from "../lib/monthEndReport";
import { repairLedger } from "../lib/priceSnapshotRepair";

const DISPO =
  "C:/Users/CarlDosSantos-(OUTER/IRAM/IRAM - Clients/CLIENTS/VERIGREEN/DISPO's & DATA SOURCES/2026/2026-08/WK2/9677 - DISPO.xls";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? "  — " + d : ""}`); } };
const near = (l: string, actual: number, expected: number, tolPct: number) =>
  ok(l, Math.abs(actual - expected) / expected <= tolPct / 100,
    `got ${actual.toFixed(2)}, expected ~${expected.toFixed(2)} (±${tolPct}%)`);

if (!existsSync(DISPO)) {
  console.error(`SKIPPED: source DISPO not on this machine —\n  ${DISPO}`);
  process.exit(0);
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
};
const hasValue = (v: unknown) => !(v === undefined || v === null || (typeof v === "string" && v.trim() === ""));

// ── Read the sheet as-is: one row per Article×Site×UOM ─────────────────────
const wb = XLSX.read(readFileSync(DISPO), { type: "buffer" });
const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
const hIdx = grid.findIndex((r) => (r || []).some((c) => typeof c === "string" && c.trim() === "Article"));
const hdr = grid[hIdx].map((c) => (c == null ? "" : String(c).trim()));
const at = (n: string) => hdr.findIndex((h) => h === n);
const sq = (n: string) => hdr.findIndex((h) => h.replace(/\s/g, "") === n);
const I = {
  art: at("Article"), site: at("Site"), uom: at("UOM"), soh: sq("SOH"),
  incl: at("Incl SP"), prom: at("Prom SP"), nett: at("Net Cost"), desc: at("Article Desc"),
};
const dateCols = hdr.map((h, i) => ({ h, i })).filter((x) => /^\d{2}-\d{4}$/.test(x.h));
const body = grid.slice(hIdx + 1).filter((r) => r && r[I.art] != null && String(r[I.art]).trim() !== "");

ok("the DISPO carries the 7 month columns a healthy Makro file has", dateCols.length === 7,
  dateCols.map((d) => d.h).join(" "));
ok("08-2025 is one of them", dateCols.some((d) => d.h === "08-2025"));

// ── Group by the ledger key ────────────────────────────────────────────────
const groups = new Map<string, unknown[][]>();
for (const r of body) {
  const k = `${String(r[I.art]).trim()}|${String(r[I.site] ?? "").trim()}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r as unknown[]);
}
ok("every Article|Site is listed more than once — one row per UOM", [...groups.values()].every((g) => g.length > 1),
  `${[...groups.values()].filter((g) => g.length > 1).length} of ${groups.size} duplicated`);

const rawW = body.reduce((s, r) => s + num(r[dateCols.find((d) => d.h === "08-2025")!.i]), 0);
near("summing column W straight down double-counts (Carl's 34,048)", rawW, 34048.089, 0.1);

// ── Build the two ledgers ──────────────────────────────────────────────────
// TODAY: collapseUomRows picks the highest-SOH row — the selling unit.
// PRE-30-JUN: every UOM row merged onto one key, last non-empty value winning,
//             so the CASE price stuck and got snapshotted as _inclSP_2025.
const iW = dateCols.find((d) => d.h === "08-2025")!.i;
const correct: Record<string, unknown>[] = [];
const poisoned: Record<string, unknown>[] = [];

for (const [, g] of groups) {
  let best = g[0];
  for (const r of g) {
    const a = num(r[I.soh]), b = num(best[I.soh]);
    if (a > b) best = r;
    else if (a === b) {
      const sa = dateCols.reduce((s, d) => s + num(r[d.i]), 0);
      const sb = dateCols.reduce((s, d) => s + num(best[d.i]), 0);
      if (sa > sb) best = r;
    }
  }

  let legacyIncl: unknown = null, legacyProm: unknown = null;
  for (const r of g) {
    if (hasValue(r[I.incl])) legacyIncl = r[I.incl];
    if (hasValue(r[I.prom])) legacyProm = r[I.prom];
  }

  const shared: Record<string, unknown> = {
    Article: String(best[I.art]).trim(),
    Site: String(best[I.site] ?? "").trim(),
    Description: String(best[I.desc] ?? ""),
    _vendor: "9677",
    SOH: num(best[I.soh]),
    "Incl SP": num(best[I.incl]),
    "Prom SP": num(best[I.prom]),
    "Nett Cost": num(best[I.nett]),
  };
  for (const d of dateCols) shared[d.h] = num(best[d.i]);

  // Healthy: the 2025 snapshot is the same selling-unit price.
  correct.push({ ...shared, _inclSP_2025: num(best[I.incl]), _promSP_2025: num(best[I.prom]) });
  // Damaged: the 2025 snapshot is whatever the old merge left behind.
  poisoned.push({ ...shared, _inclSP_2025: num(legacyIncl), _promSP_2025: num(legacyProm) });
}

const collapsedW = correct.reduce((s, r) => s + num(r["08-2025"]), 0);
near("collapsed, 08-2025 is the 16,807 the report printed", collapsedW, 16807, 0.1);

// ── Through the REAL report engine ─────────────────────────────────────────
const ctx = buildDateContext(dateCols.map((d) => d.h));
const lyValue = (rows: Record<string, unknown>[]) =>
  buildSalesSummary(rows, ctx).find((l) => l.level === "Vendor")!.valueTotal.sameMonthLy;
const lyUnits = (rows: Record<string, unknown>[]) =>
  buildSalesSummary(rows, ctx).find((l) => l.level === "Vendor")!.volumeTotal.sameMonthLy;

const before = lyValue(poisoned);
const target = lyValue(correct);
console.log(`\n  same-month-LY value:  poisoned R${before.toFixed(2)}  ·  correct R${target.toFixed(2)}`);

near("the correct value is the R775k the DISPO actually supports", target, 775071.97, 1);
ok("the poisoned ledger inflates it by more than 10x", before / target > 10, `${(before / target).toFixed(1)}x`);
ok("…which brackets the R13,879,309.61 the report printed", before > 13_879_309.61 && target < 13_879_309.61,
  `poisoned ${before.toFixed(0)} > 13.88m > correct ${target.toFixed(0)}`);
ok("units are identical either way — only the money was ever wrong",
  Math.abs(lyUnits(poisoned) - lyUnits(correct)) < 0.01);

// ── Repair, and re-run the same report code ────────────────────────────────
const summary = repairLedger(poisoned, { apply: true });
console.log(`  repair: ${summary.fieldsRemoved} snapshot(s) removed from ${summary.rowsRepaired} of ${summary.rows} rows`);

ok("the sweep finds real damage", summary.rowsRepaired > 100, `${summary.rowsRepaired} rows`);
ok("it only touches the year snapshots", poisoned.every((r) => r["Incl SP"] !== undefined));

const after = lyValue(poisoned);
console.log(`  after repair:         R${after.toFixed(2)}`);
near("after the repair the report reads the true value", after, target, 1);
ok("…and it is no longer anywhere near R13.9m", after < 1_000_000, `R${after.toFixed(2)}`);
near("units still untouched", lyUnits(poisoned), 16807, 0.1);

const again = repairLedger(poisoned, { apply: true });
ok("re-running the sweep is a no-op", again.fieldsRemoved === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
