/* ──────────────────────────────────────────────────────────────
   The stock-health rules, in ONE place.

   Two reports ask the same questions of a DISPO line — the per-store action
   list a rep works off (lib/storeReport.ts) and the portfolio roll-up an
   Account Manager reads (lib/portfolioHealth.ts). If each carried its own
   copy of "what counts as out of stock", the two would eventually disagree
   about the same store on the same day, and the one nobody re-derived would
   be believed. So the rules live here and both import them.

   The five measures, and why each is drawn the way it is:

   • OUT OF STOCK — SOH <= 0. Zero and negative are both "a customer cannot
     buy it", which is the question the report asks.

   • NEGATIVE SOH — SOH < 0, so it is a SUBSET of out of stock, not a sixth
     thing beside it. Negative stock is a book-keeping fault (goods received
     but not booked in, or sold twice), and it is worth counting separately
     because the fix is a stock take, not a delivery. ⚠️ Never add the two
     totals together — see `KPI_NOTES` below, which the report prints.

   • LOW STOCK COVER — SOH > 0, still selling, and days cover at or below the
     threshold. "Still selling" (DROS > 0) matters: without it, every slow
     mover with one unit left reads as an emergency.

   • PHANTOM — SOH > 0 but no sale AND no receipt since the cutoff. Stock the
     system believes in and the shelf does not. A BLANK date counts as stale:
     a line that has never recorded a sale is the strongest phantom signal
     there is, and treating blank as "recent" would hide exactly those.

   • DISCONTINUED WITH SOH — SOH > 0 on a SKU whose channel status code means
     discontinued. This one is CONFIGURED, not inferred: the codes come from
     SAP's Plant-Specific Material Status table and differ per banner, so the
     set is supplied by the caller from the Status Reference. When nothing is
     marked, the measure reports itself as NOT CONFIGURED rather than as zero
     — a zero here would read as good news for a question nobody has answered.
   ────────────────────────────────────────────────────────────── */

import { parseDispoDate } from "./monthEndReport";

type Row = { [k: string]: unknown };

/** SOH>0 with this many days cover or fewer. */
export const LOW_COVER_DAYS = 14;
/** Stale-sale AND stale-receipt threshold, in months. */
export const PHANTOM_MONTHS = 3;

export interface StockFlags {
  oos: boolean;
  negSoh: boolean;
  lowCover: boolean;
  phantom: boolean;
  discontinued: boolean;
}

export interface StockFlagInputs {
  /** Ledger date columns ("MM-YYYY"), used for the YTD rate of sale. */
  dateColumns: string[];
  /** Year/month the report is anchored to. */
  refYear: number;
  refMonth: number;
  /** Days elapsed in the report year at the reference date — the DROS divisor. */
  daysElapsed: number;
  /** A sale/receipt at or before this instant is stale (phantom). */
  cutoff: Date;
  lowCoverDays?: number;
  /**
   * PR ST codes that mean discontinued, UPPERCASED, for THIS channel. Empty
   * set = not configured; `discontinued` then stays false everywhere and the
   * caller reports the measure as unconfigured rather than as a count of 0.
   */
  discontinuedCodes: Set<string>;
}

export interface StockLineMetrics {
  flags: StockFlags;
  soh: number;
  /** Daily Rate Of Sale = report-year units to date ÷ days elapsed. */
  dros: number;
  /** SOH ÷ DROS, falling back to the DISPO's own Act DSC. */
  daysCover: number | null;
  /** Is the line in base at all (has stock and/or any sales)? */
  inBase: boolean;
  /** The PR ST code as displayed, uppercased ("" when blank). */
  statusCode: string;
}

export const MS_PER_DAY = 86400000;

/** N months before `d`, in UTC. The phantom cutoff. */
export function minusMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - months);
  return r;
}

/**
 * Days elapsed in the reference year — the DROS divisor.
 *
 * Both reports must divide by the SAME number or the same line reads as thin
 * cover in one and not the other. It is FLOOR, matching what the store report
 * has always done; on the month-end midnights these reports are anchored to
 * the two agree anyway, but a rounding difference is not a thing to leave
 * lying around between two copies of a metric.
 */
