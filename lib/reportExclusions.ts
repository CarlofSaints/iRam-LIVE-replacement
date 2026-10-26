/* ──────────────────────────────────────────────────────────────
   Lines Month-End and Vital Signs leave out entirely (Carl, 30 Sep 2026):

   1. CLOSED STORES. Store master status reads closed / inactive / delisted,
      or the store name carries "(CLOSED)" (how the range file and store lists
      mark them, e.g. "BWH GEZINA (CLOSED) - B01"). Same test as the store-code
      check's isCallableStore (app/api/store-reports/code-check).
   2. DEAD DISCONTINUED LINES. PMF product status DISCONTINUED, no stock on
      hand, and no sales in the report's year. Nothing to act on, so it is noise
      on every sheet. A discontinued line WITH stock or sales this year stays —
      that stock still has to be sold through.
   ────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const CLOSED_STATUS = /clos|shut|inactiv|ceas|delist|not\s*trad/i;

/** A store is closed by its status, or by "(CLOSED)" in its name. */
export function isClosedStore(status: unknown, name?: unknown): boolean {
  if (CLOSED_STATUS.test(String(status ?? ""))) return true;
  return /\(\s*closed\s*\)/i.test(String(name ?? ""));
}

function rowStoreClosed(row: Row): boolean {
  return isClosedStore(row["_storeStatus"], row["_storeName"] || row["Site Name"]);
}

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/,/g, "").trim() || 0);
  return isNaN(n) ? 0 : n;
}

/** DISCONTINUED in the PMF, no SOH, and no sales in `year`'s month columns. */
export function isDeadDiscontinued(row: Row, dateColumns: string[], year: number): boolean {
  if (String(row["_productStatus"] ?? "").trim().toUpperCase() !== "DISCONTINUED") return false;
  if (num(row["SOH"]) > 0) return false;
  for (const col of dateColumns) {
    const m = col.match(/^(\d{2})-(\d{4})$/);
    if (m && Number(m[2]) === year && num(row[col]) !== 0) return false;
  }
  return true;
}

export interface ExclusionResult<T> {
  rows: T[];
  closedStoreLines: number;
  /** Closed-store lines kept because the report asked for them and they still have stock or sales. */
  closedStoreLinesKept: number;
  deadDiscontinuedLines: number;
}

/** Any stock on hand or any sales in `year`'s month columns. */
function hasStockOrSales(row: Row, dateColumns: string[], year: number): boolean {
  if (num(row["SOH"]) > 0) return true;
  for (const col of dateColumns) {
    const m = col.match(/^(\d{2})-(\d{4})$/);
    if (m && Number(m[2]) === year && num(row[col]) !== 0) return true;
  }
  return false;
}

/* includeClosed (Month-End "Include closed stores?" = YES, Carl 26 Oct 2026):
   a closed store's line stays when it still has stock or sales this year. One
   with neither stays out either way, or every empty closed store reads as OOS. */
export function applyReportExclusions<T extends Row>(
  rows: T[], dateColumns: string[], year: number, opts: { includeClosed?: boolean } = {},
): ExclusionResult<T> {
  let closedStoreLines = 0;
  let closedStoreLinesKept = 0;
  let deadDiscontinuedLines = 0;
  const kept: T[] = [];
  for (const r of rows) {
    if (rowStoreClosed(r)) {
      if (!opts.includeClosed || !hasStockOrSales(r, dateColumns, year)) { closedStoreLines++; continue; }
      closedStoreLinesKept++;
    }
    if (isDeadDiscontinued(r, dateColumns, year)) { deadDiscontinuedLines++; continue; }
    kept.push(r);
  }
  return { rows: kept, closedStoreLines, closedStoreLinesKept, deadDiscontinuedLines };
}

/** One line for the report's Menu, or "" when nothing was left out. */
export function exclusionLabel(x: { closedStoreLines: number; deadDiscontinuedLines: number; closedStoreLinesKept?: number }, year: number): string {
  const parts: string[] = [];
  if (x.closedStoreLines) parts.push(`${x.closedStoreLines.toLocaleString("en-ZA")} lines at closed stores` + (x.closedStoreLinesKept ? " with no stock and no sales" : ""));
  if (x.deadDiscontinuedLines) parts.push(`${x.deadDiscontinuedLines.toLocaleString("en-ZA")} discontinued lines with no stock and no ${year} sales`);
  const left = parts.join("; ");
  if (!x.closedStoreLinesKept) return left;
  const kept = `closed stores included: ${x.closedStoreLinesKept.toLocaleString("en-ZA")} lines with stock or ${year} sales`;
  return left ? `${left} (${kept})` : kept;
}
