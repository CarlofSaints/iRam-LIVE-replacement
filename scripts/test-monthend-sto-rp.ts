/* Month-End STO + RP columns and the missing-DISPO-fields notice, 3 Nov 2026 (Carl):
     - every Site x SKU detail sheet: RP straight after Range, STO straight after SIT
       (no SIT on the sheet: STO at the end, after RP)
     - a DISPO without a field never fails the report; the field is named.

   Real rows: a Massbuild DISPO (has STO + Buyer) and a Makro DISPO (no STO, no
   Buyer) through the real parser and builders, then the workbook is reopened.

   Run: npx tsx scripts/test-monthend-sto-rp.ts <massbuild.xlsx> <makro.xlsx> */

import fs from "fs";
import ExcelJS from "exceljs";
import { parseDispo } from "../lib/dispoParser";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import {
  buildOOSDetail, buildDscDetail, buildStatusDetail, buildMarginAnalysis, buildPhantomAnalysis,
  buildOpenToOrder, buildNumericalDistribution, type OOSSummary,
} from "../lib/monthEndReport";
import { missingDispoFields, missingFieldLines } from "../lib/dispoFieldCheck";
import type { StatusDefinition } from "../lib/types";

let failures = 0;
const assert = (label: string, cond: boolean, note = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? `  - ${note}` : ""}`);
};

const [mbPath, mmPath] = process.argv.slice(2);
const mb = parseDispo(fs.readFileSync(mbPath)).rows;
const mm = parseDispo(fs.readFileSync(mmPath)).rows;

// Notice
const mbGap = missingDispoFields(mb), mmGap = missingDispoFields(mm);
assert("Massbuild DISPO has STO, RP, Buyer", !mbGap.includes("STO") && !mbGap.includes("RP") && !mbGap.includes("Buyer"), mbGap.join(", "));
assert("Makro DISPO is missing STO and Buyer", mmGap.includes("STO") && mmGap.includes("Buyer"), mmGap.join(", "));
const lines = missingFieldLines([
  { channelName: "MAKRO", rows: mm }, { channelName: "WALMART", rows: mm }, { channelName: "MASSBUILD", rows: mb },
]);
assert("identical gaps grouped into one line", lines.some((l) => l.startsWith("MAKRO / WALMART DISPO does not include:")), lines.join(" | "));
console.log("      " + lines.join("\n      "));

// One Massbuild line with STO, made to qualify for every detail sheet
const src = mb.find((r) => r["STO"] !== undefined && String(r["RP"] ?? "").trim()) ?? mb[0];
const line = {
  ...src, Site: "W28", Article: "123", SOH: 5, SOO: 0, SIT: 0, STO: 7, RP: "ZB", Status: "Z1",
  MAC: 10, "Nett Cost": 12, "Incl SP": 20, "Last Sold": "", "Last Recv": "",
  _productStatus: "ACTIVE", _clientProductId: "P1", _storeName: "CROWN MINES", _vendor: "7010",
};
const oosLine = { ...line, SOH: 0, "01-2026": 3 };
const defs = [{ id: "s", code: "Z1", channelId: "c", classification: "POSITIVE", description: "", autoDetected: false } as StatusDefinition];
const negDefs = [{ ...defs[0], classification: "NEGATIVE" } as StatusDefinition];
const dc = ["01-2026"];
const products = new Map([["p1", { clientProductId: "P1", status: "ACTIVE", description: "X" }]]) as never;
const stores = [{ siteNum: "W28", storeName: "CROWN MINES", status: "ACTIVE", channel: "MASSBUILD", subChannel: "BWH" }] as never;

async function main() {
  const oos: OOSSummary = { baseCount: 0, oosCount: 0, oosPct: 0, productSummary: [], storeSummary: [] };
  const buf = await buildMonthEndWorkbook(
    [], oos, buildOOSDetail([oosLine], dc), "TEST", "MASSBUILD", "Jan 2026",
    [line], dc, undefined, buildStatusDetail([line], dc, negDefs, []),
    buildMarginAnalysis([line]),
    buildPhantomAnalysis([line], { referenceDate: new Date(Date.UTC(2026, 0, 31)), lastSoldMonths: 3, lastReceivedMonths: 3 }),
    [],
    buildNumericalDistribution({ rows: [line], dateColumns: dc, refYear: 2026, refMonth: 1, rollingMonths: 6, hasRanging: false, rangingRows: [], stores, products, channelNames: ["BWH"] }),
    buildOpenToOrder({ rows: [oosLine], statusDefs: defs, statusScenarios: [], otoMultipliers: {}, hasRanging: false, rangingRows: [] }),
    undefined, buildDscDetail([line], dc),
    { year: 2026, month: 1 }, undefined, "", lines,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const headerRowOf = (ws: ExcelJS.Worksheet) => {
    for (let r = 1; r <= 40; r++) {
      const vals = Array.from(ws.getRow(r).values as unknown[], (v) => String(v ?? ""));
      if (vals.includes("RP")) return { r, vals };
    }
    return null;
  };
  for (const name of ["OOS Detail", "Data", "DSC Detail", "Status Detail", "Margin", "Phantom", "ND Detail", "OTO Detail"]) {
    const ws = wb.getWorksheet(name);
    const h = ws && headerRowOf(ws);
    if (!ws || !h) { assert(`${name}: has RP header`, false); continue; }
    // some headers carry an emoji icon prefix (HEADER_ICONS)
    const at = (x: string) => h.vals.findIndex((v) => v === x || v.endsWith(" " + x));
    assert(`${name}: RP right after Range`, at("RP") === at("Range") + 1);
    const stoAfter = at("SIT") > 0 ? at("SIT") : at("RP");
    assert(`${name}: STO right after ${at("SIT") > 0 ? "SIT" : "RP"}`, at("STO") === stoAfter + 1);
    const rp = String(ws.getRow(h.r + 1).getCell(at("RP")).value ?? "");
    const sto = ws.getRow(h.r + 1).getCell(at("STO")).value;
    assert(`${name}: values RP=ZB STO=7`, rp === "ZB" && sto === 7, `RP=${rp} STO=${sto}`);
  }
  const menu = wb.getWorksheet("Menu")!;
  let found = 0;
  menu.eachRow((r) => { if (String(r.getCell(1).value) === "Missing DISPO fields") found++; });
  assert("Menu names each missing-fields line", found === lines.length, `${found}/${lines.length}`);

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main();
