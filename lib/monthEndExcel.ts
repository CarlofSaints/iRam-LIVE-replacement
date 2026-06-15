/* ──────────────────────────────────────────────────────────────
   Month-End Report — Excel builder using exceljs

   3 sheets:
     1. Sales — Cascading summary tables with formatting
     2. OOS — Summary stats + product OOS table
     3. OOS Detail — Granular filtered list (SOH < 1)
   ────────────────────────────────────────────────────────────── */

import ExcelJS from "exceljs";
import type {
  SalesSummaryLevel,
  SummaryRow,
  OOSSummary,
  OOSDetailRow,
  StatusSummary,
  StatusDetailRow,
  MarginAnalysis,
} from "./monthEndReport";

// ── Colors ─────────────────────────────────────────────────────

const HEADER_BG = "1F4E79";    // dark blue
const HEADER_FG = "FFFFFF";
const SUBHEADER_BG = "D6E4F0"; // light blue
const TOTAL_BG = "E2EFDA";     // light green
const BORDER_COLOR = "B4C6E7";

const GROWTH_GREEN = "C6EFCE";
const GROWTH_RED = "FFC7CE";
const UNCLASS_BG = "E7E6E6";   // grey
const MIXED_BG = "FFF2CC";     // amber

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
}

function headerFont(bold = true): Partial<ExcelJS.Font> {
  return { name: "Calibri", size: 10, bold, color: { argb: HEADER_FG } };
}

function bodyFont(bold = false): Partial<ExcelJS.Font> {
  return { name: "Calibri", size: 10, bold };
}

// ── Summary table column definitions ───────────────────────────

const SUMMARY_COLS = [
  { header: "Entity", width: 28, key: "name" },
  { header: "# Stores", width: 13, key: "storeCount", fmt: "#,##0" },
  { header: "YTD", width: 14, key: "ytd", fmt: "#,##0" },
  { header: "LY YTD", width: 14, key: "lyYtd", fmt: "#,##0" },
  { header: "Current Month", width: 14, key: "currentMonth", fmt: "#,##0" },
  { header: "Same Month LY", width: 14, key: "sameMonthLy", fmt: "#,##0" },
  { header: "Last Month", width: 14, key: "lastMonth", fmt: "#,##0" },
  { header: "Growth YTD %", width: 13, key: "growthYtdPct", fmt: "0.0%" },
  { header: "Growth vs LM %", width: 14, key: "growthVsLmPct", fmt: "0.0%" },
  { header: "Growth vs PYM %", width: 14, key: "growthVsPymPct", fmt: "0.0%" },
  { header: "Contribution %", width: 13, key: "contributionPct", fmt: "0.0%" },
];

// ── Build workbook ─────────────────────────────────────────────

