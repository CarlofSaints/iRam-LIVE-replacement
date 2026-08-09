/* ──────────────────────────────────────────────────────────────
   Month-End Report — Excel builder using exceljs

   3 sheets:
     1. Sales — Cascading summary tables with formatting
     2. OOS — Summary stats + product OOS table
     3. OOS Detail — Granular filtered list (SOH < 1)
   ────────────────────────────────────────────────────────────── */

import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import type {
  SalesSummaryLevel,
  SummaryRow,
  OOSSummary,
  OOSDetailRow,
  DscSummary,
  DscDetailRow,
  StatusSummary,
  StatusDetailRow,
  MarginAnalysis,
  PhantomAnalysis,
  NDAnalysis,
  OTOAnalysis,
} from "./monthEndReport";
import { buildDateContext, dataRowExtras } from "./monthEndReport";
import { analyzeCoverage, coverageMessageLines, formatMonth } from "./dataCoverage";
import { applyStreamWriterOrderFix } from "./exceljsStreamOrder";

// ── Colors ─────────────────────────────────────────────────────

const HEADER_BG = "1F4E79";    // dark blue
const HEADER_FG = "FFFFFF";
const SUBHEADER_BG = "D6E4F0"; // light blue
const TOTAL_BG = "E2EFDA";     // light green
const BORDER_COLOR = "B4C6E7";

// South African Rand number format for monetary (value) cells.
const RAND_FMT = '"R "#,##0.00';

const GROWTH_GREEN = "C6EFCE";
const GROWTH_RED = "FFC7CE";
const UNCLASS_BG = "E7E6E6";   // grey
const MIXED_BG = "FFF2CC";     // amber

// Emoji "icons" prepended to column headings (keyed by lower-cased header text).
const HEADER_ICONS: Record<string, string> = {
  vendor: "🏢",
  "sub-channel": "🔗", province: "📍", category: "🏷️", "sub-category": "🏷️",
  site: "🏬", store: "🏬", "site name": "🏬", product: "📦", article: "📦",
  "product code": "#️⃣", description: "📝", brand: "🏷️",
  "pr st": "🔖", status: "🔖", "product status": "✅", "pmf status": "✅",
  soh: "📦", soo: "🚚", sit: "🚛",
  ytd: "📈", "ytd units": "📈", "ytd value": "💰", "py ytd units": "📉", "py ytd value": "💵",
  "ly ytd": "📉", "current month": "📅", "same month ly": "🗓️", "last month": "📆",
  "units growth %": "📊", "value growth %": "📊",
  "growth ytd %": "📊", "growth vs lm %": "📊", "growth vs pym %": "📊",
  "contribution %": "🥧", "# stores": "🏬", "number of sku's": "🔢", count: "🔢",
  "total stores": "🏬", "oos stores": "⚠️", "oos %": "⚠️", "total skus": "🔢", "oos skus": "⚠️",
  mac: "💲", "nett cost": "💲", "incl sp": "💲", "prom sp": "💲",
  "prod. margin": "📐", "stk margin": "📐", "mac vs nett cost": "⚖️", "margin status": "⚖️",
  "margin support (r)": "💰", "free stock units": "📦", "suggested sp (incl vat)": "💲",
  "phantom lines": "👻", "total lines": "🔢", "phantom %": "👻",
  "date last sold": "📅", "date last received": "📅", ranging: "📋", classification: "🏷️",
  "act dsc": "⏳", "dsc bracket": "⏳", bracket: "⏳", "soh (units)": "📦",
  "total soh": "📦", "soh %": "📦",
};

/* ── Streaming ────────────────────────────────────────────────────
   Built with exceljs's streaming WorkbookWriter, not the in-memory Workbook.
   The in-memory one holds a styled object per cell for EVERY sheet at once and
   then assembles the whole XML on top of that at write time; at TOPLINE's size
   (87,854 ledger rows) that needs ~6GB and the function was OOM-killed at 42s
   with no JSON body, which is why the failure was so opaque. Streaming commits
   each sheet as it finishes and frees it — measured peak 1.4GB for the same
   data, and the Data sheet additionally commits row-by-row.

   Three WorksheetWriter constraints are worked around below, and all three are
   easy to reintroduce by accident:

     1. `sheet.views` is GETTER-ONLY and mutating the array in place is a
        SILENT failure — it reads back correctly in memory but lands as null in
        the file, because the sheetView XML is written when the sheet opens.
        Views must go through `sheetOpts()` at addWorksheet time. That is why
        the three sheets whose freeze row used to be computed mid-build
        (Margin, Phantom, OTO Detail) now derive it beforehand.
     2. `sheet.columnCount` is undefined — see `columnExtent()`.
     3. There is no `removeWorksheet`, so an unselected sheet must never be
        created, rather than being created and removed afterwards.

   Also unavailable: `addImage`. The Menu cover sheet's client/channel logos
   cannot be embedded in streaming mode (WorksheetWriter has only
   addBackgroundImage, which tiles and does not print), so they were dropped —
   a deliberate call; the report is otherwise identical. */

type SheetTarget = ExcelJS.Worksheet & { commit?: () => Promise<void> | void };

// Standard options for every sheet. Gridlines are hidden here because the old
// build did it in a post-pass over wb.worksheets, which is impossible once a
// sheet has been committed and freed.
function sheetOpts(
  view?: Partial<ExcelJS.WorksheetView>,
): Partial<ExcelJS.AddWorksheetOptions> {
  return {
    properties: { defaultColWidth: 14 },
    views: [{ showGridLines: false, ...(view ?? {}) } as ExcelJS.WorksheetView],
  };
}

// WorksheetWriter has no columnCount; every sheet here writes a full-width
// header row, so its cell count is the same thing.
function columnExtent(sheet: ExcelJS.Worksheet): number {
  try {
    return sheet.getRow(1).cellCount || 1;
  } catch {
    return 1;
  }
}

// Tab order, and the sheet key gating each one. The Menu sheet is now written
// before any other sheet exists, so it links from this list rather than by
// inspecting wb.worksheets as it used to.
const MENU_SHEET_ORDER: { key: string; name: string }[] = [
  { key: "sales", name: "Sales" },
  { key: "oos", name: "OOS" },
  { key: "oosDetail", name: "OOS Detail" },
  { key: "dsc", name: "DSC" },
  { key: "dscDetail", name: "DSC Detail" },
  { key: "status", name: "Status" },
  { key: "statusDetail", name: "Status Detail" },
  { key: "margin", name: "Margin" },
  { key: "phantom", name: "Phantom" },
  { key: "oto", name: "OTO" },
  { key: "otoDetail", name: "OTO Detail" },
  { key: "nd", name: "ND" },
  { key: "ndDetail", name: "ND Detail" },
  { key: "ndFalse", name: "ND False" },
  { key: "data", name: "Data" },
];

/* Finish a sheet and flush it. This is the old whole-workbook post-pass scoped
   to a single sheet and run immediately before commit — it can't be done
   globally at the end any more because committed sheets are gone. Centres and
   wraps column headings, prepends the mapped icon, wraps section title-bars,
   titles and notes, then adds the 🏠 Menu button LAST so the header pass
   doesn't touch it (same ordering as before). */
function polishRow(r: ExcelJS.Row): void {
  r.eachCell((cell) => {
    const fill = cell.fill as { type?: string; fgColor?: { argb?: string } } | undefined;
    const fillArgb = fill?.type === "pattern" ? fill.fgColor?.argb : undefined;
    const font = cell.font as Partial<ExcelJS.Font> | undefined;
    const align = cell.alignment ?? {};

    if (fillArgb === HEADER_BG) {
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (typeof cell.value === "string") {
        const icon = HEADER_ICONS[cell.value.trim().toLowerCase()];
        if (icon && !cell.value.startsWith(icon)) cell.value = `${icon} ${cell.value}`;
      }
    } else if (fillArgb === SUBHEADER_BG) {
      cell.alignment = { ...align, wrapText: true };
    } else if (
      typeof cell.value === "string" &&
      (font?.italic === true ||
        (font?.color?.argb === HEADER_BG && (font?.size ?? 0) >= 12))
    ) {
      cell.alignment = { ...align, wrapText: true };
    }
  });
}

async function commitSheet(sheet: SheetTarget, home = true): Promise<void> {
  sheet.eachRow(polishRow);
  if (home) addHomeButton(sheet);
  await sheet.commit?.();
}

/* For a sheet whose rows are committed AS THEY ARE WRITTEN (the Data sheet),
   the post-pass and the 🏠 button must be applied to row 1 up front. Committing
   row 2 flushes row 1 along with it, and touching a committed row throws
   "Out of bounds: this row has been committed" — so there is no going back
   afterwards the way there is for a sheet held whole in memory. */
function polishStreamedHeader(sheet: SheetTarget): void {
  polishRow(sheet.getRow(1));
  addHomeButton(sheet);
  sheet.getRow(1).commit();
}

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

