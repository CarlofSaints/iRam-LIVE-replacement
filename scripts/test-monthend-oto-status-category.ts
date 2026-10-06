/* Month-End layout changes, 6 Oct 2026 (Carl):
     1. OTO Detail carries SOH / SOO / SIT.
     2. Sales Product tables have a Category column after Product — and the
        live formulas (growth %, contribution %, total SUM) still point at the
        right columns after the insert.
     3. Status Detail has Site / Site Name in columns C and D.

   Builds a workbook from the real engines where they're cheap to feed
   (buildSalesSummary), hand-made rows elsewhere, then reopens it and checks
   the cells, not just that nothing threw.

   Run: npx tsx scripts/test-monthend-oto-status-category.ts */

import ExcelJS from "exceljs";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import { buildSalesSummary, buildDateContext } from "../lib/monthEndReport";
import type { OOSSummary, OTOAnalysis, StatusDetailRow } from "../lib/monthEndReport";

let failures = 0;
function assert(label: string, cond: boolean, note = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? `  — ${note}` : ""}`);
}

const DATE_COLS = ["01-2026", "02-2026", "03-2026", "01-2025", "02-2025", "03-2025"];
const rows = [
  { Site: "W28", "Article Desc": "BOOSTER RED", _category: "500ML", "01-2026": 10, "02-2026": 12, "03-2026": 14, "01-2025": 8, "02-2025": 9, "03-2025": 10, "Incl SP": 23, SOH: 5 },
  { Site: "A01", "Article Desc": "BOOSTER RED", _category: "500ML", "01-2026": 4, "02-2026": 5, "03-2026": 6, "01-2025": 3, "02-2025": 3, "03-2025": 4, "Incl SP": 23, SOH: 1 },
  { Site: "W28", "Article Desc": "BOOST GRAPE", _category: "200ML", "01-2026": 2, "02-2026": 3, "03-2026": 1, "01-2025": 2, "02-2025": 2, "03-2025": 2, "Incl SP": 11, SOH: 0 },
];
const ctx = buildDateContext(DATE_COLS, { year: 2026, month: 3 });
const levels = buildSalesSummary(rows, ctx);

const oos: OOSSummary = { baseCount: 0, oosCount: 0, oosPct: 0, productSummary: [], storeSummary: [] };

const statusDetail: StatusDetailRow[] = [{
  vendor: "13390", subChannel: "CASH & CARRY", province: "GAUTENG", category: "500ML", brand: "VITA",
  article: "123", description: "BOOSTER RED", site: "W28", siteName: "CASH AND CARRY CROWN MINES - W28",
  prst: "Z4", productStatus: "ACTIVE", ranging: "TRUE",
} as StatusDetailRow];

const oto: OTOAnalysis = {
  hasRanging: false, totalLines: 1, totalUnits: 6, totalValue: 60,
  bySubChannel: [], byCategory: [], bySku: [], bySite: [], skipped: [],
  detail: [{ vendor: "13390", site: "W28", siteName: "CASH AND CARRY CROWN MINES", productCode: "P1", article: "123",
    rangeIndicator: "N/A", description: "BOOSTER RED", soh: -2, soo: 0, sit: 0, units: 6, value: 60 }],
};

async function main() {
  const buf = await buildMonthEndWorkbook(
    levels, oos, [], "VITA 24", "MAKRO", "Mar 2026 Wk4", [], DATE_COLS,
    undefined, statusDetail, undefined, undefined,
    ["sales", "statusDetail", "otoDetail"], undefined, oto,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const text = (c: ExcelJS.Cell) => String(c.text ?? "").replace(/^\S+\s+/u, (m) => (/[A-Za-z]/.test(m) ? m : "")).trim();

  // ── Sales: Product tables ──
  const sales = wb.getWorksheet("Sales")!;
  let prodHeader = 0, catHeader = 0, storeHeader = 0;
  sales.eachRow((row, n) => {
    const a = text(row.getCell(1));
    if (a.endsWith("Product") && !prodHeader) prodHeader = n;
    if (a.endsWith("Category") && !catHeader) catHeader = n;
    if (a.endsWith("Site") && !storeHeader) storeHeader = n;
  });
  assert("Sales has a Product table", prodHeader > 0);
  assert("Product table B header = Category", text(sales.getCell(prodHeader, 2)).endsWith("Category"), text(sales.getCell(prodHeader, 2)));
  assert("Product table C header = # Stores", text(sales.getCell(prodHeader, 3)).endsWith("# Stores"), text(sales.getCell(prodHeader, 3)));
  assert("Product table D header = YTD", text(sales.getCell(prodHeader, 4)).endsWith("YTD"), text(sales.getCell(prodHeader, 4)));

  const r1 = prodHeader + 1;
  const name = String(sales.getCell(r1, 1).value);
  const cat = String(sales.getCell(r1, 2).value);
  assert("Product row carries its category", (name === "BOOSTER RED" && cat === "500ML") || (name === "BOOST GRAPE" && cat === "200ML"), `${name} → ${cat}`);

  // Formulas after the insert: YTD is D, LY YTD E, Current Month F, Same Month LY G, Last Month H.
  const f = (c: number) => (sales.getCell(r1, c).value as { formula?: string })?.formula ?? "";
  assert("Product Growth YTD % uses D vs E", f(9) === `IF(E${r1}=0,"",(D${r1}-E${r1})/ABS(E${r1}))`, f(9));
  assert("Product Growth vs LM % uses F vs H", f(10) === `IF(H${r1}=0,"",(F${r1}-H${r1})/ABS(H${r1}))`, f(10));
  assert("Product Growth vs PYM % uses F vs G", f(11) === `IF(G${r1}=0,"",(F${r1}-G${r1})/ABS(G${r1}))`, f(11));
  assert("Product Contribution % uses column D", /^IF\(\$D\$\d+=0,0,D\d+\/\$D\$\d+\)$/.test(f(12)), f(12));
  let totalRow = r1; while (!/TOTAL/i.test(String(sales.getCell(totalRow, 1).value ?? ""))) totalRow++;
  const tf = (sales.getCell(totalRow, 4).value as { formula?: string })?.formula ?? "";
  assert("Product total YTD sums column D", tf === `SUM(D${r1}:D${totalRow - 1})`, tf);
  assert("Product total Category is blank", String(sales.getCell(totalRow, 2).value ?? "") === "");

  // Non-product tables untouched: C = YTD, growth C vs D.
  const c1 = catHeader + 1;
  const cf = (sales.getCell(c1, 8).value as { formula?: string })?.formula ?? "";
  assert("Category table still B = # Stores", text(sales.getCell(catHeader, 2)).endsWith("# Stores"));
  assert("Category table Growth YTD % still C vs D", cf === `IF(D${c1}=0,"",(C${c1}-D${c1})/ABS(D${c1}))`, cf);

  // ── Status Detail ──
  const sd = wb.getWorksheet("Status Detail")!;
  const sdh = [1, 2, 3, 4, 5].map((c) => text(sd.getCell(1, c)));
  assert("Status Detail A-E = Vendor, Sub-Channel, Site, Site Name, Province",
    ["Vendor", "Sub-Channel", "Site", "Site Name", "Province"].every((h, i) => sdh[i].endsWith(h)), sdh.join(" | "));
  assert("Status Detail C/D data = W28 / store name",
    sd.getCell(2, 3).value === "W28" && String(sd.getCell(2, 4).value).startsWith("CASH AND CARRY"));

  // ── OTO Detail ──
  const od = wb.getWorksheet("OTO Detail")!;
  const hdr: string[] = [];
  od.getRow(4).eachCell((c) => hdr.push(text(c)));
  const at = (h: string) => hdr.findIndex((x) => x.endsWith(h)) + 1;
  assert("OTO Detail has SOH, SOO, SIT before OTO Units",
    at("SOH") > 0 && at("SOO") === at("SOH") + 1 && at("SIT") === at("SOO") + 1 && at("OTO Units") === at("SIT") + 1, hdr.join(" | "));
  assert("OTO Detail SOH value written (-2)", od.getCell(5, at("SOH")).value === -2, String(od.getCell(5, at("SOH")).value));
  const note = String(od.getCell(2, 1).value);
  assert("OTO note no longer says SOH/SOO/SIT are omitted", !/SOH \/ SOO \/ SIT \/ Status \/ Product Status columns are omitted/.test(note));

  console.log(failures ? `\n${failures} FAILED` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