export async function buildMonthEndWorkbook(
  levels: SalesSummaryLevel[],
  oosSummary: OOSSummary,
  oosDetail: OOSDetailRow[],
  clientName: string,
  channelLabel: string,
  periodLabel: string,
  dataRows: Record<string, unknown>[] = [],
  dateColumns: string[] = [],
  statusSummary?: StatusSummary,
  statusDetail: StatusDetailRow[] = [],
  marginAnalysis?: MarginAnalysis,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "iRam LIVE Replacement";
  wb.created = new Date();

  // ── Sheet 1: Sales ───────────────────────────────────────────
  const salesSheet = wb.addWorksheet("Sales", {
    properties: { defaultColWidth: 14 },
  });

  // Title row
  let row = 1;
  const titleCell = salesSheet.getCell(row, 1);
  titleCell.value = `Month-End Report — ${clientName} — ${channelLabel} — ${periodLabel}`;
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  salesSheet.mergeCells(row, 1, row, SUMMARY_COLS.length);
  row += 2;

  // Write each level's volume + value tables
  for (const level of levels) {
    // First-column header reflects the dimension; the Store level reports
    // SKU count rather than store count.
    const dim = level.level === "Store" ? "Site" : level.level;
    const countLabel = level.level === "Store" ? "Number of SKU's" : "# Stores";

    // Volume table
    row = writeSummaryTable(salesSheet, row, `${dim} — Volume (Units)`, level.volumeRows, level.volumeTotal, false, dim, countLabel);
    row += 1; // gap

    // Value table
    row = writeSummaryTable(salesSheet, row, `${dim} — Value (Rand)`, level.valueRows, level.valueTotal, true, dim, countLabel);
    row += 2; // larger gap between levels
  }

  // Set column widths
  SUMMARY_COLS.forEach((col, i) => {
    const excelCol = salesSheet.getColumn(i + 1);
    excelCol.width = col.width;
  });

  // ── Sheet 2: OOS ─────────────────────────────────────────────
  const oosSheet = wb.addWorksheet("OOS", {
    properties: { defaultColWidth: 14 },
  });

  row = 1;

  // Title
  const oosTitleCell = oosSheet.getCell(row, 1);
  oosTitleCell.value = `OOS Summary — ${clientName} — ${channelLabel} — ${periodLabel}`;
  oosTitleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  oosSheet.mergeCells(row, 1, row, 5);
  row += 2;

  // Summary stats
  const statsData = [
    ["Base (SKU×store with stock and/or sales)", oosSummary.baseCount],
    ["OOS Count (SOH ≤ 0)", oosSummary.oosCount],
    ["OOS %", oosSummary.oosPct / 100],
  ];
  const statsStartRow = row; // base count row; oos count = +1; oos % = +2
  for (const [label, value] of statsData) {
    const labelCell = oosSheet.getCell(row, 1);
    labelCell.value = label as string;
    labelCell.font = bodyFont(true);
    labelCell.border = thinBorder();

    const valueCell = oosSheet.getCell(row, 2);
    valueCell.font = bodyFont();
    valueCell.border = thinBorder();
    if (typeof value === "number" && (label as string).includes("%")) {
      // OOS % = OOS count / base count, as a live formula
      valueCell.value = { formula: `IF(B${statsStartRow}=0,0,B${statsStartRow + 1}/B${statsStartRow})`, result: value as number };
      valueCell.numFmt = "0.0%";
    } else {
      valueCell.value = value as number;
      valueCell.numFmt = "#,##0";
    }
    row++;
  }
  row += 2;

  // Helper: write a section sub-header bar spanning the 6 OOS columns
  const writeOosTitle = (title: string) => {
    const t = oosSheet.getCell(row, 1);
    t.value = title;
    t.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    oosSheet.mergeCells(row, 1, row, 6);
    for (let c = 1; c <= 6; c++) oosSheet.getCell(row, c).border = thinBorder();
    row++;
  };

  // Helper: write an OOS table (header + data rows). Returns nothing; advances `row`.
  const writeOosTable = (
    headers: string[],
    widths: number[],
    dataRows: (string | number)[][],
    pctColIndex: number,
  ) => {
    headers.forEach((h, i) => {
      const cell = oosSheet.getCell(row, i + 1);
      cell.value = h;
      cell.font = headerFont();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: i <= 2 ? "left" : "center" };
      oosSheet.getColumn(i + 1).width = Math.max(oosSheet.getColumn(i + 1).width ?? 0, widths[i]);
    });
    row++;
    // OOS % = OOS count / base count, as a live formula referencing this row.
    const totalL = String.fromCharCode(65 + (pctColIndex - 2));
    const oosL = String.fromCharCode(65 + (pctColIndex - 1));
    for (const vals of dataRows) {
      vals.forEach((val, i) => {
        const cell = oosSheet.getCell(row, i + 1);
        if (i === pctColIndex) {
          cell.value = { formula: `IF(${totalL}${row}=0,0,${oosL}${row}/${totalL}${row})`, result: typeof val === "number" ? val : 0 };
          cell.numFmt = "0.0%";
        } else {
          cell.value = val;
          if (i >= 3) cell.numFmt = "#,##0";
        }
        cell.font = bodyFont();
        cell.border = thinBorder();
        // Conditional: red background when OOS % > 50
        if (i === pctColIndex && typeof val === "number" && val > 0.5) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_RED } };
        }
      });
      row++;
    }
  };

  // SKU OOS Summary (per product)
  if (oosSummary.productSummary.length > 0) {
    writeOosTitle("SKU OOS Summary");
    writeOosTable(
      ["Article", "Description", "Category", "Total Stores", "OOS Stores", "OOS %"],
      [14, 32, 18, 12, 12, 10],
      oosSummary.productSummary.map((p) => [p.article, p.description, p.category, p.totalStores, p.oosStores, p.oosPct / 100]),
      5,
    );
    row += 2; // gap before the next table
  }

  // Store OOS Summary (per store) — mirrors the SKU summary
  if (oosSummary.storeSummary.length > 0) {
    writeOosTitle("Store OOS Summary");
    writeOosTable(
      ["Site", "Site Name", "Sub-Channel", "Total SKUs", "OOS SKUs", "OOS %"],
      [12, 28, 16, 12, 12, 10],
      oosSummary.storeSummary.map((s) => [s.site, s.siteName, s.subChannel, s.totalSkus, s.oosSkus, s.oosPct / 100]),
      5,
    );
  }

  // ── Sheet 3: OOS Detail ──────────────────────────────────────
  const detailSheet = wb.addWorksheet("OOS Detail", {
    properties: { defaultColWidth: 14 },
  });

  const detailColDefs = [
    { header: "Sub-Channel", width: 14, key: "subChannel" as const },
    { header: "Province", width: 14, key: "province" as const },
    { header: "Category", width: 16, key: "category" as const },
    { header: "Sub-Category", width: 16, key: "subCategory" as const },
    { header: "Brand", width: 14, key: "brand" as const },
    { header: "Article", width: 12, key: "article" as const },
    { header: "Description", width: 30, key: "description" as const },
    { header: "Site", width: 10, key: "site" as const },
    { header: "Site Name", width: 22, key: "siteName" as const },
    { header: "SOH", width: 8, key: "soh" as const },
    { header: "SOO", width: 8, key: "soo" as const },
    { header: "SIT", width: 8, key: "sit" as const },
    { header: "Status", width: 10, key: "status" as const },
    { header: "Product Status", width: 14, key: "productStatus" as const },
    { header: "DSC Alert", width: 12, key: "dscAlert" as const },
    { header: "Date Last Sold", width: 14, key: "dateLastSold" as const },
  ];

  row = 1;
  // Header
  detailColDefs.forEach((col, i) => {
    const cell = detailSheet.getCell(row, i + 1);
    cell.value = col.header;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    detailSheet.getColumn(i + 1).width = col.width;
  });
  row++;

  // Data
  for (const d of oosDetail) {
    detailColDefs.forEach((col, i) => {
      const cell = detailSheet.getCell(row, i + 1);
      cell.value = d[col.key] as string | number;
      cell.font = bodyFont();
      cell.border = thinBorder();
      if (["soh", "soo", "sit"].includes(col.key)) {
        cell.numFmt = "#,##0";
      }
    });
    row++;
  }

  // Auto-filter on detail
  if (oosDetail.length > 0) {
    detailSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: oosDetail.length + 1, column: detailColDefs.length },
    };
  }

  // Freeze top row on detail sheet
  detailSheet.views = [{ state: "frozen", ySplit: 1 }];

  // ── Status + Status Detail sheets ────────────────────────────
  if (statusSummary) buildStatusSheet(wb, statusSummary, clientName, channelLabel, periodLabel);
  if (statusDetail.length > 0) buildStatusDetailSheet(wb, statusDetail);

  // ── Margin + Margin Detail sheets ────────────────────────────
  if (marginAnalysis) {
    buildMarginSheet(wb, marginAnalysis, clientName, channelLabel, periodLabel);
    buildMarginDetailSheet(wb, marginAnalysis);
  }

  // ── Data sheet (flat enriched rows + native AutoFilter) ──────
  if (dataRows.length > 0) {
    buildDataSheet(wb, dataRows, dateColumns);
  }

  // ── Generate buffer ──────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Flat data sheet — every enriched row, with Excel AutoFilter so the