// Conditional-formatting rule priorities must be set; a per-workbook counter
// keeps them unique. Reset at the start of each build for determinism.
let nextCfPriority = 1;

// Apply Excel's native 3-colour scale (red ↔ amber ↔ green) across `ref`,
// relative to the values in that range (Excel recomputes min/mid/max live).
//   dir "highGood": low = red,   high = green  (e.g. ND %, growth %)
//   dir "highBad":  low = green, high = red    (e.g. OOS %)
// Blank/text cells in the range are ignored by the scale.
function addColorScale(
  sheet: ExcelJS.Worksheet,
  ref: string,
  dir: "highGood" | "highBad",
): void {
  const RED = "FFF8696B", AMBER = "FFFFEB84", GREEN = "FF63BE7B";
  const color =
    dir === "highGood"
      ? [{ argb: RED }, { argb: AMBER }, { argb: GREEN }]
      : [{ argb: GREEN }, { argb: AMBER }, { argb: RED }];
  sheet.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "colorScale",
        cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
        color,
        priority: nextCfPriority++,
      },
    ],
  });
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
  phantomAnalysis?: PhantomAnalysis,
  includeSheets: string[] = [],
  ndAnalysis?: NDAnalysis,
  otoAnalysis?: OTOAnalysis,
  dscSummary?: DscSummary,
  dscDetail: DscDetailRow[] = [],
): Promise<Buffer> {
  // Collect the streamed output into a Buffer — the caller needs bytes for
  // both the download response and the SharePoint save.
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const collected = new Promise<Buffer>((resolve, reject) => {
    out.on("end", () => resolve(Buffer.concat(chunks)));
    out.on("error", reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: out,
    useStyles: true,        // without this every fill / font / border is dropped
    useSharedStrings: true,
    /* The streaming writer's default zip level is tuned for speed, which made
       the output ~25% larger than the old in-memory writeBuffer() produced
       (VERMONT 18.6MB → 23.2MB). These are emailed and stored, so trade a
       little CPU for the smaller file — same tradeoff as the Vital Signs
       `compression: true` fix. */
    zip: { zlib: { level: 6 } },
  } as never);
  wb.creator = "iRam LIVE Replacement";
  wb.created = new Date();
  nextCfPriority = 1; // reset CF rule priorities per workbook

  // Which sheets to include (empty = all). Keys: sales, oos, oosDetail,
  // status, statusDetail, margin, phantom, data.
  const want = (key: string) => includeSheets.length === 0 || includeSheets.includes(key);

  /* Which sheets will actually exist. A sheet needs BOTH to be selected and to
     have data behind it — DSC/Status/Margin/Phantom/OTO/ND are all skipped when
     their analysis is absent. This map is the single source of truth for both
     the Menu's hyperlinks and the dispatch below: the Menu is now written
     before any other sheet exists, so if the two ever disagreed it would link
     to tabs that were never created and Excel would report a broken link. */
  const has: Record<string, boolean> = {
    sales: want("sales"),
    oos: want("oos"),
    oosDetail: want("oosDetail"),
    dsc: !!dscSummary && want("dsc"),
    dscDetail: dscDetail.length > 0 && want("dscDetail"),
    status: !!statusSummary && want("status"),
    statusDetail: statusDetail.length > 0 && want("statusDetail"),
    margin: !!marginAnalysis && want("margin"),
    phantom: !!phantomAnalysis && want("phantom"),
    oto: !!otoAnalysis && want("oto"),
    otoDetail: !!otoAnalysis && want("otoDetail"),
    nd: !!ndAnalysis && want("nd"),
    ndDetail: !!ndAnalysis && want("ndDetail"),
    ndFalse: !!ndAnalysis && ndAnalysis.hasRanging && ndAnalysis.falseDetail.length > 0 && want("ndFalse"),
    data: dataRows.length > 0 && want("data"),
  };

  // Sheets are written in creation order and can't be reordered or removed
  // afterwards, so the Menu/cover sheet is built and committed FIRST. It used
  // to be populated last (once the other sheets existed) purely so it could
  // link to them — but the tab names are known up front from want(), so
  // nothing actually required deferring it.
  const coverage = analyzeCoverage(dateColumns);
  const dataGapLines = coverageMessageLines(coverage);
  const coverageSpan = coverage.firstMonth && coverage.lastMonth
    ? `${formatMonth(coverage.firstMonth)} to ${formatMonth(coverage.lastMonth)}`
    : "";
  const menuSheet = wb.addWorksheet("Menu", sheetOpts());
  /* First sheet created, nothing committed yet — patch the writer now, or every
     sheet carrying both a hyperlink and conditional formatting (Sales, OOS, ND)
     opens EMPTY in Excel. See lib/exceljsStreamOrder.ts. */
  applyStreamWriterOrderFix(menuSheet);
  buildMenuSheet(wb, menuSheet, {
    clientName, channelLabel, periodLabel, dataGapLines, coverageSpan,
    sheetNames: MENU_SHEET_ORDER.filter((s) => has[s.key]).map((s) => s.name),
  });
  await commitSheet(menuSheet, false);   // the Menu needs no 🏠 button

  // Shared across the three inline sheet blocks below, so it is hoisted out of
  // them (each block re-initialises it to 1).
  let row = 1;

  // ── Sheet 1: Sales ───────────────────────────────────────────
  if (has.sales) {
    const salesSheet = wb.addWorksheet("Sales", sheetOpts());

    // Title row
    row = 1;
    const titleCell = salesSheet.getCell(row, 1);
    titleCell.value = `Sales Summary — ${clientName} — ${channelLabel} — ${periodLabel}`;
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

    await commitSheet(salesSheet);
  }

  /* Sheets are emitted in MENU_SHEET_ORDER, gated by the same `has` map the
     Menu's contents were built from. */
  if (has.oos) await buildOosSheet(wb, oosSummary, clientName, channelLabel, periodLabel);
  if (has.oosDetail) await buildOosDetailSheet(wb, oosDetail);
  if (has.dsc) await buildDscSheet(wb, dscSummary!, clientName, channelLabel, periodLabel);
  if (has.dscDetail) await buildDscDetailSheet(wb, dscDetail);
  if (has.status) await buildStatusSheet(wb, statusSummary!, clientName, channelLabel, periodLabel);
  if (has.statusDetail) await buildStatusDetailSheet(wb, statusDetail);
  if (has.margin) await buildMarginDetailSheet(wb, marginAnalysis!, clientName, channelLabel, periodLabel);
  if (has.phantom) await buildPhantomSheet(wb, phantomAnalysis!, clientName, channelLabel, periodLabel);
  if (has.oto) await buildOtoSummarySheet(wb, otoAnalysis!, clientName, channelLabel, periodLabel);
  if (has.otoDetail) await buildOtoDetailSheet(wb, otoAnalysis!, clientName, channelLabel, periodLabel);
  if (has.nd) await buildNdSheet(wb, ndAnalysis!, clientName, channelLabel, periodLabel);
  if (has.ndDetail) await buildNdDetailSheet(wb, ndAnalysis!);
  if (has.ndFalse) await buildNdFalseSheet(wb, ndAnalysis!);
  if (has.data) await buildDataSheet(wb, dataRows, dateColumns);

  await wb.commit();
  return collected;
}

// ── OOS summary sheet ──────────────────────────────────────────
async function buildOosSheet(
  wb: ExcelJS.Workbook,
  oosSummary: OOSSummary,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  const oosSheet = wb.addWorksheet("OOS", sheetOpts());

  let row = 1;

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

  /* Helper: write a section sub-header bar. The two tables below no longer have
     the same width — the SKU table gained a Vendor column — so the span is
     passed in rather than hard-coded at 6. */
  const writeOosTitle = (title: string, span: number) => {
    const t = oosSheet.getCell(row, 1);
    t.value = title;
    t.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    oosSheet.mergeCells(row, 1, row, span);
    for (let c = 1; c <= span; c++) oosSheet.getCell(row, c).border = thinBorder();
    row++;
  };

  /* Helper: write an OOS table (header + data rows). Returns nothing; advances
     `row`. `firstNumericIndex` is the first column that holds a number — it
     differs per table now that the SKU table carries a leading Vendor column. */
  const writeOosTable = (
    headers: string[],
    widths: number[],
    dataRows: (string | number)[][],
    pctColIndex: number,
    firstNumericIndex: number,
  ) => {
    headers.forEach((h, i) => {
      const cell = oosSheet.getCell(row, i + 1);
      cell.value = h;
      cell.font = headerFont();
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: i < firstNumericIndex ? "left" : "center" };
      oosSheet.getColumn(i + 1).width = Math.max(oosSheet.getColumn(i + 1).width ?? 0, widths[i]);
    });
    row++;
    // OOS % = OOS count / base count, as a live formula referencing this row.
    const totalL = String.fromCharCode(65 + (pctColIndex - 2));
    const oosL = String.fromCharCode(65 + (pctColIndex - 1));
    const pctL = String.fromCharCode(65 + pctColIndex);
    const dataStart = row;
    for (const vals of dataRows) {
      vals.forEach((val, i) => {
        const cell = oosSheet.getCell(row, i + 1);
        if (i === pctColIndex) {
          cell.value = { formula: `IF(${totalL}${row}=0,0,${oosL}${row}/${totalL}${row})`, result: typeof val === "number" ? val : 0 };
          cell.numFmt = "0.0%";
        } else {
          cell.value = val;
          if (i >= firstNumericIndex) cell.numFmt = "#,##0";
        }
        cell.font = bodyFont();
        cell.border = thinBorder();
      });
      row++;
    }
    // Native colour scale on the OOS % column (high OOS = red).
    if (row - 1 >= dataStart) addColorScale(oosSheet, `${pctL}${dataStart}:${pctL}${row - 1}`, "highBad");
  };

  // SKU OOS Summary (per product)
  if (oosSummary.productSummary.length > 0) {
    writeOosTitle("SKU OOS Summary", 8);
    writeOosTable(
      ["Vendor", "Article", "Description", "Category", "Product Status", "Total Stores", "OOS Stores", "OOS %"],
      [10, 14, 32, 18, 14, 12, 12, 10],
      oosSummary.productSummary.map((p) => [p.vendor, p.article, p.description, p.category, p.productStatus, p.totalStores, p.oosStores, p.oosPct / 100]),
      7,
      5,
    );
    row += 2; // gap before the next table
  }

  /* Store OOS Summary (per store) — no Vendor column: a store stocks every
     vendor's range, so the field has no single value at this grain. */
  if (oosSummary.storeSummary.length > 0) {
    writeOosTitle("Store OOS Summary", 6);
    writeOosTable(
      ["Site", "Site Name", "Sub-Channel", "Total SKUs", "OOS SKUs", "OOS %"],
      [12, 28, 16, 12, 12, 10],
      oosSummary.storeSummary.map((s) => [s.site, s.siteName, s.subChannel, s.totalSkus, s.oosSkus, s.oosPct / 100]),
      5,
      3,
    );
  }

  await commitSheet(oosSheet);
}

