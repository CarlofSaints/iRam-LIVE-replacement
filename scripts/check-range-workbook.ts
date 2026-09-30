/* Build a Month-End workbook with range data and reopen it: Menu states the
   range mode, Data has a Range column, Sales has the Range level, and Range
   Exceptions exists for a full file only. */
import ExcelJS from "exceljs";
import {
  buildOOSSummary, buildOOSDetail, buildSalesSummary, buildDateContext, buildRangeExceptions,
} from "../lib/monthEndReport";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import type { RangeMode } from "../lib/rangeState";

const DATE_COLS = ["07-2026", "08-2026", "09-2026"];
const rows = ["TRUE", "FALSE", "MISSING"].map((s, i) => ({
  Site: "B28", Article: String(100 + i), SOH: 0, "07-2026": 5, "08-2026": 5, "09-2026": 5, "Incl SP": 115, _rangeState: s,
}));

async function build(mode: RangeMode) {
  const buf = await buildMonthEndWorkbook(
    buildSalesSummary(rows, buildDateContext(DATE_COLS)), buildOOSSummary(rows, DATE_COLS), buildOOSDetail(rows, DATE_COLS),
    "TEST", "MASSBUILD", "Sep 2026", rows, DATE_COLS,
    undefined, [], undefined, undefined, [], undefined, undefined, undefined, [],
    { year: 2026, month: 9 }, { mode, exceptions: buildRangeExceptions(rows, mode) },
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

async function main() {
  let fail = 0;
  const ok = (name: string, cond: boolean) => { console.log(`${cond ? "ok  " : "FAIL"}  ${name}`); if (!cond) fail++; };
  for (const mode of ["full", "true-only"] as RangeMode[]) {
    const wb = await build(mode);
    const names = wb.worksheets.map((w) => w.name);
    ok(`${mode}: Range Exceptions ${mode === "full" ? "present" : "absent"}`, names.includes("Range Exceptions") === (mode === "full"));
    const menuText: string[] = [];
    wb.getWorksheet("Menu")!.eachRow((r) => r.eachCell((c) => menuText.push(String(c.value))));
    ok(`${mode}: Menu has a Range file line`, menuText.includes("Range file"));
    const hdr: string[] = [];
    wb.getWorksheet("Data")!.getRow(1).eachCell((c) => hdr.push(String(c.value)));
    ok(`${mode}: Data has Range after Site Name`, hdr.findIndex((h) => h.endsWith(" Range")) === hdr.findIndex((h) => h.endsWith("Site Name")) + 1);
    const sales: string[] = [];
    wb.getWorksheet("Sales")!.eachRow((r) => sales.push(String(r.getCell(1).value)));
    ok(`${mode}: Sales has the Range tables`, sales.some((s) => s.startsWith("Range")));
    if (mode === "full") {
      const ex = wb.getWorksheet("Range Exceptions")!;
      ok("full: one exception line (the MISSING one)", ex.rowCount === 3 && String(ex.getRow(3).getCell(7).value) === "102");
    }
  }
  console.log(fail ? `\n${fail} FAILED` : "\nall passed");
  process.exit(fail ? 1 : 0);
}
main();