export function daysElapsedInYear(ref: Date): number {
  const startOfYear = Date.UTC(ref.getUTCFullYear(), 0, 1);
  return Math.max(1, Math.floor((ref.getTime() - startOfYear) / MS_PER_DAY) + 1);
}

/** Numeric read that treats blanks as a caller-chosen default. */
export function num(v: unknown, blankAs: number): number {
  if (typeof v === "number") return v;
  if (v == null) return blankAs;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return blankAs;
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

/**
 * A SKU×store is "in base" if it has stock and/or any sales across the
 * ledger's date columns — the same universe Month-End uses for OOS / Status.
 */
export function classifyBase(row: Row, dateColumns: string[]): { inBase: boolean; soh: number } {
  const soh = num(row["SOH"], 0);
  const hasStock = !isNaN(soh) && soh > 0;
  let sales = 0;
  for (const col of dateColumns) {
    const v = num(row[col], 0);
    if (!isNaN(v)) sales += v;
  }
  return { inBase: hasStock || sales > 0, soh: isNaN(soh) ? 0 : soh };
}

/** Report-year units up to and including the report month. */
export function ytdUnits(row: Row, dateColumns: string[], year: number, month: number): number {
  let total = 0;
  for (const col of dateColumns) {
    const m = col.match(/^(\d{2})-(\d{4})$/);
    if (!m) continue;
    if (Number(m[2]) !== year) continue;
    if (Number(m[1]) > month) continue;
    const v = num(row[col], 0);
    if (!isNaN(v)) total += v;
  }
  return total;
}

/** The PR ST code on a row, uppercased. "" when blank. */
export function statusCodeOf(row: Row): string {
  return String(row["Status"] ?? row["PR ST"] ?? "").trim().toUpperCase();
}

/** The five stock-health measures for one enriched ledger row. */
export function computeStockFlags(row: Row, opts: StockFlagInputs): StockLineMetrics {
  const lowCoverDays = opts.lowCoverDays ?? LOW_COVER_DAYS;
  const { inBase, soh } = classifyBase(row, opts.dateColumns);

  const ytd = ytdUnits(row, opts.dateColumns, opts.refYear, opts.refMonth);
  const dros = ytd > 0 && opts.daysElapsed > 0 ? ytd / opts.daysElapsed : 0;
  const actDsc = num(row["Act DSC"], NaN);
  const daysCover = dros > 0 ? soh / dros : (isNaN(actDsc) ? null : actDsc);

  const statusCode = statusCodeOf(row);

  const flags: StockFlags = {
    oos: soh <= 0,
    negSoh: soh < 0,
    lowCover: soh > 0 && dros > 0 && daysCover !== null && daysCover <= lowCoverDays,
    phantom: false,
    // An empty code set means "nobody has said which codes mean discontinued",
    // and `Set.has("")` is false anyway, so a blank code can never match.
    discontinued: soh > 0 && statusCode !== "" && opts.discontinuedCodes.has(statusCode),
  };

  if (soh > 0) {
    // A BLANK date is STALE, not recent — a line that has never sold is the
    // strongest phantom signal there is.
    const lastSold = parseDispoDate(row["Last Sold"]);
    const lastRecv = parseDispoDate(row["Last Recv"]);
    const soldOld = lastSold === null || lastSold.getTime() <= opts.cutoff.getTime();
    const recvOld = lastRecv === null || lastRecv.getTime() <= opts.cutoff.getTime();
    flags.phantom = soldOld && recvOld;
  }

  return { flags, soh, dros, daysCover, inBase, statusCode };
}

/** Does this line trigger anything at all? */
export function hasAnyFlag(f: StockFlags): boolean {
  return f.oos || f.lowCover || f.phantom || f.discontinued;
}

/* Re-exported so server-side callers have one import for the rules and the
   wording. The sentences live in lib/stockFlagNotes.ts, which imports nothing,
   because the report PAGE is a client component and this module is not.

   Negative SOH is a subset of out of stock, and one line can be several things
   at once (phantom stock on a discontinued SKU is both), so the five numbers
   deliberately do not add up and there is no arithmetic in which they should. */
export { KPI_NOTES } from "./stockFlagNotes";