// ── OOS Detail sheet ───────────────────────────────────────────
async function buildOosDetailSheet(
  wb: ExcelJS.Workbook,
  oosDetail: OOSDetailRow[],
): Promise<void> {
  // Freeze row must be declared at creation — a streamed sheet's views cannot
  // be set afterwards (silently lost).
  const detailSheet = wb.addWorksheet("OOS Detail", sheetOpts({ state: "frozen", ySplit: 1 }));

  let row = 1;
  const detailColDefs = [
    { header: "Vendor", width: 10, key: "vendor" as const },
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

  await commitSheet(detailSheet);
}

// Add a "🏠 Menu" hyperlink so the reader can jump back to the Menu/cover
// sheet. Placed at the right end of the title/header row so it never collides
// with existing content or shifts any of the live formula row references.
function addHomeButton(sheet: ExcelJS.Worksheet): void {
  const col = columnExtent(sheet) + 2;
  const cell = sheet.getCell(1, col);
  cell.value = { text: "🏠 Menu", hyperlink: "#'Menu'!A1" };
  cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "0563C1" }, underline: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
  cell.border = thinBorder();
  cell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getColumn(col).width = 14;
}

// ── Flat data sheet — every enriched row, with Excel AutoFilter so the
//    user can slice by any column (sub-channel, category, …) inside Excel.
async function buildDataSheet(
  wb: ExcelJS.Workbook,
  rows: Record<string, unknown>[],
  dateColumns: string[],
): Promise<void> {
  const sheet = wb.addWorksheet("Data", sheetOpts({ state: "frozen", ySplit: 1 }));

  const sortedDates = [...dateColumns].sort((a, b) => {
    const pa = a.match(/^(\d{2})-(\d{4})$/);
    const pb = b.match(/^(\d{2})-(\d{4})$/);
    if (!pa || !pb) return a.localeCompare(b);
    return (Number(pa[2]) * 100 + Number(pa[1])) - (Number(pb[2]) * 100 + Number(pb[1]));
  });

  // Fixed dimension/measure columns: [header, width, accessor]
  const fixedCols: { header: string; width: number; get: (r: Record<string, unknown>) => string | number }[] = [
    { header: "Vendor", width: 10, get: (r) => String(r["_vendor"] ?? "") },
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
  const tailCols: { header: string; width: number; fmt: string; get: (r: Record<string, unknown>) => string | number }[] = [
    { header: "Incl SP", width: 10, fmt: RAND_FMT, get: (r) => toNum(r["Incl SP"]) },
    { header: "Prom SP", width: 10, fmt: RAND_FMT, get: (r) => toNum(r["Prom SP"]) },
    { header: "Nett Cost", width: 10, fmt: RAND_FMT, get: (r) => toNum(r["Nett Cost"]) },
    { header: "Act DSC", width: 9, fmt: "#,##0.00", get: (r) => toNum(r["Act DSC"]) },
  ];

  // Computed YTD / prior-year / growth / margin columns (per row).
  const ctx = buildDateContext(dateColumns);
  const extraDefs: { header: string; width: number; fmt: string; get: (x: ReturnType<typeof dataRowExtras>) => number | null }[] = [
    { header: "YTD Units", width: 12, fmt: "#,##0", get: (x) => x.ytdUnits },
    { header: "YTD Value", width: 14, fmt: RAND_FMT, get: (x) => x.ytdValue },
    { header: "PY YTD Units", width: 13, fmt: "#,##0", get: (x) => x.pyYtdUnits },
    { header: "PY YTD Value", width: 14, fmt: RAND_FMT, get: (x) => x.pyYtdValue },
    { header: "Units Growth %", width: 13, fmt: "0.0%", get: (x) => x.unitsGrowth },
    { header: "Value Growth %", width: 13, fmt: "0.0%", get: (x) => x.valueGrowth },
    { header: "STK Margin", width: 11, fmt: "0.0%", get: (x) => x.stkMargin },
    { header: "Prod. Margin", width: 12, fmt: "0.0%", get: (x) => x.prodMargin },
  ];

  // Header row
  const headers = [...fixedCols.map((c) => c.header), ...sortedDates, ...tailCols.map((c) => c.header), ...extraDefs.map((c) => c.header)];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    cell.alignment = { wrapText: true };
  });
  // Column widths
  [...fixedCols.map((c) => c.width), ...sortedDates.map(() => 9), ...tailCols.map((c) => c.width), ...extraDefs.map((c) => c.width)]
    .forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  /* Data rows. This is the single biggest sheet in the workbook — one row per
     ledger line (87k+ for the largest client) across ~45 columns — so each row
     is committed as it is written rather than accumulating. Committing frees
     the row's cell objects immediately, which is what keeps peak memory flat
     instead of proportional to row count. Nothing may read back a committed
     row, so all per-row work happens before the commit() below. */
  // Row 1 is finished and flushed BEFORE any data row is committed — see
  // polishStreamedHeader. autoFilter is set here too, for the same reason.
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
  polishStreamedHeader(sheet);

  let r = 2;
  for (const row of rows) {
    const xlRow = sheet.getRow(r);
    let c = 1;
    for (const col of fixedCols) {
      const cell = xlRow.getCell(c++);
      cell.value = col.get(row);
      cell.font = bodyFont();
    }
    for (const dc of sortedDates) {
      const cell = xlRow.getCell(c++);
      cell.value = toNum(row[dc]);
      cell.numFmt = "#,##0";
      cell.font = bodyFont();
    }
    for (const col of tailCols) {
      const cell = xlRow.getCell(c++);
      cell.value = col.get(row);
      cell.numFmt = col.fmt;
      cell.font = bodyFont();
    }
    const extras = dataRowExtras(row, ctx);
    for (const def of extraDefs) {
      const cell = xlRow.getCell(c++);
      const v = def.get(extras);
      cell.value = v === null || v === undefined ? "" : v;
      cell.numFmt = def.fmt;
      cell.font = bodyFont();
    }
    xlRow.commit();
    r++;
  }

  // Header and 🏠 button were handled up front; every data row is already
  // committed, so this just closes the sheet.
  await sheet.commit();
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

// ── DSC sheet — stock-cover distribution across brackets ────────
// Table 1 (Overall): one row per DSC bracket with Lines / # SKUs / # Sites /
// SOH / SOH %. Tables 2-4 (Category / SKU / Store) are matrices — one row per
// entity, SOH split across the bracket columns + a row total — so the reader
// sees how much stock sits in each cover band per dimension.

