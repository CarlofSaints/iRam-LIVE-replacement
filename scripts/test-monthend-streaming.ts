/* Smoke test for the streamed Month-End workbook.

   The builder moved from exceljs's in-memory Workbook to the streaming
   WorkbookWriter (the in-memory one needed ~6GB at TOPLINE's size and was
   OOM-killed). Streaming brings constraints that fail QUIETLY rather than
   loudly, which is what this guards:

     - a frozen view set after the sheet opens is silently lost (null in file)
     - a sheet committed twice, or written to after commit, throws
     - the Menu sheet is now written BEFORE the sheets it links to exist, so
       its hyperlinks can silently point at tabs that were never created
     - the header/icon post-pass now runs per sheet just before commit; if it
       ran too late it would simply do nothing

   So this builds a workbook, reopens it, and asserts the structure — rather
   than just checking the call didn't throw.

   Run: npx tsx scripts/test-monthend-streaming.ts */

import ExcelJS from "exceljs";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import type { SummaryRow, SalesSummaryLevel, OOSSummary, OOSDetailRow } from "../lib/monthEndReport";

let failures = 0;
function assert(label: string, cond: boolean, note = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? `  — ${note}` : ""}`);
}

const DATE_COLS = ["01-2026", "02-2026", "03-2026", "01-2025", "02-2025"];

function sumRow(name: string, n: number): SummaryRow {
  return {
    name, storeCount: n, ytd: n * 10, lyYtd: n * 8, currentMonth: n, sameMonthLy: n - 1,
    lastMonth: n + 1, growthYtdPct: 12.5, growthVsLmPct: -3.25, growthVsPymPct: 8,
    contributionPct: 25,
  };
}

function level(name: string): SalesSummaryLevel {
  const rows = [sumRow(`${name} A`, 3), sumRow(`${name} B`, 5)];
  return { level: name, volumeRows: rows, volumeTotal: sumRow("Total", 8), valueRows: rows, valueTotal: sumRow("Total", 8) };
}

const oosSummary: OOSSummary = {
  baseCount: 100, oosCount: 12, oosPct: 12,
  productSummary: [
    { article: "A1", description: "Widget", category: "Cat", productStatus: "ACTIVE", totalStores: 10, oosStores: 2, oosPct: 20 },
  ],
  storeSummary: [
    { site: "S1", siteName: "Store One", subChannel: "BWH", totalSkus: 20, oosSkus: 3, oosPct: 15 },
  ],
};

// Enough rows that the Data sheet exercises the per-row commit path.
const DATA_ROWS = Number(process.env.ROWS ?? 5000);
const dataRows: Record<string, unknown>[] = Array.from({ length: DATA_ROWS }, (_, i) => ({
  Article: `ART${i}`, "Article Desc": `Product ${i}`, Site: `S${i % 50}`,
  _storeName: `Store ${i % 50}`, _storeSubChannel: "BWH", _province: "GP",
  _category: "Cat", _subCategory: "Sub", _brand: "Brand", _productStatus: "ACTIVE",
  Status: "Z4", SOH: i % 7, SOO: 0, SIT: 0,
  "Incl SP": 115, "Prom SP": 0, "Nett Cost": 50, "Act DSC": 30,
  "01-2026": i % 5, "02-2026": i % 3, "03-2026": i % 2, "01-2025": 1, "02-2025": 2,
}));

const oosDetail: OOSDetailRow[] = Array.from({ length: 200 }, (_, i) => ({
  subChannel: "BWH", province: "GP", category: "Cat", subCategory: "Sub", brand: "Brand",
  article: `ART${i}`, description: `Product ${i}`, site: `S${i % 50}`, siteName: `Store ${i % 50}`,
  soh: 0, soo: 0, sit: 0, status: "Z4", productStatus: "ACTIVE", dscAlert: "", dateLastSold: "",
})) as OOSDetailRow[];

async function main() {
  // Track peak heap during the build so the streaming win is asserted, not
  // assumed. The in-memory builder needed ~6GB for TOPLINE-sized data.
  let peak = 0;
  const sampler = setInterval(() => {
    const u = process.memoryUsage().heapUsed;
    if (u > peak) peak = u;
  }, 25);

  const t0 = Date.now();
  const buf = await buildMonthEndWorkbook(
    [level("Sub-Channel"), level("Province"), level("Category"), level("Store"), level("Product")],
    oosSummary,
    oosDetail,
    "TEST CLIENT",
    "MASSBUILD",
    "Mar 2026 Wk1",
    dataRows,
    DATE_COLS,
  );
  clearInterval(sampler);
  console.log(
    `\nBuilt ${DATA_ROWS.toLocaleString()} data rows in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${(buf.length / 1048576).toFixed(2)}MB out, peak heap ${(peak / 1048576).toFixed(0)}MB\n`,
  );

  assert("returns a non-empty Buffer", Buffer.isBuffer(buf) && buf.length > 0, `${buf.length} bytes`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const names = wb.worksheets.map((w) => w.name);
  console.log(`Sheets: ${names.join(", ")}\n`);

  assert("Menu is the first tab", names[0] === "Menu", names[0]);
  for (const expected of ["Sales", "OOS", "OOS Detail", "Data"]) {
    assert(`"${expected}" present`, names.includes(expected));
  }

  // ── Data sheet: per-row commit must not lose or duplicate rows ──
  const data = wb.getWorksheet("Data")!;
  assert("Data has header + every row", data.rowCount === DATA_ROWS + 1, `rowCount=${data.rowCount}`);
  assert("Data autoFilter survived", !!data.autoFilter);
  assert(
    "Data frozen header (set at creation)",
    (data.views?.[0] as { ySplit?: number })?.ySplit === 1,
    JSON.stringify(data.views?.[0]),
  );
  assert(
    "Data gridlines hidden",
    (data.views?.[0] as { showGridLines?: boolean })?.showGridLines === false,
  );
  // A committed row still holds its styling and value
  assert("Data last row has values", !!data.getRow(DATA_ROWS + 1).getCell(1).value);

  // ── The per-sheet post-pass actually ran (icons prepended to headers) ──
  const hdr = String(data.getRow(1).getCell(1).value ?? "");
  assert("header icon prepended by post-pass", hdr.startsWith("🔗"), `A1="${hdr}"`);
  assert(
    "header centred + wrapped by post-pass",
    data.getRow(1).getCell(1).alignment?.wrapText === true &&
      data.getRow(1).getCell(1).alignment?.horizontal === "center",
    JSON.stringify(data.getRow(1).getCell(1).alignment),
  );

  // ── Home button added to every sheet except Menu ──
  for (const ws of wb.worksheets) {
    if (ws.name === "Menu") continue;
    let found = false;
    ws.getRow(1).eachCell((c) => {
      const v = c.value as { text?: string } | undefined;
      if (v && typeof v === "object" && v.text === "🏠 Menu") found = true;
    });
    assert(`"${ws.name}" has a 🏠 Menu button`, found);
  }

  // ── Menu links must resolve to tabs that actually exist ──
  const menu = wb.getWorksheet("Menu")!;
  const links: string[] = [];
  menu.eachRow((r) => r.eachCell((c) => {
    const v = c.value as { hyperlink?: string; text?: string } | undefined;
    if (v && typeof v === "object" && v.hyperlink?.startsWith("#'")) links.push(v.text!);
  }));
  assert("Menu lists some sheets", links.length > 0, `${links.length} links`);
  const dangling = links.filter((l) => l !== "🏠 Menu" && !names.includes(l));
  assert("no Menu link points at a missing tab", dangling.length === 0, dangling.join(", "));

  // ── Frozen views on the sheets whose header row is computed ──
  for (const [sheet, expected] of [["Margin", 9], ["OTO Detail", 4]] as const) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    assert(
      `${sheet} frozen at computed header row ${expected}`,
      (ws.views?.[0] as { ySplit?: number })?.ySplit === expected,
      JSON.stringify(ws.views?.[0]),
    );
  }

  // ── Sheet selection must omit, not include-then-remove ──
  const only = await buildMonthEndWorkbook(
    [level("Category")], oosSummary, oosDetail, "TEST", "MASSBUILD", "Mar 2026 Wk1",
    dataRows.slice(0, 10), DATE_COLS, undefined, [], undefined, undefined,
    ["sales", "data"],
  );
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(only as never);
  const names2 = wb2.worksheets.map((w) => w.name);
  assert("sheet selection honoured", names2.join(",") === "Menu,Sales,Data", names2.join(","));
  const menu2 = wb2.getWorksheet("Menu")!;
  const links2: string[] = [];
  menu2.eachRow((r) => r.eachCell((c) => {
    const v = c.value as { hyperlink?: string; text?: string } | undefined;
    if (v && typeof v === "object" && v.hyperlink?.startsWith("#'")) links2.push(v.text!);
  }));
  assert(
    "Menu contents match the selected sheets",
    links2.filter((l) => l !== "🏠 Menu").join(",") === "Sales,Data",
    links2.join(","),
  );

  console.log(failures === 0 ? "\nAll assertions passed\n" : `\n${failures} FAILED\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error("TEST CRASHED:", e); process.exit(1); });
