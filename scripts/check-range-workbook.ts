/* Build a Month-End workbook with range data and reopen it: Menu states the
   range mode, Data has a Range column, Sales has the Range level, and Range
   Exceptions exists for a full file only. */
import ExcelJS from "exceljs";
import {
  buildOOSSummary, buildOOSDetail, buildSalesSummary, buildDateContext, buildRangeExceptions,
  buildMarginAnalysis, buildPhantomAnalysis,
} from "../lib/monthEndReport";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import type { RangeMode } from "../lib/rangeState";

const DATE_COLS = ["07-2026", "08-2026", "09-2026"];
const rows = ["TRUE", "FALSE", "MISSING"].map((s, i) => ({
  Site: "B28", Article: String(100 + i), SOH: 0, "07-2026": 5, "08-2026": 5, "09-2026": 5, "Incl SP": 115, _rangeState: s,
  // one line each for Margin (MAC > Nett) and Phantom (stock, nothing sold or received)
  ...(i === 0 ? { SOH: 5, MAC: 12, "Nett Cost": 10, "Last Sold": "", "Last Recv": "" } : {}),
}));

async function build(mode: RangeMode) {
  const buf = await buildMonthEndWorkbook(
    buildSalesSummary(rows, buildDateContext(DATE_COLS)), buildOOSSummary(rows, DATE_COLS), buildOOSDetail(rows, DATE_COLS),
    "TEST", "MASSBUILD", "Sep 2026", rows, DATE_COLS,
    undefined, [], buildMarginAnalysis(rows), buildPhantomAnalysis(rows, { referenceDate: new Date(Date.UTC(2026, 8, 30)), lastSoldMonths: 3, lastReceivedMonths: 3 }), [], undefined, undefined, undefined, [],
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
    const oosHdr: string[] = [];
    wb.getWorksheet("OOS Detail")!.getRow(1).eachCell((c) => oosHdr.push(String(c.value)));
    ok(`${mode}: OOS Detail has Range after Site Name`, oosHdr.findIndex((h) => h.endsWith(" Range")) === oosHdr.findIndex((h) => h.endsWith("Site Name")) + 1);
    const dataRange = hdr.findIndex((h) => h.endsWith(" Range")) + 1;
    const vals: string[] = [];
    wb.getWorksheet("Data")!.eachRow((r, i) => { if (i > 1) vals.push(String(r.getCell(dataRange).value)); });
    ok(`${mode}: Data Range reads TRUE/FALSE`, JSON.stringify(vals.sort()) === JSON.stringify(["FALSE", "FALSE", "TRUE"]));
    const sales: string[] = [];
    wb.getWorksheet("Sales")!.eachRow((r) => sales.push(String(r.getCell(1).value)));
    ok(`${mode}: Sales has the Range tables`, sales.some((s) => s.startsWith("Range")));
    const mg = wb.getWorksheet("Margin")!;
    const mgHdr = mg.getRow(9);
    ok(`${mode}: Margin Range is the LAST column (S)`, String(mgHdr.getCell(19).value).endsWith("Range") && !mgHdr.getCell(20).value);
    const f16 = (mg.getRow(10).getCell(16).value as { formula?: string })?.formula ?? "";
    ok(`${mode}: Margin Support formula still reads O/H/I/J`, f16 === "IF(O10=\"RISK\",H10*(I10-J10),\"\")");
    ok(`${mode}: Margin row Range = TRUE`, mg.getRow(10).getCell(19).value === "TRUE");
    const ph = wb.getWorksheet("Phantom")!;
    let phHdrRow = 0; ph.eachRow((r, i) => { if (!phHdrRow && String(r.getCell(1).value).endsWith("Vendor")) phHdrRow = i; });
    ok(`${mode}: Phantom Range is column L with a value`, String(ph.getRow(phHdrRow).getCell(12).value).endsWith("Range") && ph.getRow(phHdrRow + 1).getCell(12).value === "TRUE");
    if (mode === "full") {
      const ex = wb.getWorksheet("Range Exceptions")!;
      ok("full: one exception line (the MISSING one)", ex.rowCount === 3 && String(ex.getRow(3).getCell(7).value) === "102");
    }
  }
  console.log(fail ? `\n${fail} FAILED` : "\nall passed");
  process.exit(fail ? 1 : 0);
}
main();