// Column letter for a 1-based column index (A, B, … Z, AA, …).
function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function dscBracketFill(bracket: string): string | null {
  if (bracket === "Out of Stock") return GROWTH_RED;   // no cover
  if (bracket === "ALERT") return MIXED_BG;            // overstock
  return null;
}

async function buildDscSheet(
  wb: ExcelJS.Workbook,
  dsc: DscSummary,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  const sheet = wb.addWorksheet("DSC", sheetOpts());
  const brackets = dsc.brackets;
  const span = Math.max(6, brackets.length + 3); // widest table width

  let cur = 1;
  const title = sheet.getCell(cur, 1);
  title.value = `DSC — Days of Stock Cover — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, span);
  cur += 1;

  const note = sheet.getCell(cur, 1);
  note.value =
    "Act DSC = the number of days the current stock-on-hand will last at the recent run-rate. SOH below is the stock " +
    "sitting in each cover band. \"Out of Stock\" carries no stock but still counts lines / SKUs / sites; \"ALERT\" = " +
    "overstock (cover at or above the client's alert threshold). Base = SKU×store lines with stock and/or sales.";
  note.font = { name: "Calibri", size: 10, italic: true, color: { argb: "828282" } };
  note.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(cur, 1, cur, span);
  sheet.getRow(cur).height = 44;
  cur += 2;

  const titleBar = (text: string, width: number) => {
    const c = sheet.getCell(cur, 1);
    c.value = text;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    sheet.mergeCells(cur, 1, cur, width);
    for (let cc = 1; cc <= width; cc++) sheet.getCell(cur, cc).border = thinBorder();
    cur++;
  };
  const headerRow = (headers: string[], leftCols: number) => {
    headers.forEach((h, i) => {
      const c = sheet.getCell(cur, i + 1);
      c.value = h; c.font = headerFont();
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      c.border = thinBorder(); c.alignment = { horizontal: i < leftCols ? "left" : "center", wrapText: true };
    });
    cur++;
  };

  // ── Table 1 — Overall by bracket ──
  titleBar("Overall — DSC Bracket Distribution", 6);
  headerRow(["DSC Bracket", "Lines", "# SKUs", "# Sites", "SOH (Units)", "SOH %"], 1);
  sheet.getColumn(1).width = 18;
  for (let i = 2; i <= 6; i++) sheet.getColumn(i).width = 13;
  const overallStart = cur;
  for (const b of dsc.overall) {
    const a = sheet.getCell(cur, 1); a.value = b.bracket; a.font = bodyFont(); a.border = thinBorder();
    const fill = dscBracketFill(b.bracket);
    if (fill) a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    const ln = sheet.getCell(cur, 2); ln.value = b.lines; ln.numFmt = "#,##0"; ln.font = bodyFont(); ln.border = thinBorder(); ln.alignment = { horizontal: "center" };
    const sk = sheet.getCell(cur, 3); sk.value = b.skus; sk.numFmt = "#,##0"; sk.font = bodyFont(); sk.border = thinBorder(); sk.alignment = { horizontal: "center" };
    const si = sheet.getCell(cur, 4); si.value = b.sites; si.numFmt = "#,##0"; si.font = bodyFont(); si.border = thinBorder(); si.alignment = { horizontal: "center" };
    const so = sheet.getCell(cur, 5); so.value = b.soh; so.numFmt = "#,##0"; so.font = bodyFont(); so.border = thinBorder(); so.alignment = { horizontal: "right" };
    const pc = sheet.getCell(cur, 6);
    pc.value = { formula: `IF(SUM($E$${overallStart}:$E$${overallStart + dsc.overall.length - 1})=0,0,E${cur}/SUM($E$${overallStart}:$E$${overallStart + dsc.overall.length - 1}))`, result: b.sohPct / 100 };
    pc.numFmt = "0.0%"; pc.font = bodyFont(); pc.border = thinBorder(); pc.alignment = { horizontal: "center" };
    cur++;
  }
  const overallEnd = cur - 1;
  // Total row — Lines + SOH are additive (SUM); SKUs/Sites are distinct unions.
  {
    const a = sheet.getCell(cur, 1); a.value = "Total"; a.font = bodyFont(true); a.border = thinBorder();
    a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    const ln = sheet.getCell(cur, 2); ln.value = { formula: `SUM(B${overallStart}:B${overallEnd})`, result: dsc.totalLines }; ln.numFmt = "#,##0"; ln.font = bodyFont(true); ln.border = thinBorder(); ln.alignment = { horizontal: "center" }; ln.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    const sk = sheet.getCell(cur, 3); sk.value = dsc.totalSkus; sk.numFmt = "#,##0"; sk.font = bodyFont(true); sk.border = thinBorder(); sk.alignment = { horizontal: "center" }; sk.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    const si = sheet.getCell(cur, 4); si.value = dsc.totalSites; si.numFmt = "#,##0"; si.font = bodyFont(true); si.border = thinBorder(); si.alignment = { horizontal: "center" }; si.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    const so = sheet.getCell(cur, 5); so.value = { formula: `SUM(E${overallStart}:E${overallEnd})`, result: dsc.totalSoh }; so.numFmt = "#,##0"; so.font = bodyFont(true); so.border = thinBorder(); so.alignment = { horizontal: "right" }; so.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    const pc = sheet.getCell(cur, 6); pc.value = 1; pc.numFmt = "0.0%"; pc.font = bodyFont(true); pc.border = thinBorder(); pc.alignment = { horizontal: "center" }; pc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    cur++;
  }
  cur += 2;

  // ── Tables 2-4 — entity × bracket SOH matrices ──
  const writeMatrix = (
    dimLabel: string,
    countLabel: "# SKUs" | "# Sites",
    countKey: "skus" | "sites",
    rows: DscSummary["byCategory"],
    globalCount: number,
  ) => {
    const nb = brackets.length;
    const totalWidth = 2 + nb + 1; // dim + count + brackets + total
    titleBar(`${dimLabel} — SOH by DSC Bracket`, totalWidth);

    const headers = [dimLabel, countLabel, ...brackets, "Total SOH"];
    headerRow(headers, 1);
    sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width ?? 0, 28);
    sheet.getColumn(2).width = Math.max(sheet.getColumn(2).width ?? 0, 11);
    for (let i = 0; i < nb; i++) sheet.getColumn(3 + i).width = Math.max(sheet.getColumn(3 + i).width ?? 0, 12);
    sheet.getColumn(3 + nb).width = Math.max(sheet.getColumn(3 + nb).width ?? 0, 14);

    const firstBracketCol = 3;            // column index of the first bracket
    const totalCol = 2 + nb + 1;          // Total SOH column index
    const dataStart = cur;
    for (const row of rows) {
      const a = sheet.getCell(cur, 1); a.value = row.name; a.font = bodyFont(); a.border = thinBorder();
      const cnt = sheet.getCell(cur, 2); cnt.value = row[countKey]; cnt.numFmt = "#,##0"; cnt.font = bodyFont(); cnt.border = thinBorder(); cnt.alignment = { horizontal: "center" };
      row.bracketSoh.forEach((v, i) => {
        const c = sheet.getCell(cur, firstBracketCol + i);
        c.value = v; c.numFmt = "#,##0"; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "right" };
      });
      const firstL = colLetter(firstBracketCol);
      const lastL = colLetter(firstBracketCol + nb - 1);
      const tot = sheet.getCell(cur, totalCol);
      tot.value = { formula: `SUM(${firstL}${cur}:${lastL}${cur})`, result: row.totalSoh };
      tot.numFmt = "#,##0"; tot.font = bodyFont(true); tot.border = thinBorder(); tot.alignment = { horizontal: "right" };
      cur++;
    }
    const dataEnd = cur - 1;

    // Total row
    if (rows.length > 0) {
      const a = sheet.getCell(cur, 1); a.value = "Total"; a.font = bodyFont(true); a.border = thinBorder();
      a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      const cnt = sheet.getCell(cur, 2); cnt.value = globalCount; cnt.numFmt = "#,##0"; cnt.font = bodyFont(true); cnt.border = thinBorder(); cnt.alignment = { horizontal: "center" }; cnt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      for (let i = 0; i < nb; i++) {
        const L = colLetter(firstBracketCol + i);
        const c = sheet.getCell(cur, firstBracketCol + i);
        c.value = { formula: `SUM(${L}${dataStart}:${L}${dataEnd})`, result: 0 };
        c.numFmt = "#,##0"; c.font = bodyFont(true); c.border = thinBorder(); c.alignment = { horizontal: "right" };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      }
      const TL = colLetter(totalCol);
      const t = sheet.getCell(cur, totalCol);
      t.value = { formula: `SUM(${TL}${dataStart}:${TL}${dataEnd})`, result: dsc.totalSoh };
      t.numFmt = "#,##0"; t.font = bodyFont(true); t.border = thinBorder(); t.alignment = { horizontal: "right" };
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cur++;
    }
    cur += 2;
  };

  writeMatrix("Category", "# SKUs", "skus", dsc.byCategory, dsc.totalSkus);
  writeMatrix("SKU", "# Sites", "sites", dsc.bySku, dsc.totalSites);
  writeMatrix("Store", "# SKUs", "skus", dsc.byStore, dsc.totalSkus);

  await commitSheet(sheet);
}

// ── DSC Detail — every in-base SKU×store line, sorted by Act DSC desc ──
async function buildDscDetailSheet(wb: ExcelJS.Workbook, rows: DscDetailRow[]): Promise<void> {
  const sheet = wb.addWorksheet("DSC Detail", sheetOpts({ state: "frozen", ySplit: 1 }));
  const cols: { header: string; width: number; key: keyof DscDetailRow; num?: boolean }[] = [
    { header: "Vendor", width: 10, key: "vendor" },
    { header: "Sub-Channel", width: 14, key: "subChannel" },
    { header: "Province", width: 14, key: "province" },
    { header: "Category", width: 16, key: "category" },
    { header: "Brand", width: 14, key: "brand" },
    { header: "Article", width: 12, key: "article" },
    { header: "Description", width: 30, key: "description" },
    { header: "Site", width: 10, key: "site" },
    { header: "Site Name", width: 22, key: "siteName" },
    { header: "SOH", width: 8, key: "soh", num: true },
    { header: "SOO", width: 8, key: "soo", num: true },
    { header: "SIT", width: 8, key: "sit", num: true },
    { header: "Act DSC", width: 9, key: "actDsc", num: true },
    { header: "DSC Bracket", width: 14, key: "bracket" },
    { header: "Date Last Sold", width: 14, key: "dateLastSold" },
  ];

  cols.forEach((c, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = c.header; cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder();
    sheet.getColumn(i + 1).width = c.width;
  });

  const bracketColIdx = cols.findIndex((c) => c.key === "bracket") + 1;
  let r = 2;
  for (const row of rows) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = row[c.key] as string | number;
      cell.font = bodyFont();
      cell.border = thinBorder();
      if (c.num) cell.numFmt = c.key === "actDsc" ? "#,##0.00" : "#,##0";
    });
    const bCell = sheet.getCell(r, bracketColIdx);
    const fill = dscBracketFill(row.bracket);
    if (fill) bCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    r++;
  }

  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
  }
  await commitSheet(sheet);
}

// ── Status sheet — PR ST breakdown + PR ST × PMF Product Status ──
async function buildStatusSheet(
  wb: ExcelJS.Workbook,
  s: StatusSummary,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  const sheet = wb.addWorksheet("Status", sheetOpts());
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

  await commitSheet(sheet);
}

// ── Status Detail — negative SKU×store combinations only ────────
async function buildStatusDetailSheet(wb: ExcelJS.Workbook, rows: StatusDetailRow[]): Promise<void> {
  const sheet = wb.addWorksheet("Status Detail", sheetOpts({ state: "frozen", ySplit: 1 }));
  const cols: { header: string; width: number; key: keyof StatusDetailRow }[] = [
    { header: "Vendor", width: 10, key: "vendor" },
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
  await commitSheet(sheet);
}

// ── Margin Detail — opportunity/risk summary block on top of the grid ──
async function buildMarginDetailSheet(
  wb: ExcelJS.Workbook,
  m: MarginAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  /* The grid's header row has to be known BEFORE the sheet is created, because
     a streamed sheet's frozen view can only be set at addWorksheet time. The
     summary block above the grid is fixed height: title (1), gap, base stat
     (3), gap, summary header (5), one row per summary status, gap. */
  const MARGIN_SUMMARY_STATUSES = 2;              // OPPORTUNITY + RISK
  const headerRow = 5 + 1 + MARGIN_SUMMARY_STATUSES + 1;   // → 9
  const sheet = wb.addWorksheet("Margin", sheetOpts({ state: "frozen", ySplit: headerRow }));
  /* Vendor leads, as on every other sheet. NOTE: this grid's live formulas
     reference columns by LETTER, so the letters below are offset by one from
     the pre-Vendor layout — SOH is H (not G), MAC I, Nett J, Incl SP K,
     Prod. Margin L, Margin Status O, Margin Support P. */
  const headers = [
    "Vendor", "Site", "Site Name", "Product Code", "Article", "Product Status", "PR ST",
    "SOH", "MAC", "Nett Cost", "Incl SP", "Prod. Margin", "STK Margin",
    "MAC vs Nett Cost", "Margin Status", "Margin Support (R)", "Free Stock Units", "Suggested SP (Incl VAT)",
  ];
  const widths = [10, 10, 22, 14, 12, 14, 10, 8, 10, 10, 10, 12, 11, 15, 14, 16, 14, 18];

  let cur = 1;
  // Title
  const title = sheet.getCell(cur, 1);
  title.value = `Margin Opportunity & Risk — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, headers.length);
  cur += 2;

  // Base stat
  const bl = sheet.getCell(cur, 1);
  bl.value = "Base (SKU×store, SOH>0, valid cost)"; bl.font = bodyFont(true); bl.border = thinBorder();
  const bv = sheet.getCell(cur, 2);
  bv.value = m.summary.base; bv.numFmt = "#,##0"; bv.font = bodyFont(); bv.border = thinBorder();
  cur += 2;

  // Summary table
  ["Margin Status", "Count", "Total Margin Support (R)", "Total Free Stock Units"].forEach((h, i) => {
    const c = sheet.getCell(cur, i + 1);
    c.value = h; c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder(); c.alignment = { horizontal: i === 0 ? "left" : "center", wrapText: true };
  });
  cur++;
  const summaryRows = [
    { label: "OPPORTUNITY", count: m.summary.opportunityCount, support: null as number | null, free: null as number | null, fill: GROWTH_GREEN },
    { label: "RISK", count: m.summary.riskCount, support: m.summary.totalMarginSupport, free: m.summary.totalFreeStockUnits, fill: GROWTH_RED },
  ];
  for (const sr of summaryRows) {
    const a = sheet.getCell(cur, 1);
    a.value = sr.label; a.font = bodyFont(true); a.border = thinBorder();
    a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sr.fill } };
    const c = sheet.getCell(cur, 2);
    c.value = sr.count; c.numFmt = "#,##0"; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "center" };
    const s = sheet.getCell(cur, 3);
    s.value = sr.support === null ? "" : sr.support; if (sr.support !== null) s.numFmt = RAND_FMT;
    s.font = bodyFont(); s.border = thinBorder(); s.alignment = { horizontal: "right" };
    const f = sheet.getCell(cur, 4);
    f.value = sr.free === null ? "" : sr.free; if (sr.free !== null) f.numFmt = "#,##0.00";
    f.font = bodyFont(); f.border = thinBorder(); f.alignment = { horizontal: "right" };
    cur++;
  }
  cur += 1; // gap before the grid

  // Detail grid header. `cur` must have landed on the row the frozen view was
  // created with — if the summary block above ever changes height, headerRow
  // has to change with it.
  if (cur !== headerRow) {
    throw new Error(`Margin sheet layout drifted: expected header row ${headerRow}, got ${cur}`);
  }
  headers.forEach((h, i) => {
    const c = sheet.getCell(headerRow, i + 1);
    c.value = h; c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder(); c.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = widths[i];
  });

  let r = headerRow + 1;
  for (const dr of m.rows) {
    const text = (col: number, val: string) => {
      const c = sheet.getCell(r, col); c.value = val; c.font = bodyFont(); c.border = thinBorder(); return c;
    };
    const num = (col: number, val: number, fmt: string) => {
      const c = sheet.getCell(r, col); c.value = val; c.numFmt = fmt; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "right" }; return c;
    };
    const formula = (col: number, f: string, result: number | string, fmt: string) => {
      const c = sheet.getCell(r, col); c.value = { formula: f, result }; c.numFmt = fmt; c.font = bodyFont(); c.border = thinBorder(); c.alignment = { horizontal: "right" }; return c;
    };

    text(1, dr.vendor);
    text(2, dr.site);
    text(3, dr.siteName);
    text(4, dr.productCode);
    text(5, dr.article);
    text(6, dr.productStatus);
    text(7, dr.prst);
    num(8, dr.soh, "#,##0");
    num(9, dr.mac, RAND_FMT);
    num(10, dr.nettCost, RAND_FMT);
    num(11, dr.inclSP, RAND_FMT);
    // Prod. Margin — DISPO value if supplied, else calculated from price + cost
    if (dr.prodMarginFromDispo) {
      num(12, dr.prodMargin, "0.0%").alignment = { horizontal: "center" };
    } else {
      formula(12, `IF(K${r}=0,0,((K${r}/1.15)-J${r})/(K${r}/1.15))`, dr.prodMargin, "0.0%").alignment = { horizontal: "center" };
    }
    num(13, dr.stkMargin, "0.0%").alignment = { horizontal: "center" };
    // MAC vs Nett Cost = Nett − MAC
    formula(14, `J${r}-I${r}`, dr.macVsNett, RAND_FMT);
    // Margin Status (coloured)
    const st = text(15, dr.marginStatus);
    st.font = bodyFont(true); st.alignment = { horizontal: "center" };
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dr.marginStatus === "RISK" ? GROWTH_RED : GROWTH_GREEN } };
    // Margin Support (R) = RISK: SOH × (MAC − Nett)
    formula(16, `IF(O${r}="RISK",H${r}*(I${r}-J${r}),"")`, dr.marginSupport === null ? "" : dr.marginSupport, RAND_FMT);
    // Free Stock Units = RISK: Margin Support / Nett
    formula(17, `IF(AND(O${r}="RISK",J${r}<>0),P${r}/J${r},"")`, dr.freeStockUnits === null ? "" : dr.freeStockUnits, "#,##0.00");
    // Suggested SP (Incl VAT) = OPPORTUNITY: MAC / (1 − Prod. Margin) × 1.15
    formula(18, `IF(AND(O${r}="OPPORTUNITY",(1-L${r})<>0),I${r}/(1-L${r})*1.15,"")`, dr.suggestedSP === null ? "" : dr.suggestedSP, RAND_FMT);
    r++;
  }

  if (m.rows.length > 0) {
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + m.rows.length, column: headers.length } };
  }
  await commitSheet(sheet);
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

  // Native colour scales on the growth % columns (relative to this table;
  // higher growth = greener). Covers the data rows plus the total row.
  if (dataRows.length > 0) {
    const growthCols = SUMMARY_COLS
      .map((col, i) => ({ col, i }))
      .filter(({ col }) => typeof col.key === "string" && col.key.startsWith("growth"))
      .map(({ i }) => String.fromCharCode(65 + i));
    for (const L of growthCols) {
      addColorScale(sheet, `${L}${firstDataRow}:${L}${totalRowNum}`, "highGood");
    }
  }

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
  const valueFmt = isValue ? RAND_FMT : "#,##0";
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
      // Colour handled by a native colour scale applied per table in
      // writeSummaryTable (red ↔ amber ↔ green).
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

