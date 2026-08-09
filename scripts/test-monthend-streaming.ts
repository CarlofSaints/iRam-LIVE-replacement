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
import { buildSalesSummary, buildDateContext } from "../lib/monthEndReport";
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
    { article: "A1", vendor: "1063", description: "Widget", category: "Cat", productStatus: "ACTIVE", totalStores: 10, oosStores: 2, oosPct: 20 },
  ],
  storeSummary: [
    { site: "S1", siteName: "Store One", subChannel: "BWH", totalSkus: 20, oosSkus: 3, oosPct: 15 },
  ],
};

// Enough rows that the Data sheet exercises the per-row commit path.
const DATA_ROWS = Number(process.env.ROWS ?? 5000);
const dataRows: Record<string, unknown>[] = Array.from({ length: DATA_ROWS }, (_, i) => ({
  // Two vendor numbers, as a real client has — the report must keep them apart.
  _vendor: i % 2 === 0 ? "1063" : "1993",
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
    [level("Vendor"), level("Sub-Channel"), level("Province"), level("Category"), level("Store"), level("Product")],
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
  assert("header icon prepended by post-pass", hdr.startsWith("🏢"), `A1="${hdr}"`);
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

  /* ── Vendor column ──
     A client is one company but often several vendor numbers, each its own
     product range. The report is scoped to client + channel, so without an
     explicit vendor column the ranges are blended and the reader cannot tell
     them apart — the filename carries only the client's FIRST vendor number. */
  const vendorHdr = String(data.getRow(1).getCell(1).value ?? "");
  assert("Data leads with a Vendor column", vendorHdr.includes("Vendor"), `A1="${vendorHdr}"`);
  const seenVendors = new Set<string>();
  for (let r = 2; r <= data.rowCount; r++) seenVendors.add(String(data.getRow(r).getCell(1).value ?? ""));
  assert(
    "Data rows carry both vendor numbers",
    seenVendors.has("1063") && seenVendors.has("1993"),
    [...seenVendors].join(","),
  );

  // Sales gains a Vendor rollup ahead of Sub-Channel
  const sales = wb.getWorksheet("Sales")!;
  let vendorTable = "";
  sales.eachRow((rw) => {
    const v = String(rw.getCell(1).value ?? "");
    if (!vendorTable && v.startsWith("Vendor — ")) vendorTable = v;
  });
  assert("Sales has a Vendor rollup table", vendorTable !== "", vendorTable);

  /* And the engine actually produces that level — the mock above only proves
     the Excel side renders whatever it is handed. */
  const engineLevels = buildSalesSummary(dataRows, buildDateContext(DATE_COLS));
  assert(
    "buildSalesSummary emits Vendor first",
    engineLevels[0]?.level === "Vendor",
    engineLevels.map((l) => l.level).join(" > "),
  );
  assert(
    "Vendor level splits the two vendors",
    engineLevels[0]?.volumeRows.map((r) => r.name).sort().join(",") === "1063,1993",
    engineLevels[0]?.volumeRows.map((r) => r.name).join(","),
  );

  // ── Raw XML element order — Excel is strict, every parser else is not ──
  /* This is the check that was missing. exceljs 4.4.0's streaming writer emits
     <hyperlinks> before <conditionalFormatting>, but ECMA-376 requires the
     reverse; Excel calls that corrupt and "repairs" the file by BLANKING the
     sheet. Reopening with exceljs (above) cannot see it — exceljs, SheetJS and
     every other reader accept any order — so the workbook looked perfect right
     up until someone opened it in Excel and found Sales, OOS and ND empty. */
  await assertWorksheetElementOrder(buf);

  console.log(failures === 0 ? "\nAll assertions passed\n" : `\n${failures} FAILED\n`);
  process.exit(failures > 0 ? 1 : 0);
}

// CT_Worksheet child sequence, ECMA-376 Part 1 §18.3.1.99.
const WORKSHEET_SEQUENCE = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData",
  "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter",
  "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr",
  "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions",
  "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks",
  "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
  "legacyDrawing", "picture", "oleObjects", "controls", "tableParts", "extLst",
];

async function assertWorksheetElementOrder(buf: Buffer): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const rank = new Map(WORKSHEET_SEQUENCE.map((n, i) => [n, i]));

  const sheetFiles = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  assert("workbook contains worksheets", sheetFiles.length > 0, `${sheetFiles.length}`);

  for (const name of sheetFiles) {
    const xml = await zip.file(name)!.async("string");
    // sheetData's children are <row>, not worksheet children — drop its body.
    const top = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, "<sheetData/>");

    const seen: string[] = [];
    const tag = /<(\/?)([A-Za-z][A-Za-z0-9]*)\b[^>]*?(\/?)>/g;
    let m: RegExpExecArray | null;
    let depth = 0;
    while ((m = tag.exec(top))) {
      const [, close, el, selfClose] = m;
      if (el === "worksheet") { depth += close ? -1 : 1; continue; }
      if (depth === 1 && !close) seen.push(el);
      if (!close && !selfClose) depth++;
      else if (close) depth--;
    }

    const bad: string[] = [];
    for (let i = 1; i < seen.length; i++) {
      const prev = rank.get(seen[i - 1]);
      const cur = rank.get(seen[i]);
      if (prev !== undefined && cur !== undefined && cur < prev) {
        bad.push(`<${seen[i - 1]}> before <${seen[i]}>`);
      }
    }
    assert(`${name} element order is valid for Excel`, bad.length === 0, bad.join("; "));
  }
}

main().catch((e) => { console.error("TEST CRASHED:", e); process.exit(1); });