//    user can slice by any column (sub-channel, category, …) inside Excel.
function buildDataSheet(
  wb: ExcelJS.Workbook,
  rows: Record<string, unknown>[],
  dateColumns: string[],
): void {
  const sheet = wb.addWorksheet("Data", { properties: { defaultColWidth: 14 } });

  const sortedDates = [...dateColumns].sort((a, b) => {
    const pa = a.match(/^(\d{2})-(\d{4})$/);
    const pb = b.match(/^(\d{2})-(\d{4})$/);
    if (!pa || !pb) return a.localeCompare(b);
    return (Number(pa[2]) * 100 + Number(pa[1])) - (Number(pb[2]) * 100 + Number(pb[1]));
  });

  // Fixed dimension/measure columns: [header, width, accessor]
  const fixedCols: { header: string; width: number; get: (r: Record<string, unknown>) => string | number }[] = [
    { header: "Sub-Channel", width: 14, get: (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || "") },
    { header: "Province", width: 14, get: (r) => String(r["_province"] || "") },
    { header: "Category", width: 16, get: (r) => String(r["_category"] || "") },
    { header: "Sub-Category", width: 16, get: (r) => String(r["_subCategory"] || "") },
    { header: "Brand", width: 14, get: (r) => String(r["_brand"] || "") },
    { header: "Article", width: 12, get: (r) => String(r["Article"] ?? "") },
    { header: "Description", width: 30, get: (r) => String(r["Article Desc"] ?? "") },
    { header: "Site", width: 10, get: (r) => String(r["Site"] ?? "") },
    { header: "Site Name", width: 22, get: (r) => String(r["_storeName"] || r["Site Name"] || "") },
    { header: "Status", width: 10, get: (r) => String(r["Status"] ?? r["PR ST"] ?? "") },
    { header: "Product Status", width: 14, get: (r) => String(r["_productStatus"] || "") },
    { header: "SOH", width: 8, get: (r) => toNum(r["SOH"]) },
    { header: "SOO", width: 8, get: (r) => toNum(r["SOO"]) },
    { header: "SIT", width: 8, get: (r) => toNum(r["SIT"]) },
  ];
  const tailCols: { header: string; width: number; get: (r: Record<string, unknown>) => string | number }[] = [
    { header: "Incl SP", width: 10, get: (r) => toNum(r["Incl SP"]) },
    { header: "Prom SP", width: 10, get: (r) => toNum(r["Prom SP"]) },
    { header: "Nett Cost", width: 10, get: (r) => toNum(r["Nett Cost"]) },
    { header: "Act DSC", width: 9, get: (r) => toNum(r["Act DSC"]) },
  ];

  // Header row
  const headers = [...fixedCols.map((c) => c.header), ...sortedDates, ...tailCols.map((c) => c.header)];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
  });
  // Column widths
  [...fixedCols.map((c) => c.width), ...sortedDates.map(() => 9), ...tailCols.map((c) => c.width)]
    .forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // Data rows
  let r = 2;
  for (const row of rows) {
    let c = 1;
    for (const col of fixedCols) {
      const cell = sheet.getCell(r, c++);
      cell.value = col.get(row);
      cell.font = bodyFont();
    }
    for (const dc of sortedDates) {
      const cell = sheet.getCell(r, c++);
      cell.value = toNum(row[dc]);
      cell.numFmt = "#,##0";
      cell.font = bodyFont();
    }
    for (const col of tailCols) {
      const cell = sheet.getCell(r, c++);
      cell.value = col.get(row);
      cell.numFmt = "#,##0.00";
      cell.font = bodyFont();
    }
    r++;
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

// ── Status sheet — PR ST breakdown + PR ST × PMF Product Status ──
function buildStatusSheet(
  wb: ExcelJS.Workbook,
  s: StatusSummary,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): void {
  const sheet = wb.addWorksheet("Status", { properties: { defaultColWidth: 14 } });
  let row = 1;

  const title = sheet.getCell(row, 1);
  title.value = `Status — PMF Product Status vs DISPO PR ST — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(row, 1, row, 5);
  row += 2;

  // Base stat (referenced by % Cont formulas)
  const baseRow = row;
  const bl = sheet.getCell(row, 1);
  bl.value = "Base (SKU×store with stock and/or sales)";
  bl.font = bodyFont(true);
  bl.border = thinBorder();
  const bv = sheet.getCell(row, 2);
  bv.value = s.baseCount;
  bv.numFmt = "#,##0";
  bv.font = bodyFont();
  bv.border = thinBorder();
  row += 2;

  const titleBar = (text: string, span: number) => {
    const c = sheet.getCell(row, 1);
    c.value = text;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    sheet.mergeCells(row, 1, row, span);
    for (let cc = 1; cc <= span; cc++) sheet.getCell(row, cc).border = thinBorder();
    row++;
  };
  const headerRow = (headers: string[]) => {
    headers.forEach((h, i) => {
      const c = sheet.getCell(row, i + 1);
      c.value = h;
      c.font = headerFont();
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      c.border = thinBorder();
      c.alignment = { horizontal: i === 0 || i === 1 ? "left" : "center" };
    });
    row++;
  };

  // Table 1 — PR ST Breakdown
  titleBar("PR ST Breakdown", 3);
  headerRow(["PR ST", "Count", "% Cont"]);
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 12;
  for (const r of s.prst) {
    const a = sheet.getCell(row, 1); a.value = r.prst; a.font = bodyFont(); a.border = thinBorder();
    const cnt = sheet.getCell(row, 2); cnt.value = r.count; cnt.numFmt = "#,##0"; cnt.font = bodyFont(); cnt.border = thinBorder(); cnt.alignment = { horizontal: "center" };
    const pct = sheet.getCell(row, 3);
    pct.value = { formula: `IF($B$${baseRow}=0,0,B${row}/$B$${baseRow})`, result: r.contributionPct / 100 };
    pct.numFmt = "0.0%"; pct.font = bodyFont(); pct.border = thinBorder(); pct.alignment = { horizontal: "center" };
    row++;
  }
  row += 2;

  // Table 2 — PR ST by Product Status (with classification colour)
  titleBar("PR ST by Product Status", 5);
  headerRow(["Product Status", "PR ST", "Count", "% Cont", "Classification"]);
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 16;
  for (const r of s.prstByPmf) {
    const a = sheet.getCell(row, 1); a.value = r.pmfStatus; a.font = bodyFont(); a.border = thinBorder();
    const b = sheet.getCell(row, 2); b.value = r.prst; b.font = bodyFont(); b.border = thinBorder();
    const cnt = sheet.getCell(row, 3); cnt.value = r.count; cnt.numFmt = "#,##0"; cnt.font = bodyFont(); cnt.border = thinBorder(); cnt.alignment = { horizontal: "center" };
    const pct = sheet.getCell(row, 4);
    pct.value = { formula: `IF($B$${baseRow}=0,0,C${row}/$B$${baseRow})`, result: r.contributionPct / 100 };
    pct.numFmt = "0.0%"; pct.font = bodyFont(); pct.border = thinBorder(); pct.alignment = { horizontal: "center" };
    const cls = sheet.getCell(row, 5);
    cls.value = r.classification;
    cls.font = bodyFont(true); cls.border = thinBorder(); cls.alignment = { horizontal: "center" };
    const fill =
      r.classification === "POSITIVE" ? GROWTH_GREEN :
      r.classification === "NEGATIVE" ? GROWTH_RED :
      r.classification === "MIXED" ? MIXED_BG : UNCLASS_BG;
    cls.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row++;
  }
}

// ── Status Detail — negative SKU×store combinations only ────────
function buildStatusDetailSheet(wb: ExcelJS.Workbook, rows: StatusDetailRow[]): void {
  const sheet = wb.addWorksheet("Status Detail", { properties: { defaultColWidth: 14 } });
  const cols: { header: string; width: number; key: keyof StatusDetailRow }[] = [
    { header: "Sub-Channel", width: 14, key: "subChannel" },
    { header: "Province", width: 14, key: "province" },
    { header: "Category", width: 16, key: "category" },
    { header: "Brand", width: 14, key: "brand" },
    { header: "Article", width: 12, key: "article" },
    { header: "Description", width: 30, key: "description" },
    { header: "Site", width: 10, key: "site" },
    { header: "Site Name", width: 22, key: "siteName" },
    { header: "PR ST", width: 10, key: "prst" },
    { header: "Product Status", width: 14, key: "productStatus" },
    { header: "Ranging", width: 10, key: "ranging" },
  ];

  cols.forEach((c, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = c.header;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    sheet.getColumn(i + 1).width = c.width;
  });

  let r = 2;
  for (const row of rows) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = row[c.key];
      cell.font = bodyFont();
      cell.border = thinBorder();
    });
    r++;
  }

  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Margin sheet — opportunity / risk summary ───────────────────
function buildMarginSheet(
  wb: ExcelJS.Workbook,
  m: MarginAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): void {
  const sheet = wb.addWorksheet("Margin", { properties: { defaultColWidth: 16 } });
  let row = 1;

  const title = sheet.getCell(row, 1);
  title.value = `Margin Opportunity & Risk — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(row, 1, row, 4);
  row += 2;

  const bl = sheet.getCell(row, 1);
  bl.value = "Base (SKU×store, SOH>0, valid cost)";
  bl.font = bodyFont(true);
  bl.border = thinBorder();
  const bv = sheet.getCell(row, 2);
  bv.value = m.summary.base;
  bv.numFmt = "#,##0";
  bv.font = bodyFont();
  bv.border = thinBorder();
  row += 2;

  const headers = ["Margin Status", "Count", "Total Margin Support (R)", "Total Free Stock Units"];
  const widths = [18, 12, 24, 22];
  headers.forEach((h, i) => {
    const c = sheet.getCell(row, i + 1);
    c.value = h;
    c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder();
    c.alignment = { horizontal: i === 0 ? "left" : "center", wrapText: true };
    sheet.getColumn(i + 1).width = widths[i];
  });
  row++;

  const summaryRows = [
    { label: "OPPORTUNITY", count: m.summary.opportunityCount, support: null as number | null, free: null as number | null, fill: GROWTH_GREEN },
    { label: "RISK", count: m.summary.riskCount, support: m.summary.totalMarginSupport, free: m.summary.totalFreeStockUnits, fill: GROWTH_RED },
  ];
  for (const sr of summaryRows) {
    const a = sheet.getCell(row, 1);
    a.value = sr.label; a.font = bodyFont(true); a.border = thinBorder();
    a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sr.fill } };
    const c = sheet.getCell(row, 2);
    c.value = sr.count; c.numFmt = "#,##0"; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "center" };
    const s = sheet.getCell(row, 3);
    s.value = sr.support === null ? "" : sr.support; if (sr.support !== null) s.numFmt = "#,##0.00";
    s.font = bodyFont(); s.border = thinBorder(); s.alignment = { horizontal: "right" };
    const f = sheet.getCell(row, 4);
    f.value = sr.free === null ? "" : sr.free; if (sr.free !== null) f.numFmt = "#,##0.00";
    f.font = bodyFont(); f.border = thinBorder(); f.alignment = { horizontal: "right" };
    row++;
  }
}