// ── Phantom sheet — phantom-stock summary on top of the detail grid ──
async function buildPhantomSheet(
  wb: ExcelJS.Workbook,
  p: PhantomAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  /* Header row must be known before the sheet exists (frozen view is fixed at
     creation). Layout above the grid: title (1), filter note (2), gap, three
     overall stats (4-6), gap, by-status header, one row per status, gap. */
  const headerRow = 10 + p.byStatus.length;
  const sheet = wb.addWorksheet("Phantom", sheetOpts({ state: "frozen", ySplit: headerRow }));
  const detailHeaders =["Vendor", "Site", "Site Name", "Product Code", "Article", "PR ST", "Product Status", "SOH", "Date Last Sold", "Date Last Received"];
  const detailWidths = [10, 14, 22, 14, 12, 10, 14, 8, 15, 17];

  let cur = 1;
  // Title
  const title = sheet.getCell(cur, 1);
  title.value = `Phantom Stock — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, detailHeaders.length);
  cur++;

  // Filter context
  const soldTxt = p.lastSoldMonths != null ? `> ${p.lastSoldMonths} month(s)` : "Any";
  const recTxt = p.lastReceivedMonths != null ? `> ${p.lastReceivedMonths} month(s)` : "Any";
  const sub = sheet.getCell(cur, 1);
  sub.value = `Phantom = SOH > 0, last sold ${soldTxt} ago AND last received ${recTxt} ago`;
  sub.font = { name: "Calibri", size: 10, italic: true, color: { argb: "828282" } };
  sheet.mergeCells(cur, 1, cur, detailHeaders.length);
  cur += 2;

  // Overall stats
  const stat = (label: string, value: number | null, isPct: boolean, formula?: { formula: string; result: number }) => {
    const a = sheet.getCell(cur, 1); a.value = label; a.font = bodyFont(true); a.border = thinBorder();
    const b = sheet.getCell(cur, 2);
    b.value = formula ? formula : (value as number);
    b.numFmt = isPct ? "0.0%" : "#,##0"; b.font = bodyFont(); b.border = thinBorder(); b.alignment = { horizontal: "right" };
    const rowNum = cur; cur++; return rowNum;
  };
  const totalRow = stat("Total Lines", p.totalLines, false);
  const phantomRow = stat("Phantom Lines", p.phantomLines, false);
  stat("Phantom %", null, true, { formula: `IF(B${totalRow}=0,0,B${phantomRow}/B${totalRow})`, result: p.totalLines > 0 ? p.phantomLines / p.totalLines : 0 });
  cur += 1;

  // By-status table
  ["PMF Status", "Phantom Lines", "Total Lines", "Phantom %"].forEach((h, i) => {
    const c = sheet.getCell(cur, i + 1);
    c.value = h; c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder(); c.alignment = { horizontal: i === 0 ? "left" : "center" };
  });
  cur++;
  for (const s of p.byStatus) {
    const a = sheet.getCell(cur, 1); a.value = s.pmfStatus; a.font = bodyFont(); a.border = thinBorder();
    const ph = sheet.getCell(cur, 2); ph.value = s.phantomLines; ph.numFmt = "#,##0"; ph.font = bodyFont(); ph.border = thinBorder(); ph.alignment = { horizontal: "center" };
    const tot = sheet.getCell(cur, 3); tot.value = s.totalLines; tot.numFmt = "#,##0"; tot.font = bodyFont(); tot.border = thinBorder(); tot.alignment = { horizontal: "center" };
    const pct = sheet.getCell(cur, 4);
    pct.value = { formula: `IF(C${cur}=0,0,B${cur}/C${cur})`, result: s.phantomPct / 100 };
    pct.numFmt = "0.0%"; pct.font = bodyFont(); pct.border = thinBorder(); pct.alignment = { horizontal: "center" };
    cur++;
  }
  cur += 1;

  // Detail grid. Must match the row the frozen view was created with.
  if (cur !== headerRow) {
    throw new Error(`Phantom sheet layout drifted: expected header row ${headerRow}, got ${cur}`);
  }
  detailHeaders.forEach((h, i) => {
    const c = sheet.getCell(headerRow, i + 1);
    c.value = h; c.font = headerFont();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    c.border = thinBorder(); c.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = detailWidths[i];
  });

  let r = headerRow + 1;
  for (const d of p.detail) {
    const text = (col: number, val: string) => {
      const c = sheet.getCell(r, col); c.value = val; c.font = bodyFont(); c.border = thinBorder(); return c;
    };
    text(1, d.vendor);
    text(2, d.site);
    text(3, d.siteName);
    text(4, d.productCode);
    text(5, d.article);
    text(6, d.prst);
    text(7, d.productStatus);
    const soh = sheet.getCell(r, 8); soh.value = d.soh; soh.numFmt = "#,##0"; soh.font = bodyFont(); soh.border = thinBorder(); soh.alignment = { horizontal: "right" };
    const ls = sheet.getCell(r, 9);
    if (d.lastSold) { ls.value = d.lastSold; ls.numFmt = "dd/mm/yyyy"; } else { ls.value = d.lastSoldRaw; }
    ls.font = bodyFont(); ls.border = thinBorder(); ls.alignment = { horizontal: "center" };
    const lr = sheet.getCell(r, 10);
    if (d.lastReceived) { lr.value = d.lastReceived; lr.numFmt = "dd/mm/yyyy"; } else { lr.value = d.lastReceivedRaw; }
    lr.font = bodyFont(); lr.border = thinBorder(); lr.alignment = { horizontal: "center" };
    r++;
  }

  if (p.detail.length > 0) {
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + p.detail.length, column: detailHeaders.length } };
  }
  await commitSheet(sheet);
}

// ── Numerical Distribution summary (4 cascading rollup tables) ──
async function buildNdSheet(
  wb: ExcelJS.Workbook,
  nd: NDAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  const sheet = wb.addWorksheet("ND", sheetOpts());
  let cur = 1;

  const title = sheet.getCell(cur, 1);
  title.value = `Numerical Distribution — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, 4);
  cur += 1;

  const note = sheet.getCell(cur, 1);
  note.value = nd.hasRanging
    ? "You have a ranging file loaded, so numerical distribution takes your ranging into account."
    : "You do not have a ranging file loaded, so numerical distribution is calculated assuming all ACTIVE SKU's go into all sites.";
  note.font = { name: "Calibri", size: 10, italic: true, color: { argb: nd.hasRanging ? "1F4E79" : "C00000" } };
  sheet.mergeCells(cur, 1, cur, 4);
  cur += 1;

  const win = sheet.getCell(cur, 1);
  win.value = `Rolling window: ${nd.windowLabel}  •  ND = 1 when a ranged SKU/site has sales (window) or any stock`;
  win.font = { name: "Calibri", size: 10, italic: true, color: { argb: "828282" } };
  sheet.mergeCells(cur, 1, cur, 4);
  cur += 2;

  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 10;

  const writeTable = (dimLabel: string, rows: typeof nd.bySubChannel) => {
    // Sub-header bar
    const sub = sheet.getCell(cur, 1);
    sub.value = `${dimLabel} — Numerical Distribution`;
    sub.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    sheet.mergeCells(cur, 1, cur, 4);
    for (let c = 1; c <= 4; c++) sheet.getCell(cur, c).border = thinBorder();
    cur++;
    // Header
    [dimLabel, "Expected", "Present", "ND %"].forEach((h, i) => {
      const c = sheet.getCell(cur, i + 1);
      c.value = h; c.font = headerFont();
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      c.border = thinBorder(); c.alignment = { horizontal: i === 0 ? "left" : "center" };
    });
    cur++;
    const dataStart = cur;
    for (const row of rows) {
      const a = sheet.getCell(cur, 1); a.value = row.name; a.font = bodyFont(); a.border = thinBorder();
      const e = sheet.getCell(cur, 2); e.value = row.expected; e.numFmt = "#,##0"; e.font = bodyFont(); e.border = thinBorder(); e.alignment = { horizontal: "center" };
      const pr = sheet.getCell(cur, 3); pr.value = row.present; pr.numFmt = "#,##0"; pr.font = bodyFont(); pr.border = thinBorder(); pr.alignment = { horizontal: "center" };
      const pct = sheet.getCell(cur, 4);
      pct.value = { formula: `IF(B${cur}=0,0,C${cur}/B${cur})`, result: row.ndPct / 100 };
      pct.numFmt = "0.0%"; pct.font = bodyFont(); pct.border = thinBorder(); pct.alignment = { horizontal: "center" };
      cur++;
    }
    // Native colour scale on the ND % column (high ND = green).
    if (cur - 1 >= dataStart) addColorScale(sheet, `D${dataStart}:D${cur - 1}`, "highGood");
    cur += 2;
  };

  writeTable("Sub-Channel", nd.bySubChannel);
  writeTable("Province", nd.byProvince);
  writeTable("SKU", nd.bySku);
  writeTable("Site", nd.bySite);

  await commitSheet(sheet);
}

