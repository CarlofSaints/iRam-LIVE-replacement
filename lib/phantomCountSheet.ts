/* ──────────────────────────────────────────────────────────────
   Phantom stock COUNT SHEET (.xlsx).

   Deliberately modelled on the sheet the teams already print and walk the aisle
   with, so it needs no explaining: same columns, same order, sorted by Article.

     Vendor · Article · Barcode · Vend. Prod. · Material Description ·
     Date Last Sold · Last Recpt Y/M · Act DSC · Stk Margin · PR ST · SOH ·
     Count 1 · Count 2 · Comment

   Two differences from the legacy sheet, both asked for:
     • VENDOR is a new first column so the sheet can be filtered per vendor.
     • STO is dropped — we don't carry that column, and it was 0 on every line.

   Count 1 is what the rep entered on the report ("Stock Found"); Count 2 and
   Comment are always blank — a recount and a note done on paper, in store.

   Built with the NON-streaming exceljs writer: these sheets are a few hundred
   rows, so there is no memory pressure, and it avoids the streaming writer's
   invalid element ordering (see lib/exceljsStreamOrder.ts).
   ────────────────────────────────────────────────────────────── */

import ExcelJS from "exceljs";
import type { StoreLine } from "./storeReport";
import { parseDispoDate } from "./monthEndReport";

export type CountMode = "empty" | "counts";

export interface PhantomSheetMeta {
  storeName: string;
  siteCode: string;
  subChannel?: string;
  province?: string;
  periodLabel: string;             // "Wk 2 · Aug 2026"
  generatedAt: string;             // "11 Aug 2026 at 14:20"
  vendorLabel: string;             // "ALL" or the vendor number
  repName?: string;
  mode: CountMode;
}

export interface PhantomSheetOpts {
  oneSheet: boolean;                       // true = every vendor on one sheet
  counts?: Record<string, number>;         // `clientId|article` → units found
}

const NAVY = "FF1C3D5A";
const HEAD_TEXT = "FFFFFFFF";
const SUBTLE = "FF6B7280";
const ENTRY_BG = "FFFFF7E0";   // the columns the rep writes into — tinted so they stand out on paper

interface Col {
  header: string;
  width: number;
  fmt?: string;
  entry?: boolean;                                  // a column the rep fills in
  get: (l: StoreLine, found: number | null) => string | number | null;
}

// "2025/05" — the retailer prints last receipt to the month only.
function yearMonth(raw: string): string {
  const d = parseDispoDate(raw);
  if (!d) return raw || "";
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const COLUMNS: Col[] = [
  { header: "Vendor",               width: 10, get: (l) => l.vendor || "" },
  { header: "Article",              width: 13, get: (l) => l.article || "" },
  // Barcodes are 13 digits — as a number Excel shows 6.00123E+12 and drops the
  // leading zero, so this column is text on purpose.
  { header: "Barcode",              width: 16, fmt: "@", get: (l) => l.barcode || "" },
  { header: "Vend. Prod.",          width: 13, get: (l) => l.vendorProdCode || "" },
  { header: "Material Description", width: 40, get: (l) => l.description || "" },
  { header: "Date Last Sold",       width: 14, get: (l) => l.lastSold || "" },
  { header: "Last Recpt Y/M",       width: 14, get: (l) => yearMonth(l.lastReceived) },
  { header: "Act DSC",              width: 9,  fmt: "0",     get: (l) => l.actDsc },
  { header: "Stk Margin",           width: 10, fmt: "0%",    get: (l) => l.stockMargin },
  { header: "PR ST",                width: 8,  get: (l) => l.prst === "(blank)" ? "" : l.prst },
  // No thousands separator on the quantity columns — these are unit counts a rep
  // reads and writes by hand, and "1,250" invites being read as a decimal comma
  // in a locale that uses one. Decimals still show when there are any.
  { header: "SOH",                  width: 8,  fmt: "0.##", get: (l) => l.soh },
  // Decimals are real here — reps count metres of rope, not just whole units.
  { header: "Count 1", width: 10, fmt: "0.##", entry: true, get: (_l, found) => found },
  { header: "Count 2", width: 10, fmt: "0.##", entry: true, get: () => null },
  { header: "Comment", width: 30, entry: true, get: () => null },
];

function countKey(l: StoreLine): string {
  return `${l.clientId}|${l.article}`;
}

// Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 chars.
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || "Sheet").slice(0, 31);
}