// ── Margin Detail — one row per opportunity / risk, calculations live ──
function buildMarginDetailSheet(wb: ExcelJS.Workbook, m: MarginAnalysis): void {
  const sheet = wb.addWorksheet("Margin Detail", { properties: { defaultColWidth: 14 } });
  const headers = [
    "Site", "Site Name", "Product Code", "Article", "Product Status", "PR ST",
    "SOH", "MAC", "Nett Cost", "Incl SP", "Prod. Margin", "STK Margin",
    "MAC vs Nett Cost", "Margin Status", "Margin Support (R)", "Free Stock Units", "Suggested SP (Incl VAT)",
  ];
  const widths = [10, 22, 14, 12, 14, 10, 8, 10, 10, 10, 12, 11, 15, 14, 16, 14, 18];
  headers.forEach((h, i) => {
    const c = sheet.getCell(1, i + 1);
    c.value = h;
    c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder();
    c.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = widths[i];
  });

  let r = 2;
  for (const row of m.rows) {
    const text = (col: number, val: string) => {
      const c = sheet.getCell(r, col); c.value = val; c.font = bodyFont(); c.border = thinBorder(); return c;
    };
    const num = (col: number, val: number, fmt: string) => {
      const c = sheet.getCell(r, col); c.value = val; c.numFmt = fmt; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "right" }; return c;
    };
    const formula = (col: number, f: string, result: number | string, fmt: string) => {
      const c = sheet.getCell(r, col); c.value = { formula: f, result }; c.numFmt = fmt; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "right" }; return c;
    };

    text(1, row.site);
    text(2, row.siteName);
    text(3, row.productCode);
    text(4, row.article);
    text(5, row.productStatus);
    text(6, row.prst);
    num(7, row.soh, "#,##0");
    num(8, row.mac, "#,##0.00");
    num(9, row.nettCost, "#,##0.00");
    num(10, row.inclSP, "#,##0.00");
    // Prod. Margin = ((Incl SP/1.15) − Nett) / (Incl SP/1.15)
    formula(11, `IF(J${r}=0,0,((J${r}/1.15)-I${r})/(J${r}/1.15))`, row.prodMargin, "0.0%").alignment = { horizontal: "center" };
    num(12, row.stkMargin, "0.0%").alignment = { horizontal: "center" };
    // MAC vs Nett Cost = Nett − MAC
    formula(13, `I${r}-H${r}`, row.macVsNett, "#,##0.00");
    // Margin Status (coloured)
    const st = text(14, row.marginStatus);
    st.font = bodyFont(true); st.alignment = { horizontal: "center" };
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.marginStatus === "RISK" ? GROWTH_RED : GROWTH_GREEN } };
    // Margin Support (R) = RISK: SOH × (MAC − Nett)
    formula(15, `IF(N${r}="RISK",G${r}*(H${r}-I${r}),"")`, row.marginSupport === null ? "" : row.marginSupport, "#,##0.00");
    // Free Stock Units = RISK: Margin Support / Nett
    formula(16, `IF(AND(N${r}="RISK",I${r}<>0),O${r}/I${r},"")`, row.freeStockUnits === null ? "" : row.freeStockUnits, "#,##0.00");
    // Suggested SP (Incl VAT) = OPPORTUNITY: MAC / (1 − Prod. Margin) × 1.15
    formula(17, `IF(AND(N${r}="OPPORTUNITY",(1-K${r})<>0),H${r}/(1-K${r})*1.15,"")`, row.suggestedSP === null ? "" : row.suggestedSP, "#,##0.00");
    r++;
  }

  if (m.rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: m.rows.length + 1, column: headers.length } };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Write a single summary table ───────────────────────────────