// ── ND Detail — one row per ranged (or active) SKU/site, ND 1/0 ──
async function buildNdDetailSheet(wb: ExcelJS.Workbook, nd: NDAnalysis): Promise<void> {
  const sheet = wb.addWorksheet("ND Detail", sheetOpts({ state: "frozen", ySplit: 1 }));
  const cols: { header: string; width: number; key: keyof NDDetailRowLite }[] = [
    { header: "Vendor", width: 10, key: "vendor" },
    { header: "Sub-Channel", width: 14, key: "subChannel" },
    { header: "Province", width: 14, key: "province" },
    { header: "Site", width: 10, key: "site" },
    { header: "Site Name", width: 22, key: "siteName" },
    { header: "Product Code", width: 14, key: "productCode" },
    { header: "Article", width: 12, key: "article" },
    { header: "Description", width: 30, key: "description" },
    { header: "PR ST", width: 9, key: "prst" },
    { header: "PMF Status", width: 13, key: "pmfStatus" },
    { header: "Ranging", width: 10, key: "ranging" },
  ];
  cols.forEach((c, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = c.header; cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder(); cell.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = c.width;
  });
  // ND column header
  const ndCol = cols.length + 1;
  const ndHdr = sheet.getCell(1, ndCol);
  ndHdr.value = "ND"; ndHdr.font = headerFont();
  ndHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  ndHdr.border = thinBorder(); ndHdr.alignment = { horizontal: "center" };
  sheet.getColumn(ndCol).width = 7;

  let r = 2;
  for (const row of nd.detail) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = row[c.key];
      cell.font = bodyFont(); cell.border = thinBorder();
    });
    const ndCell = sheet.getCell(r, ndCol);
    ndCell.value = row.nd; ndCell.numFmt = "0"; ndCell.font = bodyFont(); ndCell.border = thinBorder();
    ndCell.alignment = { horizontal: "center" };
    ndCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.nd === 1 ? GROWTH_GREEN : GROWTH_RED } };
    r++;
  }
  if (nd.detail.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: nd.detail.length + 1, column: ndCol } };
  }
  await commitSheet(sheet);
}

