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
} from "./monthEndReport";

// ── Colors ─────────────────────────────────────────────────────

const HEADER_BG = "1F4E79";    // dark blue
const HEADER_FG = "FFFFFF";
const SUBHEADER_BG = "D6E4F0"; // light blue
const TOTAL_BG = "E2EFDA";     // light green
const BORDER_COLOR = "B4C6E7";

const GROWTH_GREEN = "C6EFCE";
const GROWTH_RED = "FFC7CE";

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
  { header: "# Stores", width: 10, key: "storeCount", fmt: "#,##0" },
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
    // Volume table
    row = writeSummaryTable(salesSheet, row, `${level.level} — Volume (Units)`, level.volumeRows, level.volumeTotal, false);
    row += 1; // gap

    // Value table
    row = writeSummaryTable(salesSheet, row, `${level.level} — Value (Rand)`, level.valueRows, level.valueTotal, true);
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
    ["Total SKU × Store Rows", oosSummary.baseCount],
    ["OOS Count (SOH < 1)", oosSummary.oosCount],
    ["OOS %", oosSummary.oosPct / 100],
  ];
  for (const [label, value] of statsData) {
    const labelCell = oosSheet.getCell(row, 1);
    labelCell.value = label as string;
    labelCell.font = bodyFont(true);
    labelCell.border = thinBorder();

    const valueCell = oosSheet.getCell(row, 2);
    valueCell.value = value as number;
    valueCell.font = bodyFont();
    valueCell.border = thinBorder();
    if (typeof value === "number" && (label as string).includes("%")) {
      valueCell.numFmt = "0.0%";
    } else {
      valueCell.numFmt = "#,##0";
    }
    row++;
  }
  row += 2;

  // Product OOS table
  if (oosSummary.productSummary.length > 0) {
    const oosColDefs = [
      { header: "Article", width: 14 },
      { header: "Description", width: 32 },
      { header: "Category", width: 18 },
      { header: "Total Stores", width: 12 },
      { header: "OOS Stores", width: 12 },
      { header: "OOS %", width: 10 },
    ];

    // Header row
    oosColDefs.forEach((col, i) => {
      const cell = oosSheet.getCell(row, i + 1);
      cell.value = col.header;
      cell.font = headerFont();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: i === 0 || i === 1 || i === 2 ? "left" : "center" };
      oosSheet.getColumn(i + 1).width = col.width;
    });
    row++;

    // Data rows
    for (const p of oosSummary.productSummary) {
      const vals = [p.article, p.description, p.category, p.totalStores, p.oosStores, p.oosPct / 100];
      vals.forEach((val, i) => {
        const cell = oosSheet.getCell(row, i + 1);
        cell.value = val as string | number;
        cell.font = bodyFont();
        cell.border = thinBorder();
        if (i === 5) cell.numFmt = "0.0%";
        else if (i >= 3) cell.numFmt = "#,##0";

        // Conditional: red background if OOS % > 50
        if (i === 5 && typeof val === "number" && val > 0.5) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_RED } };
        }
      });
      row++;
    }
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

  // ── Generate buffer ──────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ── Write a single summary table ───────────────────────────────

function writeSummaryTable(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  dataRows: SummaryRow[],
  totalRow: SummaryRow,
  isValue: boolean,
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
    cell.value = col.header;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: i === 0 ? "left" : "center", wrapText: true };
  });
  row++;

  // Data rows
  for (const data of dataRows) {
    row = writeSummaryDataRow(sheet, row, data, isValue);
  }

  // Total row
  row = writeSummaryDataRow(sheet, row, totalRow, isValue, true);

  return row;
}

function writeSummaryDataRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  data: SummaryRow,
  isValue: boolean,
  isTotal = false,
): number {
  const valueFmt = isValue ? "#,##0.00" : "#,##0";

  SUMMARY_COLS.forEach((col, i) => {
    const cell = sheet.getCell(row, i + 1);
    const rawVal = data[col.key as keyof SummaryRow];

    if (col.key === "name") {
      cell.value = rawVal as string;
      cell.alignment = { horizontal: "left" };
    } else if (col.fmt === "0.0%") {
      // Percentage columns — store as decimal for Excel
      if (rawVal === null || rawVal === undefined) {
        cell.value = "";
      } else {
        cell.value = (rawVal as number) / 100;
      }
      cell.numFmt = "0.0%";
      cell.alignment = { horizontal: "center" };

      // Conditional formatting: green for positive, red for negative
      if (typeof rawVal === "number") {
        if (col.key.includes("growth") || col.key.includes("Growth")) {
          if (rawVal > 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_GREEN } };
          } else if (rawVal < 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROWTH_RED } };
          }
        }
      }
    } else if (col.key === "storeCount") {
      cell.value = rawVal as number;
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "center" };
    } else {
      // Numeric value columns (YTD, LY YTD, etc.)
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