function writeSummaryTable(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  dataRows: SummaryRow[],
  totalRow: SummaryRow,
  isValue: boolean,
  dimLabel: string,
  countLabel: string,
): number {
  let row = startRow;

  // Sub-header (table title)
  const subHeaderCell = sheet.getCell(row, 1);
  subHeaderCell.value = title;
  subHeaderCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
  subHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
  sheet.mergeCells(row, 1, row, SUMMARY_COLS.length);
  for (let c = 1; c <= SUMMARY_COLS.length; c++) {
    sheet.getCell(row, c).border = thinBorder();
  }
  row++;

  // Column headers
  SUMMARY_COLS.forEach((col, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = i === 0 ? dimLabel : i === 1 ? countLabel : col.header;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: i === 0 ? "left" : "center", wrapText: true };
  });
  row++;

  // Data rows + total row. Addresses are computed up-front so the
  // contribution % and the total's SUM can reference real cells —
  // the calculations stay live and auditable in the workbook.
  const firstDataRow = row;
  const lastDataRow = row + dataRows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const ctx = { totalRowNum, firstDataRow, lastDataRow };

  for (const data of dataRows) {
    row = writeSummaryDataRow(sheet, row, data, isValue, false, ctx);
  }

  // Total row
  row = writeSummaryDataRow(sheet, row, totalRow, isValue, true, ctx);

  return row;
}