function buildSheet(
  wb: ExcelJS.Workbook,
  name: string,
  lines: StoreLine[],
  meta: PhantomSheetMeta,
  vendorLabel: string,
  counts: Record<string, number>,
): void {
  const ws = wb.addWorksheet(safeSheetName(name), {
    views: [{ showGridLines: false, state: "frozen", ySplit: 5 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      // The rep is holding paper — every page needs the column headings.
      printTitlesRow: "5:5",
    },
  });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  const lastCol = COLUMNS.length;
  const colLetter = (n: number) => ws.getColumn(n).letter;
  const span = (row: number) => `A${row}:${colLetter(lastCol)}${row}`;

  // ── Header block ──────────────────────────────────────────────
  ws.mergeCells(span(1));
  const r1 = ws.getCell("A1");
  r1.value = `PHANTOM STOCK COUNT  ·  ${meta.generatedAt}`;
  r1.font = { bold: true, size: 11, color: { argb: HEAD_TEXT } };
  r1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  r1.alignment = { vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(span(2));
  const r2 = ws.getCell("A2");
  r2.value = [meta.storeName, meta.siteCode].filter(Boolean).join(" — ");
  r2.font = { bold: true, size: 15 };
  ws.getRow(2).height = 22;

  ws.mergeCells(span(3));
  const r3 = ws.getCell("A3");
  const bits = [
    meta.subChannel, meta.province, meta.periodLabel,
    `Vendor: ${vendorLabel}`,
    meta.repName ? `Rep: ${meta.repName}` : "",
    `${lines.length} line${lines.length === 1 ? "" : "s"} to count`,
  ].filter(Boolean);
  r3.value = bits.join("  ·  ");
  r3.font = { size: 10, color: { argb: SUBTLE } };

  ws.mergeCells(span(4));
  const r4 = ws.getCell("A4");
  r4.value = meta.mode === "counts"
    ? "Count 1 = what was captured on the report. Recount in Count 2 and note anything unusual in Comment."
    : "Write what you physically find in Count 1. Count 2 is for a recount; use Comment for anything unusual.";
  r4.font = { size: 10, italic: true, color: { argb: SUBTLE } };

  // ── Column headings ───────────────────────────────────────────
  const head = ws.getRow(5);
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10, color: { argb: HEAD_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin" } };
  });
  head.height = 28;

  // ── Data ──────────────────────────────────────────────────────
  // Sorted by Article ascending, matching the sheet the teams use today.
  // Numeric-aware so 620983 sorts before 850023056 rather than by string.
  const sorted = [...lines].sort((a, b) => {
    const na = Number(a.article), nb = Number(b.article);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a.article).localeCompare(String(b.article));
  });

  for (const l of sorted) {
    const found = meta.mode === "counts" ? (counts[countKey(l)] ?? null) : null;
    const row = ws.addRow(COLUMNS.map((c) => c.get(l, found)));
    row.height = 16;
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { size: 10 };
      if (c.fmt) cell.numFmt = c.fmt;
      cell.border = {
        top: { style: "hair", color: { argb: "FFD9DDE2" } },
        bottom: { style: "hair", color: { argb: "FFD9DDE2" } },
        left: { style: "hair", color: { argb: "FFD9DDE2" } },
        right: { style: "hair", color: { argb: "FFD9DDE2" } },
      };
      if (c.entry) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ENTRY_BG } };
      if (c.header === "Material Description") cell.alignment = { wrapText: false };
    });
  }

  if (sorted.length === 0) {
    ws.mergeCells(span(6));
    const none = ws.getCell("A6");
    none.value = "No phantom lines for this selection.";
    none.font = { italic: true, color: { argb: SUBTLE } };
  } else {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + sorted.length, column: lastCol } };
  }
}

export async function buildPhantomCountWorkbook(
  lines: StoreLine[],
  meta: PhantomSheetMeta,
  opts: PhantomSheetOpts,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "iRam LIVE";
  wb.created = new Date();

  const counts = opts.counts ?? {};

  if (opts.oneSheet) {
    buildSheet(wb, "Stock Count", lines, meta, meta.vendorLabel, counts);
  } else {
    // A tab per vendor, in vendor order. A line with no vendor still needs a home
    // — it goes to its own tab rather than being silently left out of the count.
    const byVendor = new Map<string, StoreLine[]>();
    for (const l of lines) {
      const v = l.vendor || "No vendor";
      const list = byVendor.get(v);
      if (list) list.push(l); else byVendor.set(v, [l]);
    }
    const vendors = [...byVendor.keys()].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
    // An empty selection would produce a workbook with no sheets at all, which
    // Excel refuses to open — always emit at least one.
    if (vendors.length === 0) {
      buildSheet(wb, "Stock Count", [], meta, meta.vendorLabel, counts);
    } else {
      for (const v of vendors) buildSheet(wb, v, byVendor.get(v)!, meta, v, counts);
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// "Phantom Stock Count - BWH RIVONIA-B50 - 1063 - 2026-08-11.xlsx"
export function phantomSheetFileName(meta: PhantomSheetMeta, date: Date = new Date()): string {
  const day = date.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const store = (meta.storeName || meta.siteCode || "Store").replace(/[<>:"/\\|?*]/g, " ").trim();
  return `Phantom Stock Count - ${store} - ${meta.vendorLabel} - ${day}.xlsx`;
}