// ── ND False — stock (SOH>0) in NON-ranged SKU/site combos ──────
async function buildNdFalseSheet(wb: ExcelJS.Workbook, nd: NDAnalysis): Promise<void> {
  const sheet = wb.addWorksheet("ND False", sheetOpts({ state: "frozen", ySplit: 1 }));
  const cols: { header: string; width: number; key: keyof NDFalseRowLite }[] = [
    { header: "Vendor", width: 10, key: "vendor" },
    { header: "Sub-Channel", width: 14, key: "subChannel" },
    { header: "Province", width: 14, key: "province" },
    { header: "Site", width: 10, key: "site" },
    { header: "Site Name", width: 22, key: "siteName" },
    { header: "Product Code", width: 14, key: "productCode" },
    { header: "Article", width: 12, key: "article" },
    { header: "Description", width: 30, key: "description" },
    { header: "PR ST", width: 9, key: "prst" },
    { header: "PMF Status", width: 13, key: "pmfStatus" },
  ];
  cols.forEach((c, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = c.header; cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder(); cell.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = c.width;
  });
  const sohCol = cols.length + 1;
  const sohHdr = sheet.getCell(1, sohCol);
  sohHdr.value = "SOH"; sohHdr.font = headerFont();
  sohHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  sohHdr.border = thinBorder(); sohHdr.alignment = { horizontal: "center" };
  sheet.getColumn(sohCol).width = 9;

  let r = 2;
  for (const row of nd.falseDetail) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = row[c.key];
      cell.font = bodyFont(); cell.border = thinBorder();
    });
    const sohCell = sheet.getCell(r, sohCol);
    sohCell.value = row.soh; sohCell.numFmt = "#,##0"; sohCell.font = bodyFont(); sohCell.border = thinBorder();
    sohCell.alignment = { horizontal: "right" };
    r++;
  }
  if (nd.falseDetail.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: nd.falseDetail.length + 1, column: sohCol } };
  }
  await commitSheet(sheet);
}

// Helper alias types for keyof access (string-valued columns only)
type NDDetailRowLite = { vendor: string; subChannel: string; province: string; site: string; siteName: string; productCode: string; article: string; description: string; prst: string; pmfStatus: string; ranging: string };
type NDFalseRowLite = { vendor: string; subChannel: string; province: string; site: string; siteName: string; productCode: string; article: string; description: string; prst: string; pmfStatus: string };

// ── Open to Order (OTO) sheets ──────────────────────────────────
const OTO_NOTE =
  "Open to Order (OTO) = suggested replenishment for SKU/site lines that are out of stock and orderable. " +
  "A line qualifies only when SOH = 0, nothing is on order or in transit (SOO = SIT = 0), the DISPO status classifies as POSITIVE, " +
  "and the PMF product status is ACTIVE. OTO Units = category multiplier × R. Profile; OTO Value = OTO Units × Nett Cost. " +
  "Because every line below meets these same conditions, the SOH / SOO / SIT / Status / Product Status columns are omitted — they would be identical on every row.";