const VALUE_KEYS = new Set(["ytd", "lyYtd", "currentMonth", "sameMonthLy", "lastMonth"]);

function writeSummaryDataRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  data: SummaryRow,
  isValue: boolean,
  isTotal: boolean,
  ctx: { totalRowNum: number; firstDataRow: number; lastDataRow: number },
): number {
  const valueFmt = isValue ? "#,##0.00" : "#,##0";
  const hasData = ctx.lastDataRow >= ctx.firstDataRow;
  const T = ctx.totalRowNum;
  // Column letters (fixed layout): C=YTD D=LY YTD E=Current Month F=Same Month LY G=Last Month
  SUMMARY_COLS.forEach((col, i) => {
    const cell = sheet.getCell(row, i + 1);
    const rawVal = data[col.key as keyof SummaryRow];
    const colL = String.fromCharCode(65 + i);

    if (col.key === "name") {
      cell.value = rawVal as string;
      cell.alignment = { horizontal: "left" };
    } else if (col.key === "storeCount") {
      cell.value = rawVal as number;
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "center" };
    } else if (VALUE_KEYS.has(col.key)) {
      // YTD / LY YTD / Current Month / Same Month LY / Last Month.
      // Total row sums the data rows above with a live SUM formula.
      if (isTotal && hasData) {
        cell.value = { formula: `SUM(${colL}${ctx.firstDataRow}:${colL}${ctx.lastDataRow})`, result: rawVal as number };
      } else {
        cell.value = rawVal as number;
      }
      cell.numFmt = valueFmt;
      cell.alignment = { horizontal: "right" };
    } else if (col.key === "contributionPct") {
      // YTD share of the table total (references the total row's YTD cell)
      const result = rawVal === null || rawVal === undefined ? 0 : (rawVal as number) / 100;
      cell.value = { formula: `IF($C$${T}=0,0,C${row}/$C$${T})`, result };
      cell.numFmt = "0.0%";
      cell.alignment = { horizontal: "center" };
    } else if (col.fmt === "0.0%") {
      // Growth columns — live formulas referencing this row's own value cells
      let formula = "";
      if (col.key === "growthYtdPct") formula = `IF(D${row}=0,"",(C${row}-D${row})/ABS(D${row}))`;
      else if (col.key === "growthVsLmPct") formula = `IF(G${row}=0,"",(E${row}-G${row})/ABS(G${row}))`;
      else if (col.key === "growthVsPymPct") formula = `IF(F${row}=0,"",(E${row}-F${row})/ABS(F${row}))`;

      const result = typeof rawVal === "number" ? rawVal / 100 : "";
      cell.value = { formula, result };
      cell.numFmt = "0.0%";
      cell.alignment = { horizontal: "center" };

      // Conditional formatting: green for positive, red for negative
      if (typeof rawVal === "number") {
        if (rawVal > 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_GREEN } };
        else if (rawVal < 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_RED } };
      }
    } else {
      cell.value = rawVal as number;
      cell.numFmt = valueFmt;
      cell.alignment = { horizontal: "right" };
    }

    cell.font = bodyFont(isTotal);
    cell.border = thinBorder();

    if (isTotal) {
      cell.fill = cell.fill?.type === "pattern" && cell.fill?.fgColor?.argb !== undefined
        ? cell.fill  // preserve growth color
        : { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    }
  });

  return row + 1;
}