// OTO Summary — cascading rollups by Sub-Channel, Category, SKU, then Site.
async function buildOtoSummarySheet(
  wb: ExcelJS.Workbook,
  oto: OTOAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  const sheet = wb.addWorksheet("OTO", sheetOpts());
  let cur = 1;

  const title = sheet.getCell(cur, 1);
  title.value = `Open to Order — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, 5);
  cur += 1;

  const note = sheet.getCell(cur, 1);
  note.value = OTO_NOTE;
  note.font = { name: "Calibri", size: 10, italic: true, color: { argb: "828282" } };
  note.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(cur, 1, cur, 5);
  sheet.getRow(cur).height = 80;
  cur += 2;

  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 13;

  // Overall stats
  const stat = (label: string, value: number, fmt: string) => {
    const a = sheet.getCell(cur, 1); a.value = label; a.font = bodyFont(true); a.border = thinBorder();
    const b = sheet.getCell(cur, 2); b.value = value; b.numFmt = fmt; b.font = bodyFont(); b.border = thinBorder(); b.alignment = { horizontal: "right" };
    cur++;
  };
  stat("Total Lines", oto.totalLines, "#,##0");
  stat("Total OTO Units", oto.totalUnits, "#,##0");
  stat("Total OTO Value", oto.totalValue, RAND_FMT);
  cur += 1;

  const writeTable = (dimLabel: string, rows: OTOAnalysis["bySubChannel"]) => {
    const sub = sheet.getCell(cur, 1);
    sub.value = `${dimLabel} — Open to Order`;
    sub.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBHEADER_BG } };
    sheet.mergeCells(cur, 1, cur, 5);
    for (let c = 1; c <= 5; c++) sheet.getCell(cur, c).border = thinBorder();
    cur++;

    [dimLabel, "Lines", "OTO Units", "OTO Value", "% Value"].forEach((h, i) => {
      const c = sheet.getCell(cur, i + 1);
      c.value = h; c.font = headerFont();
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      c.border = thinBorder(); c.alignment = { horizontal: i === 0 ? "left" : "center" };
    });
    cur++;

    const dataStart = cur;
    const dataEnd = cur + rows.length - 1;
    const valRange = `$D$${dataStart}:$D$${dataEnd}`;
    for (const row of rows) {
      const a = sheet.getCell(cur, 1); a.value = row.name; a.font = bodyFont(); a.border = thinBorder();
      const l = sheet.getCell(cur, 2); l.value = row.lines; l.numFmt = "#,##0"; l.font = bodyFont(); l.border = thinBorder(); l.alignment = { horizontal: "center" };
      const u = sheet.getCell(cur, 3); u.value = row.units; u.numFmt = "#,##0"; u.font = bodyFont(); u.border = thinBorder(); u.alignment = { horizontal: "right" };
      const v = sheet.getCell(cur, 4); v.value = row.value; v.numFmt = RAND_FMT; v.font = bodyFont(); v.border = thinBorder(); v.alignment = { horizontal: "right" };
      const p = sheet.getCell(cur, 5);
      p.value = { formula: `IF(SUM(${valRange})=0,0,D${cur}/SUM(${valRange}))`, result: row.contributionPct / 100 };
      p.numFmt = "0.0%"; p.font = bodyFont(); p.border = thinBorder(); p.alignment = { horizontal: "center" };
      cur++;
    }

    // Total row (live SUMs)
    if (rows.length > 0) {
      const tot = (col: number, letter: string, fmt: string, align: "center" | "right") => {
        const c = sheet.getCell(cur, col);
        c.value = { formula: `SUM(${letter}${dataStart}:${letter}${dataEnd})`, result: 0 };
        c.numFmt = fmt; c.font = bodyFont(true); c.border = thinBorder(); c.alignment = { horizontal: align };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      };
      const a = sheet.getCell(cur, 1); a.value = "Total"; a.font = bodyFont(true); a.border = thinBorder();
      a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      tot(2, "B", "#,##0", "center");
      tot(3, "C", "#,##0", "right");
      tot(4, "D", RAND_FMT, "right");
      const p = sheet.getCell(cur, 5); p.value = ""; p.border = thinBorder();
      p.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cur++;
    }
    cur += 2;
  };

  writeTable("Sub-Channel", oto.bySubChannel);
  writeTable("Category", oto.byCategory);
  writeTable("SKU", oto.bySku);
  writeTable("Site", oto.bySite);

  await commitSheet(sheet);
}

// OTO Detail — one row per qualifying SKU/site line.
async function buildOtoDetailSheet(
  wb: ExcelJS.Workbook,
  oto: OTOAnalysis,
  clientName: string,
  channelLabel: string,
  periodLabel: string,
): Promise<void> {
  // Header row known up front (frozen view is fixed at creation):
  // title (1), note (2), gap.
  const headerRow = 4;
  const sheet = wb.addWorksheet("OTO Detail", sheetOpts({ state: "frozen", ySplit: headerRow }));
  const cols:{ header: string; width: number; key: keyof OTOAnalysis["detail"][number]; fmt?: string; align?: "right" }[] = [
    { header: "Vendor", width: 10, key: "vendor" },
    { header: "Site Num", width: 12, key: "site" },
    { header: "Site Name", width: 24, key: "siteName" },
    { header: "Product Code", width: 14, key: "productCode" },
    { header: "Article", width: 12, key: "article" },
    { header: "Range Indicator", width: 14, key: "rangeIndicator" },
    { header: "Product Description", width: 32, key: "description" },
    { header: "OTO Units", width: 12, key: "units", fmt: "#,##0", align: "right" },
    { header: "OTO Value", width: 14, key: "value", fmt: RAND_FMT, align: "right" },
  ];

  let cur = 1;
  const title = sheet.getCell(cur, 1);
  title.value = `Open to Order — Detail — ${clientName} — ${channelLabel} — ${periodLabel}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_BG } };
  sheet.mergeCells(cur, 1, cur, cols.length);
  cur += 1;

  const note = sheet.getCell(cur, 1);
  note.value = OTO_NOTE;
  note.font = { name: "Calibri", size: 10, italic: true, color: { argb: "828282" } };
  note.alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(cur, 1, cur, cols.length);
  sheet.getRow(cur).height = 64;
  cur += 2;

  // Must match the row the frozen view was created with.
  if (cur !== headerRow) {
    throw new Error(`OTO Detail sheet layout drifted: expected header row ${headerRow}, got ${cur}`);
  }
  cols.forEach((c, i) => {
    const cell = sheet.getCell(headerRow, i + 1);
    cell.value = c.header; cell.font = headerFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = thinBorder(); cell.alignment = { horizontal: "center", wrapText: true };
    sheet.getColumn(i + 1).width = c.width;
  });

  let r = headerRow + 1;
  for (const d of oto.detail) {
    cols.forEach((c, i) => {
      const cell = sheet.getCell(r, i + 1);
      cell.value = d[c.key];
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.align) cell.alignment = { horizontal: c.align };
      cell.font = bodyFont();
      cell.border = thinBorder();
    });
    r++;
  }

  if (oto.detail.length > 0) {
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + oto.detail.length, column: cols.length } };
  }
  await commitSheet(sheet);
}

/* ── Menu / cover sheet — header + hyperlinks to every sheet ──
   The client and channel logos used to sit across the top of this sheet. They
   are gone: WorksheetWriter has no addImage (only addBackgroundImage, which
   tiles and does not print), so a streamed workbook cannot embed them. The
   header block still starts at row 6 so the rest of the cover sheet's layout
   is unchanged. */
function buildMenuSheet(
  wb: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  meta: {
    clientName: string;
    channelLabel: string;
    periodLabel: string;
    dataGapLines?: string[];
    coverageSpan?: string;
    // Tab names in order. Passed in rather than read off wb.worksheets, because
    // this sheet is now written before any of the others exist.
    sheetNames: string[];
  },
): void {
  sheet.getColumn(1).width = 40;
  sheet.getColumn(2).width = 30;

  // Header block
  let row = 6;
  const h1 = sheet.getCell(row, 1);
  h1.value = meta.clientName;
  h1.font = { name: "Calibri", size: 20, bold: true, color: { argb: HEADER_BG } };
  row++;
  const h2 = sheet.getCell(row, 1);
  h2.value = "Month-End Report";
  h2.font = { name: "Calibri", size: 13, bold: true, color: { argb: "828282" } };
  row += 2;

  const meanLine = (label: string, value: string) => {
    const a = sheet.getCell(row, 1);
    a.value = label;
    a.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_BG } };
    const b = sheet.getCell(row, 2);
    b.value = value;
    b.font = { name: "Calibri", size: 11 };
    row++;
  };
  meanLine("Channel", meta.channelLabel);
  meanLine("Period", meta.periodLabel);
  if (meta.coverageSpan) meanLine("Data present", meta.coverageSpan);
  row += 2;

  // Data-coverage warning block (only when the monthly series has gaps).
  if (meta.dataGapLines && meta.dataGapLines.length > 0) {
    const title = sheet.getCell(row, 1);
    title.value = "⚠ Data Coverage Warning — growth may be overstated";
    title.font = { name: "Calibri", size: 11, bold: true, color: { argb: "9C6500" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2CC" } };
    sheet.mergeCells(row, 1, row, 2);
    row++;
    for (const line of meta.dataGapLines) {
      const c = sheet.getCell(row, 1);
      c.value = line;
      c.font = { name: "Calibri", size: 10, color: { argb: "7F6000" } };
      c.alignment = { wrapText: true, vertical: "top" };
      sheet.mergeCells(row, 1, row, 2);
      sheet.getRow(row).height = Math.max(15, Math.ceil(line.length / 70) * 14);
      row++;
    }
    row += 1;
  }

  // Contents — hyperlink to every other sheet
  const ch = sheet.getCell(row, 1);
  ch.value = "Contents";
  ch.font = { name: "Calibri", size: 12, bold: true, color: { argb: HEADER_FG } };
  ch.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  sheet.mergeCells(row, 1, row, 2);
  row++;

  for (const name of meta.sheetNames) {
    const cell = sheet.getCell(row, 1);
    cell.value = { text: name, hyperlink: `#'${name}'!A1` };
    cell.font = { name: "Calibri", size: 11, color: { argb: "0563C1" }, underline: true };
    cell.border = thinBorder();
    row++;
  }
}
