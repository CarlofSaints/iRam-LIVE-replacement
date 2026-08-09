/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Month-End Report â€” aggregation & computation engine

   Takes enriched ledger rows, groups and aggregates them into
   cascading summary tables at multiple levels:
     Sub-Channel â†’ Province â†’ Category â†’ Store â†’ Product

   Each level has Volume + Value variants with columns:
     Entity, # Stores, YTD, LY YTD, Current Month, Same Month LY,
     Last Month, Growth YTD %, Growth vs LM %, Growth vs PYM %,
     Contribution %

   Also computes OOS summary + detail data.
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

import type { StatusDefinition, StatusScenario, StatusClassification, StoreRecord, ProductMaster } from "./types";
import { evaluateScenarios } from "./statusScenarioData";
import { calcOpenToOrder } from "./vitalSigns";

type Row = Record<string, unknown>;

export const VAT_RATE = 0.15;
const DATE_RE = /^(\d{2})-(\d{4})$/;

function parseDateKey(col: string): { month: number; year: number } | null {
  const m = col.match(DATE_RE);
  if (!m) return null;
  return { month: parseInt(m[1], 10), year: parseInt(m[2], 10) };
}

function effectivePriceExVat(row: Row, inclKey = "Incl SP", promKey = "Prom SP"): number {
  const promSP = Number(row[promKey] ?? 0);
  const inclSP = Number(row[inclKey] ?? 0);
  const price = (!isNaN(promSP) && promSP > 0) ? promSP : (!isNaN(inclSP) ? inclSP : 0);
  return price / (1 + VAT_RATE);
}

// â”€â”€ Date column classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DateContext {
  dateColumns: string[];
  maxYear: number;
  maxMonth: number;
  currentYearCols: string[];
  lyYtdCols: string[];
  currentMonthCol: string | null;      // latest month in current year
  lastMonthCol: string | null;         // month before current in current year
  sameMonthLyCol: string | null;       // same month in previous year
}

export function buildDateContext(dateColumns: string[]): DateContext {
  let maxYear = 0;
  let maxMonth = 0;

  for (const col of dateColumns) {
    const p = parseDateKey(col);
    if (p && p.year > maxYear) maxYear = p.year;
  }

  const currentYearCols = maxYear > 0
    ? dateColumns.filter((col) => {
        const p = parseDateKey(col);
        return p != null && p.year === maxYear;
      })
    : dateColumns;

  for (const col of currentYearCols) {
    const p = parseDateKey(col);
    if (p && p.month > maxMonth) maxMonth = p.month;
  }

  const lastYear = maxYear - 1;
  const lyYtdCols = maxYear > 0 && maxMonth > 0
    ? dateColumns.filter((col) => {
        const p = parseDateKey(col);
        return p != null && p.year === lastYear && p.month <= maxMonth;
      })
    : [];

  // Current month column
  const currentMonthCol = maxYear > 0 && maxMonth > 0
    ? `${String(maxMonth).padStart(2, "0")}-${maxYear}`
    : null;

  // Last month column (previous month in current year, or Dec of last year if Jan)
  let lastMonthCol: string | null = null;
  if (maxYear > 0 && maxMonth > 0) {
    if (maxMonth > 1) {
      lastMonthCol = `${String(maxMonth - 1).padStart(2, "0")}-${maxYear}`;
    } else {
      lastMonthCol = `12-${maxYear - 1}`;
    }
    // Only use if present in dateColumns
    if (!dateColumns.includes(lastMonthCol)) lastMonthCol = null;
  }

  // Same month last year
  let sameMonthLyCol: string | null = null;
  if (maxYear > 0 && maxMonth > 0) {
    sameMonthLyCol = `${String(maxMonth).padStart(2, "0")}-${lastYear}`;
    if (!dateColumns.includes(sameMonthLyCol)) sameMonthLyCol = null;
  }

  return {
    dateColumns,
    maxYear,
    maxMonth,
    currentYearCols,
    lyYtdCols,
    currentMonthCol: currentMonthCol && dateColumns.includes(currentMonthCol) ? currentMonthCol : null,
    lastMonthCol,
    sameMonthLyCol,
  };
}

// â”€â”€ Row-level value extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RowMetrics {
  ytdUnits: number;
  ytdValue: number;
  lyYtdUnits: number;
  lyYtdValue: number;
  currentMonthUnits: number;
  currentMonthValue: number;
  sameMonthLyUnits: number;
  sameMonthLyValue: number;
  lastMonthUnits: number;
  lastMonthValue: number;
}

function getRowMetrics(row: Row, ctx: DateContext): RowMetrics {
  const sellingPrice = effectivePriceExVat(row);
  const lastYear = ctx.maxYear - 1;
  const lySellingPrice = effectivePriceExVat(
    row, `_inclSP_${lastYear}`, `_promSP_${lastYear}`
  ) || sellingPrice;

  let ytdUnits = 0;
  for (const col of ctx.currentYearCols) {
    const v = Number(row[col]);
    if (!isNaN(v)) ytdUnits += v;
  }

  let lyYtdUnits = 0;
  for (const col of ctx.lyYtdCols) {
    const v = Number(row[col]);
    if (!isNaN(v)) lyYtdUnits += v;
  }

  const currentMonthUnits = ctx.currentMonthCol ? (Number(row[ctx.currentMonthCol]) || 0) : 0;
  const sameMonthLyUnits = ctx.sameMonthLyCol ? (Number(row[ctx.sameMonthLyCol]) || 0) : 0;
  const lastMonthUnits = ctx.lastMonthCol ? (Number(row[ctx.lastMonthCol]) || 0) : 0;

  return {
    ytdUnits,
    ytdValue: ytdUnits * sellingPrice,
    lyYtdUnits,
    lyYtdValue: lyYtdUnits * lySellingPrice,
    currentMonthUnits,
    currentMonthValue: currentMonthUnits * sellingPrice,
    sameMonthLyUnits,
    sameMonthLyValue: sameMonthLyUnits * lySellingPrice,
    lastMonthUnits,
    lastMonthValue: lastMonthUnits * sellingPrice,
  };
}

// â”€â”€ Aggregated summary row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SummaryRow {
  name: string;
  storeCount: number;  // unique stores in this group
  ytd: number;
  lyYtd: number;
  currentMonth: number;
  sameMonthLy: number;
  lastMonth: number;
  growthYtdPct: number | null;
  growthVsLmPct: number | null;
  growthVsPymPct: number | null;
  contributionPct: number;
}

function calcGrowth(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : null; // can't divide by zero
  return ((current - previous) / Math.abs(previous)) * 100;
}

function aggregateRows(
  rows: Row[],
  ctx: DateContext,
  groupKey: (row: Row) => string,
  totalYtd: number,
  mode: "volume" | "value",
  countMode: "stores" | "skus" = "stores"
): SummaryRow[] {
  const groups = new Map<string, { metrics: RowMetrics; stores: Set<string>; skuCount: number }>();

  for (const row of rows) {
    const key = groupKey(row);
    const m = getRowMetrics(row, ctx);
    const site = String(row["Site"] ?? "").trim();

    let group = groups.get(key);
    if (!group) {
      group = {
        metrics: { ytdUnits: 0, ytdValue: 0, lyYtdUnits: 0, lyYtdValue: 0, currentMonthUnits: 0, currentMonthValue: 0, sameMonthLyUnits: 0, sameMonthLyValue: 0, lastMonthUnits: 0, lastMonthValue: 0 },
        stores: new Set(),
        skuCount: 0,
      };
      groups.set(key, group);
    }

    group.metrics.ytdUnits += m.ytdUnits;
    group.metrics.ytdValue += m.ytdValue;
    group.metrics.lyYtdUnits += m.lyYtdUnits;
    group.metrics.lyYtdValue += m.lyYtdValue;
    group.metrics.currentMonthUnits += m.currentMonthUnits;
    group.metrics.currentMonthValue += m.currentMonthValue;
    group.metrics.sameMonthLyUnits += m.sameMonthLyUnits;
    group.metrics.sameMonthLyValue += m.sameMonthLyValue;
    group.metrics.lastMonthUnits += m.lastMonthUnits;
    group.metrics.lastMonthValue += m.lastMonthValue;
    if (site) group.stores.add(site);

    if (countMode === "skus") {
      // Count a SKU instance for this group when the product has any sales
      // (this year or last) and/or any stock on hand at this store.
      const soh = Number(row["SOH"] ?? 0);
      const hasStock = !isNaN(soh) && soh > 0;
      const hasSales = m.ytdUnits > 0 || m.lyYtdUnits > 0;
      if (hasSales || hasStock) group.skuCount++;
    }
  }

  const result: SummaryRow[] = [];

  for (const [name, { metrics, stores, skuCount }] of groups) {
    const ytd = mode === "volume" ? metrics.ytdUnits : metrics.ytdValue;
    const lyYtd = mode === "volume" ? metrics.lyYtdUnits : metrics.lyYtdValue;
    const cm = mode === "volume" ? metrics.currentMonthUnits : metrics.currentMonthValue;
    const smly = mode === "volume" ? metrics.sameMonthLyUnits : metrics.sameMonthLyValue;
    const lm = mode === "volume" ? metrics.lastMonthUnits : metrics.lastMonthValue;

    result.push({
      name,
      storeCount: countMode === "skus" ? skuCount : stores.size,
      ytd: r2(ytd),
      lyYtd: r2(lyYtd),
      currentMonth: r2(cm),
      sameMonthLy: r2(smly),
      lastMonth: r2(lm),
      growthYtdPct: calcGrowth(ytd, lyYtd),
      growthVsLmPct: calcGrowth(cm, lm),
      growthVsPymPct: calcGrowth(cm, smly),
      contributionPct: totalYtd > 0 ? r2((ytd / totalYtd) * 100) : 0,
    });
  }

  // Sort by YTD descending
  result.sort((a, b) => b.ytd - a.ytd);

  return result;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// â”€â”€ Grand total row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function computeGrandTotal(summaryRows: SummaryRow[], totalStoreCount?: number): SummaryRow {
  const totals: SummaryRow = {
    name: "GRAND TOTAL",
    storeCount: 0, // will be set from unique stores across all groups
    ytd: 0,
    lyYtd: 0,
    currentMonth: 0,
    sameMonthLy: 0,
    lastMonth: 0,
    growthYtdPct: null,
    growthVsLmPct: null,
    growthVsPymPct: null,
    contributionPct: 100,
  };

  for (const row of summaryRows) {
    totals.ytd += row.ytd;
    totals.lyYtd += row.lyYtd;
    totals.currentMonth += row.currentMonth;
    totals.sameMonthLy += row.sameMonthLy;
    totals.lastMonth += row.lastMonth;
    // Sum per-group counts only as a fallback. For "stores" mode this
    // over-counts at levels where a store appears in many groups
    // (Category, Product), so the caller passes the true unique total.
    if (totalStoreCount === undefined) totals.storeCount += row.storeCount;
  }

  if (totalStoreCount !== undefined) totals.storeCount = totalStoreCount;

  totals.ytd = r2(totals.ytd);
  totals.lyYtd = r2(totals.lyYtd);
  totals.currentMonth = r2(totals.currentMonth);
  totals.sameMonthLy = r2(totals.sameMonthLy);
  totals.lastMonth = r2(totals.lastMonth);
  totals.growthYtdPct = calcGrowth(totals.ytd, totals.lyYtd);
  totals.growthVsLmPct = calcGrowth(totals.currentMonth, totals.lastMonth);
  totals.growthVsPymPct = calcGrowth(totals.currentMonth, totals.sameMonthLy);

  return totals;
}

// â”€â”€ Full Sales Summary (cascading levels) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/* A client is one company but often several VENDOR NUMBERS, each carrying its
   own product range. The DISPO parser resolves a vendor per row and stamps it
   as `_vendor` (a DC line inherits the vendor of the same article found under
   a numeric vendor), and the ledger merge preserves it â€” so every enriched row
   knows which vendor range it belongs to.

   The report is scoped to a client + channel, never to one vendor, so without
   this the ranges are silently blended: a file named "â€¦ - 1063 - â€¦" (just the
   client's FIRST vendor number) actually contains all of them. The legacy iRam
   LIVE emitted one file per vendor; this keeps a single file and separates
   them with a column instead. */
export function rowVendor(row: Row): string {
  return String(row["_vendor"] ?? "").trim();
}

export interface SalesSummaryLevel {
  level: string;          // "Vendor", "Sub-Channel", "Province", "Category", "Store", "Product"
  volumeRows: SummaryRow[];
  volumeTotal: SummaryRow;
  valueRows: SummaryRow[];
  valueTotal: SummaryRow;
}

export function buildSalesSummary(
  rows: Row[],
  ctx: DateContext,
): SalesSummaryLevel[] {
  // Compute grand totals for contribution % denominator
  let grandYtdUnits = 0;
  let grandYtdValue = 0;
  for (const row of rows) {
    const m = getRowMetrics(row, ctx);
    grandYtdUnits += m.ytdUnits;
    grandYtdValue += m.ytdValue;
  }

  // True unique store count across the whole dataset â€” used for the grand
  // total of every "stores" mode level (a store can sit in many Category /
  // Product groups, so summing per-group counts would over-count).
  const storeSet = new Set<string>();
  for (const row of rows) {
    const s = String(row["Site"] ?? "").trim();
    if (s) storeSet.add(s);
  }
  const tStores = storeSet.size;

  const levels: SalesSummaryLevel[] = [];

  /* Level 0: Vendor â€” first, because it is the widest cut of the report and
     the one the reader needs before any other number means anything. A client
     with a single vendor number simply gets a one-row table. */
  const vendorKey = (r: Row) => rowVendor(r) || "Unknown";
  const vendVolume = aggregateRows(rows, ctx, vendorKey, grandYtdUnits, "volume");
  const vendValue = aggregateRows(rows, ctx, vendorKey, grandYtdValue, "value");
  levels.push({
    level: "Vendor",
    volumeRows: vendVolume,
    volumeTotal: computeGrandTotal(vendVolume, tStores),
    valueRows: vendValue,
    valueTotal: computeGrandTotal(vendValue, tStores),
  });

  // Level 1: Sub-Channel
  const subChVolume = aggregateRows(rows, ctx, (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || "Unknown"), grandYtdUnits, "volume");
  const subChValue = aggregateRows(rows, ctx, (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Sub-Channel",
    volumeRows: subChVolume,
    volumeTotal: computeGrandTotal(subChVolume, tStores),
    valueRows: subChValue,
    valueTotal: computeGrandTotal(subChValue, tStores),
  });

  // Level 2: Province
  const provVolume = aggregateRows(rows, ctx, (r) => String(r["_province"] || "Unknown"), grandYtdUnits, "volume");
  const provValue = aggregateRows(rows, ctx, (r) => String(r["_province"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Province",
    volumeRows: provVolume,
    volumeTotal: computeGrandTotal(provVolume, tStores),
    valueRows: provValue,
    valueTotal: computeGrandTotal(provValue, tStores),
  });

  // Level 3: Category
  const catVolume = aggregateRows(rows, ctx, (r) => String(r["_category"] || "Unknown"), grandYtdUnits, "volume");
  const catValue = aggregateRows(rows, ctx, (r) => String(r["_category"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Category",
    volumeRows: catVolume,
    volumeTotal: computeGrandTotal(catVolume, tStores),
    valueRows: catValue,
    valueTotal: computeGrandTotal(catValue, tStores),
  });

  // Level 4: Store â€” count is "Number of SKUs" (SKU instances with sales
  // and/or stock at the store), not store count.
  const storeVolume = aggregateRows(rows, ctx, (r) => String(r["_storeName"] || r["Site Name"] || r["Site"] || "Unknown"), grandYtdUnits, "volume", "skus");
  const storeValue = aggregateRows(rows, ctx, (r) => String(r["_storeName"] || r["Site Name"] || r["Site"] || "Unknown"), grandYtdValue, "value", "skus");
  levels.push({
    level: "Store",
    volumeRows: storeVolume,
    volumeTotal: computeGrandTotal(storeVolume),
    valueRows: storeValue,
    valueTotal: computeGrandTotal(storeValue),
  });

  // Level 5: Product
  const prodVolume = aggregateRows(rows, ctx, (r) => String(r["Article Desc"] || r["Article"] || "Unknown"), grandYtdUnits, "volume");
  const prodValue = aggregateRows(rows, ctx, (r) => String(r["Article Desc"] || r["Article"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Product",
    volumeRows: prodVolume,
    volumeTotal: computeGrandTotal(prodVolume, tStores),
    valueRows: prodValue,
    valueTotal: computeGrandTotal(prodValue, tStores),
  });

  return levels;
}

// â”€â”€ OOS Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface OOSSummary {
  baseCount: number;       // SKUÃ—store rows with stock and/or sales (the base)
  oosCount: number;        // base rows where SOH <= 0
  oosPct: number;
  productSummary: OOSProductRow[];
  storeSummary: OOSStoreRow[];
}

export interface OOSProductRow {
  article: string;
  vendor: string;
  description: string;
  category: string;
  productStatus: string;
  totalStores: number;     // sites where this SKU has stock and/or sales
  oosStores: number;       // those sites where SOH <= 0
  oosPct: number;
}

export interface OOSStoreRow {
  site: string;
  siteName: string;
  subChannel: string;
  totalSkus: number;       // SKUs in this store with stock and/or sales
  oosSkus: number;         // those SKUs where SOH <= 0
  oosPct: number;
}

// Parse a possibly string/blank numeric cell. Blank â†’ blankAs; non-numeric â†’ NaN.
function parseNum(v: unknown, blankAs: number): number {
  if (typeof v === "number") return v;
  if (v == null) return blankAs;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return blankAs;
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

// A SKUÃ—store is "in base" if it has stock on hand and/or any sales (across the
// ledger's date columns). It is OOS when, being in base, its SOH is 0 or below.
function classifyOOS(row: Row, dateColumns: string[]): { inBase: boolean; isOOS: boolean } {
  const soh = parseNum(row["SOH"], 0);
  const hasStock = !isNaN(soh) && soh > 0;

  let salesUnits = 0;
  for (const col of dateColumns) {
    const v = parseNum(row[col], 0);
    if (!isNaN(v)) salesUnits += v;
  }
  const hasSales = salesUnits > 0;

  const inBase = hasStock || hasSales;
  const isOOS = inBase && !isNaN(soh) && soh <= 0;
  return { inBase, isOOS };
}

export function buildOOSSummary(rows: Row[], dateColumns: string[]): OOSSummary {
  let baseCount = 0;
  let oosCount = 0;

  // Per-product: base sites + OOS sites (counts distinct sites)
  const productMap = new Map<string, {
    description: string;
    category: string;
    productStatus: string;
    vendor: string;
    baseStores: Set<string>;
    oosStores: Set<string>;
  }>();

  // Per-store: base SKUs + OOS SKUs (counts distinct SKUs)
  const storeMap = new Map<string, {
    siteName: string;
    subChannel: string;
    baseSkus: Set<string>;
    oosSkus: Set<string>;
  }>();

  for (const row of rows) {
    const { inBase, isOOS } = classifyOOS(row, dateColumns);
    if (!inBase) continue; // ignore rows with neither stock nor sales

    baseCount++;
    if (isOOS) oosCount++;

    const article = String(row["Article"] ?? "").trim();
    const site = String(row["Site"] ?? "").trim();

    if (article) {
      let entry = productMap.get(article);
      if (!entry) {
        entry = {
          description: String(row["Article Desc"] ?? ""),
          category: String(row["_category"] ?? ""),
          productStatus: String(row["_productStatus"] ?? ""),
          vendor: rowVendor(row),
          baseStores: new Set(),
          oosStores: new Set(),
        };
        productMap.set(article, entry);
      }
      if (site) {
        entry.baseStores.add(site);
        if (isOOS) entry.oosStores.add(site);
      }
    }

    if (site) {
      let s = storeMap.get(site);
      if (!s) {
        s = {
          siteName: String(row["_storeName"] || row["Site Name"] || ""),
          subChannel: String(row["_storeSubChannel"] || row["_storeChannel"] || ""),
          baseSkus: new Set(),
          oosSkus: new Set(),
        };
        storeMap.set(site, s);
      }
      const skuKey = article || String(row["Article Desc"] ?? "");
      if (skuKey) {
        s.baseSkus.add(skuKey);
        if (isOOS) s.oosSkus.add(skuKey);
      }
    }
  }

  const productSummary: OOSProductRow[] = [];
  for (const [article, entry] of productMap) {
    if (entry.oosStores.size === 0) continue; // only include products with OOS
    productSummary.push({
      article,
      vendor: entry.vendor,
      description: entry.description,
      category: entry.category,
      productStatus: entry.productStatus,
      totalStores: entry.baseStores.size,
      oosStores: entry.oosStores.size,
      oosPct: entry.baseStores.size > 0
        ? r2((entry.oosStores.size / entry.baseStores.size) * 100)
        : 0,
    });
  }
  productSummary.sort((a, b) => b.oosPct - a.oosPct);

  const storeSummary: OOSStoreRow[] = [];
  for (const [site, s] of storeMap) {
    storeSummary.push({
      site,
      siteName: s.siteName,
      subChannel: s.subChannel,
      totalSkus: s.baseSkus.size,
      oosSkus: s.oosSkus.size,
      oosPct: s.baseSkus.size > 0
        ? r2((s.oosSkus.size / s.baseSkus.size) * 100)
        : 0,
    });
  }
  storeSummary.sort((a, b) => b.oosPct - a.oosPct);

  return {
    baseCount,
    oosCount,
    oosPct: baseCount > 0 ? r2((oosCount / baseCount) * 100) : 0,
    productSummary,
    storeSummary,
  };
}

// â”€â”€ OOS Detail (granular rows where SOH < 1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface OOSDetailRow {
  subChannel: string;
  province: string;
  category: string;
  subCategory: string;
  article: string;
  vendor: string;
  description: string;
  site: string;
  siteName: string;
  soh: number;
  soo: number;
  sit: number;
  status: string;
  productStatus: string;
  dscAlert: string;
  dateLastSold: string;
  brand: string;
}

export function buildOOSDetail(rows: Row[], dateColumns: string[]): OOSDetailRow[] {
  const detail: OOSDetailRow[] = [];

  for (const row of rows) {
    const { isOOS } = classifyOOS(row, dateColumns);
    if (!isOOS) continue;

    const soh = parseNum(row["SOH"], 0);

    detail.push({
      subChannel: String(row["_storeSubChannel"] || row["_storeChannel"] || ""),
      province: String(row["_province"] || ""),
      vendor: rowVendor(row),
      category: String(row["_category"] || ""),
      subCategory: String(row["_subCategory"] || ""),
      article: String(row["Article"] ?? ""),
      description: String(row["Article Desc"] ?? ""),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      soh: isNaN(soh) ? 0 : soh,
      soo: parseNum(row["SOO"], 0) || 0,
      sit: parseNum(row["SIT"], 0) || 0,
      status: String(row["Status"] ?? row["PR ST"] ?? ""),
      productStatus: String(row["_productStatus"] || ""),
      dscAlert: String(row["_dscAlert"] || ""),
      dateLastSold: String(row["_dateLastSold"] || ""),
      brand: String(row["_brand"] || ""),
    });
  }

  // Sort by Sub-Channel, then Province, then Category, then Site
  detail.sort((a, b) =>
    a.subChannel.localeCompare(b.subChannel) ||
    a.province.localeCompare(b.province) ||
    a.category.localeCompare(b.category) ||
    a.siteName.localeCompare(b.siteName)
  );

  return detail;
}

// â”€â”€ DSC (Days of Stock Cover) distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Act DSC = how many days the current stock-on-hand will last at the recent
// run-rate. The route classifies every row into a bracket (`_dscAlert`) via
// classifyDSC â€” from "Out of Stock" (no cover) through to "ALERT" (overstock,
// â‰¥ the client's alert threshold). These builders aggregate SOH (the stock
// actually sitting in each bracket) plus distinct SKU / site counts, so the
// summary answers "how much of my stock is over-/under-covered, and where".
//
// Universe = the OOS base (SKUÃ—store with stock and/or sales). SOH is summed
// per bracket, so "Out of Stock" naturally contributes ~0 SOH but still carries
// a line/SKU/site count.

const DSC_BLANK = "(unclassified)";

function dscBracketOf(row: Row): string {
  const b = String(row["_dscAlert"] ?? "").trim();
  return b === "" ? DSC_BLANK : b;
}

export interface DscBracketRow {
  bracket: string;
  lines: number;        // SKUÃ—store rows in this bracket
  skus: number;         // distinct articles
  sites: number;        // distinct sites
  soh: number;          // total stock-on-hand sitting in this bracket
  sohPct: number;       // share of total SOH across all brackets
}

// Per-entity (category / SKU / store) row: SOH split across the bracket
// columns, plus distinct counts and a row total.
export interface DscEntityRow {
  name: string;
  skus: number;          // distinct articles in this entity
  sites: number;         // distinct sites in this entity
  totalSoh: number;
  bracketSoh: number[];  // SOH per bracket, aligned to `brackets`
}

export interface DscSummary {
  brackets: string[];        // ordered bracket labels (the column/row set)
  totalSoh: number;
  totalLines: number;
  totalSkus: number;         // distinct articles across the whole base
  totalSites: number;        // distinct sites across the whole base
  overall: DscBracketRow[];
  byCategory: DscEntityRow[];
  bySku: DscEntityRow[];
  byStore: DscEntityRow[];
}

export function buildDscSummary(
  rows: Row[],
  dateColumns: string[],
  bracketOrder: string[],
): DscSummary {
  // Final ordered bracket set: the configured order, plus any stray label that
  // actually appears in the data (defensive â€” never silently drop a bracket).
  const seen = new Set<string>();
  for (const row of rows) {
    if (!classifyOOS(row, dateColumns).inBase) continue;
    seen.add(dscBracketOf(row));
  }
  const brackets = [...bracketOrder.filter((b) => seen.has(b))];
  for (const b of seen) if (!brackets.includes(b)) brackets.push(b);
  const bIdx = new Map(brackets.map((b, i) => [b, i]));

  // Overall accumulators (per bracket)
  const overallAcc = brackets.map(() => ({ lines: 0, soh: 0, skus: new Set<string>(), sites: new Set<string>() }));

  // Entity accumulators: name â†’ { skus, sites, bracketSoh[] }
  type EntAcc = { skus: Set<string>; sites: Set<string>; bracketSoh: number[]; totalSoh: number };
  const mkEnt = (): EntAcc => ({ skus: new Set(), sites: new Set(), bracketSoh: brackets.map(() => 0), totalSoh: 0 });
  const catAcc = new Map<string, EntAcc>();
  const skuAcc = new Map<string, EntAcc>();
  const storeAcc = new Map<string, EntAcc>();

  let totalSoh = 0;
  let totalLines = 0;
  const allSkus = new Set<string>();
  const allSites = new Set<string>();

  for (const row of rows) {
    if (!classifyOOS(row, dateColumns).inBase) continue;
    const bracket = dscBracketOf(row);
    const idx = bIdx.get(bracket);
    if (idx === undefined) continue;

    const sohRaw = parseNum(row["SOH"], 0);
    const soh = isNaN(sohRaw) ? 0 : Math.max(sohRaw, 0);
    const article = String(row["Article"] ?? "").trim();
    const site = String(row["Site"] ?? "").trim();
    const category = String(row["_category"] || "Unknown");
    const skuLabel = `${article || String(row["Article Desc"] ?? "")}`.trim() || "Unknown";
    const skuName = article && row["Article Desc"] ? `${article} â€” ${row["Article Desc"]}` : skuLabel;
    const storeName = String(row["_storeName"] || row["Site Name"] || row["Site"] || "Unknown");

    totalLines++;
    totalSoh += soh;
    if (article) allSkus.add(article);
    if (site) allSites.add(site);

    const oa = overallAcc[idx];
    oa.lines++;
    oa.soh += soh;
    if (article) oa.skus.add(article);
    if (site) oa.sites.add(site);

    const bump = (map: Map<string, EntAcc>, key: string) => {
      let e = map.get(key);
      if (!e) { e = mkEnt(); map.set(key, e); }
      e.bracketSoh[idx] += soh;
      e.totalSoh += soh;
      if (article) e.skus.add(article);
      if (site) e.sites.add(site);
    };
    bump(catAcc, category);
    bump(skuAcc, skuName);
    bump(storeAcc, storeName);
  }

  const overall: DscBracketRow[] = brackets.map((bracket, i) => {
    const a = overallAcc[i];
    return {
      bracket,
      lines: a.lines,
      skus: a.skus.size,
      sites: a.sites.size,
      soh: r2(a.soh),
      sohPct: totalSoh > 0 ? r2((a.soh / totalSoh) * 100) : 0,
    };
  });

  const toEntityRows = (map: Map<string, EntAcc>): DscEntityRow[] =>
    [...map.entries()]
      .map(([name, e]) => ({
        name,
        skus: e.skus.size,
        sites: e.sites.size,
        totalSoh: r2(e.totalSoh),
        bracketSoh: e.bracketSoh.map(r2),
      }))
      .sort((a, b) => b.totalSoh - a.totalSoh);

  return {
    brackets,
    totalSoh: r2(totalSoh),
    totalLines,
    totalSkus: allSkus.size,
    totalSites: allSites.size,
    overall,
    byCategory: toEntityRows(catAcc),
    bySku: toEntityRows(skuAcc),
    byStore: toEntityRows(storeAcc),
  };
}

// â”€â”€ DSC Detail (every in-base SKUÃ—store line, with bracket + Act DSC) â”€â”€
// Sorted by Act DSC descending (overstock first) so the worst cover surfaces;
// the Excel sheet carries an AutoFilter so a viewer can isolate any bracket.

export interface DscDetailRow {
  subChannel: string;
  province: string;
  category: string;
  brand: string;
  article: string;
  vendor: string;
  description: string;
  site: string;
  siteName: string;
  soh: number;
  soo: number;
  sit: number;
  actDsc: number;
  bracket: string;
  dateLastSold: string;
}

export function buildDscDetail(rows: Row[], dateColumns: string[]): DscDetailRow[] {
  const detail: DscDetailRow[] = [];

  for (const row of rows) {
    if (!classifyOOS(row, dateColumns).inBase) continue;
    const soh = parseNum(row["SOH"], 0);
    const actDsc = parseNum(row["Act DSC"], 0);

    detail.push({
      subChannel: String(row["_storeSubChannel"] || row["_storeChannel"] || ""),
      vendor: rowVendor(row),
      province: String(row["_province"] || ""),
      category: String(row["_category"] || ""),
      brand: String(row["_brand"] || ""),
      article: String(row["Article"] ?? ""),
      description: String(row["Article Desc"] ?? ""),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      soh: isNaN(soh) ? 0 : soh,
      soo: parseNum(row["SOO"], 0) || 0,
      sit: parseNum(row["SIT"], 0) || 0,
      actDsc: isNaN(actDsc) ? 0 : actDsc,
      bracket: dscBracketOf(row),
      dateLastSold: String(row["_dateLastSold"] || ""),
    });
  }

  detail.sort((a, b) => b.actDsc - a.actDsc);
  return detail;
}

// â”€â”€ Status (PMF Product Status vs DISPO PR ST) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Classification reuses the Status Reference logic: a scenario match
// (keyed by PR ST + conditions on PMF status / ranging) wins; otherwise
// fall back to the channel-level status definition for that code.

const BLANK = "(blank)";

function prstDisplay(row: Row): string {
  const raw = String(row["Status"] ?? row["PR ST"] ?? "").trim();
  return raw === "" ? BLANK : raw.toUpperCase();
}

function pmfStatusDisplay(row: Row): string {
  const raw = String(row["_productStatus"] ?? "").trim();
  return raw === "" ? BLANK : raw.toUpperCase();
}

export function classifyRowStatus(
  row: Row,
  statusDefs: StatusDefinition[],
  scenarios: StatusScenario[],
): StatusClassification {
  const upper = String(row["Status"] ?? row["PR ST"] ?? "").trim().toUpperCase();
  const scenario = evaluateScenarios(upper, row, scenarios);
  if (scenario !== null) return scenario;
  const def = statusDefs.find((s) => s.code === upper);
  if (def) return def.classification;
  return "UNCLASSIFIED";
}

export interface StatusCountRow {
  prst: string;
  count: number;
  contributionPct: number;
}

export interface StatusPmfRow {
  pmfStatus: string;
  prst: string;
  count: number;
  contributionPct: number;
  classification: StatusClassification | "MIXED";
}

export interface StatusSummary {
  baseCount: number;
  prst: StatusCountRow[];        // Table 1: PR ST breakdown
  prstByPmf: StatusPmfRow[];     // Table 2: PR ST Ã— PMF Product Status
}

export function buildStatusSummary(
  rows: Row[],
  dateColumns: string[],
  statusDefs: StatusDefinition[],
  scenarios: StatusScenario[],
): StatusSummary {
  let baseCount = 0;
  const prstMap = new Map<string, number>();
  const comboMap = new Map<string, { pmf: string; prst: string; count: number; pos: number; neg: number; unc: number }>();

  for (const row of rows) {
    const { inBase } = classifyOOS(row, dateColumns);
    if (!inBase) continue; // same SKUÃ—store base as OOS
    baseCount++;

    const prst = prstDisplay(row);
    prstMap.set(prst, (prstMap.get(prst) ?? 0) + 1);

    const pmf = pmfStatusDisplay(row);
    const cls = classifyRowStatus(row, statusDefs, scenarios);
    const key = `${pmf}|||${prst}`;
    let c = comboMap.get(key);
    if (!c) {
      c = { pmf, prst, count: 0, pos: 0, neg: 0, unc: 0 };
      comboMap.set(key, c);
    }
    c.count++;
    if (cls === "POSITIVE") c.pos++;
    else if (cls === "NEGATIVE") c.neg++;
    else c.unc++;
  }

  const prst: StatusCountRow[] = [];
  for (const [code, count] of prstMap) {
    prst.push({ prst: code, count, contributionPct: baseCount > 0 ? r2((count / baseCount) * 100) : 0 });
  }
  prst.sort((a, b) => b.count - a.count);

  const prstByPmf: StatusPmfRow[] = [];
  for (const c of comboMap.values()) {
    const distinct = [c.pos > 0, c.neg > 0, c.unc > 0].filter(Boolean).length;
    let classification: StatusPmfRow["classification"];
    if (distinct > 1) classification = "MIXED";
    else if (c.neg > 0) classification = "NEGATIVE";
    else if (c.pos > 0) classification = "POSITIVE";
    else classification = "UNCLASSIFIED";
    prstByPmf.push({
      pmfStatus: c.pmf,
      prst: c.prst,
      count: c.count,
      contributionPct: baseCount > 0 ? r2((c.count / baseCount) * 100) : 0,
      classification,
    });
  }
  prstByPmf.sort((a, b) =>
    a.pmfStatus.localeCompare(b.pmfStatus) || b.count - a.count
  );

  return { baseCount, prst, prstByPmf };
}

// â”€â”€ Status Detail (negative SKUÃ—store combinations only) â”€â”€â”€â”€â”€â”€â”€

export interface StatusDetailRow {
  subChannel: string;
  province: string;
  category: string;
  brand: string;
  article: string;
  vendor: string;
  description: string;
  site: string;
  siteName: string;
  prst: string;
  productStatus: string;
  ranging: string;
}

export function buildStatusDetail(
  rows: Row[],
  dateColumns: string[],
  statusDefs: StatusDefinition[],
  scenarios: StatusScenario[],
): StatusDetailRow[] {
  const detail: StatusDetailRow[] = [];

  for (const row of rows) {
    const { inBase } = classifyOOS(row, dateColumns);
    if (!inBase) continue;
    if (classifyRowStatus(row, statusDefs, scenarios) !== "NEGATIVE") continue;

    detail.push({
      vendor: rowVendor(row),
      subChannel: String(row["_storeSubChannel"] || row["_storeChannel"] || ""),
      province: String(row["_province"] || ""),
      category: String(row["_category"] || ""),
      brand: String(row["_brand"] || ""),
      article: String(row["Article"] ?? ""),
      description: String(row["Article Desc"] ?? ""),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      prst: prstDisplay(row),
      productStatus: pmfStatusDisplay(row),
      ranging: row["_rangingStatus"] === true ? "Yes" : "No",
    });
  }

  detail.sort((a, b) =>
    a.subChannel.localeCompare(b.subChannel) ||
    a.province.localeCompare(b.province) ||
    a.category.localeCompare(b.category) ||
    a.siteName.localeCompare(b.siteName)
  );

  return detail;
}

// â”€â”€ Margin Opportunity & Risk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// For each site/SKU with SOH > 0 and valid costs:
//   MAC < Nett Cost â†’ OPPORTUNITY (retailer's cost is below ours; we can
//     drop the shelf price while holding our product margin)
//   MAC > Nett Cost â†’ RISK (retailer's cost is above ours; margin eroded â€”
//     we either pay margin support or supply free stock)
//
// Product Margin (not in DISPO) = ((Incl SP / 1.15) âˆ’ Nett Cost) / (Incl SP / 1.15)

export interface MarginRow {
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  vendor: string;
  productStatus: string;
  prst: string;
  soh: number;
  mac: number;
  nettCost: number;
  inclSP: number;
  prodMargin: number;   // fraction (e.g. 0.29)
  prodMarginFromDispo: boolean;  // true = taken from DISPO "Prod Marg", false = calculated
  stkMargin: number;    // fraction
  macVsNett: number;    // Nett Cost âˆ’ MAC
  marginStatus: "RISK" | "OPPORTUNITY";
  marginSupport: number | null;   // RISK: SOH Ã— (MAC âˆ’ Nett)
  freeStockUnits: number | null;  // RISK: marginSupport / Nett
  suggestedSP: number | null;     // OPPORTUNITY: MAC / (1 âˆ’ prodMargin) Ã— 1.15
}

export interface MarginSummary {
  base: number;             // SOH>0 with valid MAC + Nett Cost
  opportunityCount: number;
  riskCount: number;
  totalMarginSupport: number;
  totalFreeStockUnits: number;
}

export interface MarginAnalysis {
  summary: MarginSummary;
  rows: MarginRow[];
}

// Per-row sales metrics + margins for the flat Data sheet.
// YTD = current year Janâ†’latest month; PY YTD = previous year Janâ†’same month.
// Values use the report's selling-price-ex-VAT convention (LY uses price snapshots).
export interface DataRowExtras {
  ytdUnits: number;
  ytdValue: number;
  pyYtdUnits: number;
  pyYtdValue: number;
  unitsGrowth: number | null;   // fraction
  valueGrowth: number | null;   // fraction
  stkMargin: number;            // fraction
  prodMargin: number | null;    // fraction
}

export function dataRowExtras(row: Row, ctx: DateContext): DataRowExtras {
  const m = getRowMetrics(row, ctx);
  const prodMargin = effectiveProdMargin(row).value;
  return {
    ytdUnits: r2(m.ytdUnits),
    ytdValue: r2(m.ytdValue),
    pyYtdUnits: r2(m.lyYtdUnits),
    pyYtdValue: r2(m.lyYtdValue),
    unitsGrowth: m.lyYtdUnits !== 0 ? (m.ytdUnits - m.lyYtdUnits) / m.lyYtdUnits : null,
    valueGrowth: m.lyYtdValue !== 0 ? (m.ytdValue - m.lyYtdValue) / m.lyYtdValue : null,
    stkMargin: marginFraction(row["Stock Margin"]),
    prodMargin,
  };
}

// DISPO STK Margin may arrive as a fraction (0.47) or percentage points (47).
export function marginFraction(raw: unknown): number {
  const v = parseNum(raw, 0);
  if (isNaN(v)) return 0;
  return Math.abs(v) > 1 ? v / 100 : v;
}

// Product Margin: prefer the DISPO's own "Prod Marg" field (canonical
// "Product Margin") when present; otherwise calculate it from price + cost.
// Returns the fraction + whether it came from the DISPO (so the Excel cell
// can show the raw value vs a live formula).
export function effectiveProdMargin(row: Row): { value: number | null; fromDispo: boolean } {
  const rawNum = parseNum(row["Product Margin"], NaN);
  if (!isNaN(rawNum)) {
    return { value: Math.abs(rawNum) > 1 ? rawNum / 100 : rawNum, fromDispo: true };
  }
  const inclSP = parseNum(row["Incl SP"], 0);
  const inclEx = inclSP > 0 ? inclSP / (1 + VAT_RATE) : 0;
  const nett = parseNum(row["Nett Cost"], NaN);
  const value = inclEx > 0 && !isNaN(nett) ? (inclEx - nett) / inclEx : null;
  return { value, fromDispo: false };
}

export function buildMarginAnalysis(rows: Row[]): MarginAnalysis {
  const out: MarginRow[] = [];
  let base = 0;
  let opportunityCount = 0;
  let riskCount = 0;
  let totalMarginSupport = 0;
  let totalFreeStockUnits = 0;

  for (const row of rows) {
    const soh = parseNum(row["SOH"], 0);
    const mac = parseNum(row["MAC"], NaN);
    const nett = parseNum(row["Nett Cost"], NaN);
    if (isNaN(soh) || soh <= 0) continue;
    if (isNaN(mac) || mac <= 0 || isNaN(nett) || nett <= 0) continue;
    base++;

    let status: "RISK" | "OPPORTUNITY" | null = null;
    if (mac < nett) status = "OPPORTUNITY";
    else if (mac > nett) status = "RISK";
    if (!status) continue; // MAC == Nett â†’ neither

    const inclSP = parseNum(row["Incl SP"], 0);
    const pm = effectiveProdMargin(row);
    const prodMargin = pm.value ?? 0;
    const stkMargin = marginFraction(row["Stock Margin"]);

    let marginSupport: number | null = null;
    let freeStockUnits: number | null = null;
    let suggestedSP: number | null = null;

    if (status === "RISK") {
      marginSupport = soh * (mac - nett);
      freeStockUnits = nett !== 0 ? marginSupport / nett : null;
      riskCount++;
      totalMarginSupport += marginSupport;
      if (freeStockUnits != null) totalFreeStockUnits += freeStockUnits;
    } else {
      suggestedSP = (1 - prodMargin) !== 0 ? (mac / (1 - prodMargin)) * (1 + VAT_RATE) : null;
      opportunityCount++;
    }

    out.push({
      vendor: rowVendor(row),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      productCode: String(row["_clientProductId"] || ""),
      article: String(row["Article"] ?? ""),
      productStatus: String(row["_productStatus"] || ""),
      prst: String(row["Status"] ?? row["PR ST"] ?? ""),
      soh,
      mac,
      nettCost: nett,
      inclSP,
      prodMargin,
      prodMarginFromDispo: pm.fromDispo,
      stkMargin,
      macVsNett: nett - mac,
      marginStatus: status,
      marginSupport: marginSupport === null ? null : r2(marginSupport),
      freeStockUnits: freeStockUnits === null ? null : r2(freeStockUnits),
      suggestedSP: suggestedSP === null ? null : r2(suggestedSP),
    });
  }

  // Risks first (by support desc), then opportunities
  out.sort((a, b) => {
    if (a.marginStatus !== b.marginStatus) return a.marginStatus === "RISK" ? -1 : 1;
    if (a.marginStatus === "RISK") return (b.marginSupport ?? 0) - (a.marginSupport ?? 0);
    return (b.suggestedSP ?? 0) - (a.suggestedSP ?? 0);
  });

  return {
    summary: {
      base,
      opportunityCount,
      riskCount,
      totalMarginSupport: r2(totalMarginSupport),
      totalFreeStockUnits: r2(totalFreeStockUnits),
    },
    rows: out,
  };
}

// â”€â”€ Phantom Stock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// A site/SKU is "phantom" when it shows stock (SOH > 0) but has neither
// sold nor been received recently. "Recently" is two independent thresholds
// (months) chosen in the UI, compared against Last Sold / Last Recv from DISPO.
// A blank/unparseable date is treated as "older than the threshold" (i.e. no
// recent activity) so never-sold dead stock is caught.

function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

export function parseDispoDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") return raw > 1000 && raw < 80000 ? excelSerialToDate(raw) : null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1000 && n < 80000) return excelSerialToDate(n);
  }
  // DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (South African day-first). UTC midnight
  // so the date survives Excel's UTC serialisation without shifting a day.
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    const d = new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1])));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD / YYYY/MM/DD
  m = s.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function minusMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - months);
  return r;
}

export interface PhantomStatusRow {
  pmfStatus: string;
  phantomLines: number;
  totalLines: number;
  phantomPct: number;   // phantom / total for this status
}

export interface PhantomDetailRow {
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  vendor: string;
  prst: string;
  productStatus: string;
  soh: number;
  lastSold: Date | null;
  lastReceived: Date | null;
  lastSoldRaw: string;
  lastReceivedRaw: string;
}

export interface PhantomAnalysis {
  totalLines: number;
  phantomLines: number;
  lastSoldMonths: number | null;
  lastReceivedMonths: number | null;
  byStatus: PhantomStatusRow[];
  detail: PhantomDetailRow[];
}

export function buildPhantomAnalysis(
  rows: Row[],
  opts: { referenceDate: Date; lastSoldMonths: number | null; lastReceivedMonths: number | null },
): PhantomAnalysis {
  const cutoffSold = opts.lastSoldMonths != null ? minusMonths(opts.referenceDate, opts.lastSoldMonths) : null;
  const cutoffRec = opts.lastReceivedMonths != null ? minusMonths(opts.referenceDate, opts.lastReceivedMonths) : null;

  const totalByStatus = new Map<string, number>();
  const phantomByStatus = new Map<string, number>();
  const detail: PhantomDetailRow[] = [];
  let totalLines = 0;
  let phantomLines = 0;

  for (const row of rows) {
    totalLines++;
    const pmf = pmfStatusDisplay(row);
    totalByStatus.set(pmf, (totalByStatus.get(pmf) ?? 0) + 1);

    const soh = parseNum(row["SOH"], 0);
    if (isNaN(soh) || soh <= 0) continue;

    const lastSold = parseDispoDate(row["Last Sold"]);
    const lastRec = parseDispoDate(row["Last Recv"]);

    const soldOld = cutoffSold === null || lastSold === null || lastSold.getTime() <= cutoffSold.getTime();
    const recOld = cutoffRec === null || lastRec === null || lastRec.getTime() <= cutoffRec.getTime();
    if (!soldOld || !recOld) continue;

    phantomLines++;
    phantomByStatus.set(pmf, (phantomByStatus.get(pmf) ?? 0) + 1);
    detail.push({
      vendor: rowVendor(row),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      productCode: String(row["_clientProductId"] || ""),
      article: String(row["Article"] ?? ""),
      prst: prstDisplay(row),
      productStatus: pmf,
      soh,
      lastSold,
      lastReceived: lastRec,
      lastSoldRaw: String(row["Last Sold"] ?? ""),
      lastReceivedRaw: String(row["Last Recv"] ?? ""),
    });
  }

  const byStatus: PhantomStatusRow[] = [];
  for (const [pmf, total] of totalByStatus) {
    const ph = phantomByStatus.get(pmf) ?? 0;
    byStatus.push({ pmfStatus: pmf, phantomLines: ph, totalLines: total, phantomPct: total > 0 ? r2((ph / total) * 100) : 0 });
  }
  byStatus.sort((a, b) => b.phantomLines - a.phantomLines || a.pmfStatus.localeCompare(b.pmfStatus));

  detail.sort((a, b) => a.siteName.localeCompare(b.siteName) || a.prst.localeCompare(b.prst));

  return {
    totalLines,
    phantomLines,
    lastSoldMonths: opts.lastSoldMonths,
    lastReceivedMonths: opts.lastReceivedMonths,
    byStatus,
    detail,
  };
}

// â”€â”€ Numerical Distribution (ND) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// ND measures, of the SKU/site combinations that SHOULD stock a product,
// how many actually showed presence (sales in the rolling window OR any
// stock) over the period.
//   Scenario 1 â€” ranging file: universe = ranging rows where RangeIndicator
//     is TRUE.
//   Scenario 2 â€” no ranging file: universe = active PMF SKUs Ã— active sites,
//     assuming every ACTIVE SKU is ranged in every ACTIVE store.

export interface NDRollupRow {
  name: string;
  expected: number;   // universe count (ranged / active combos)
  present: number;    // combos with ND = 1
  ndPct: number;
}

export interface NDDetailRow {
  subChannel: string;
  province: string;
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  vendor: string;
  description: string;
  prst: string;
  pmfStatus: string;
  ranging: string;    // "TRUE" | "FALSE" | "N/A"
  nd: number;         // 1 | 0
}

export interface NDFalseRow {
  subChannel: string;
  province: string;
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  vendor: string;
  description: string;
  prst: string;
  pmfStatus: string;
  soh: number;
}

export interface NDAnalysis {
  hasRanging: boolean;
  rollingMonths: number;
  windowLabel: string;
  bySubChannel: NDRollupRow[];
  byProvince: NDRollupRow[];
  bySku: NDRollupRow[];
  bySite: NDRollupRow[];
  detail: NDDetailRow[];
  falseDetail: NDFalseRow[];
}

// Resolve a ranging-file field, tolerating Helper/Mandatory prefixes + spacing.
function rangingField(row: Row, targets: string[]): string {
  for (const [k, v] of Object.entries(row)) {
    let nk = k.trim().toLowerCase().replace(/^helper/, "").replace(/^mandatory/, "");
    nk = nk.replace(/[\s_]+/g, "");
    if (targets.includes(nk)) return v == null ? "" : String(v).trim();
  }
  return "";
}

function isTrueRange(v: string): boolean {
  const s = v.trim().toUpperCase();
  return s === "TRUE" || s === "T" || s === "1" || s === "Y" || s === "YES";
}

export function buildNumericalDistribution(opts: {
  rows: Row[];
  dateColumns: string[];
  refYear: number;
  refMonth: number;
  rollingMonths: number;
  hasRanging: boolean;
  rangingRows: Row[];
  stores: StoreRecord[];
  products: Map<string, ProductMaster>;
  channelNames?: string[];   // scope Scenario-2 active sites to the report's channels
}): NDAnalysis {
  const { rows, dateColumns, refYear, refMonth, rollingMonths, hasRanging, rangingRows, stores, products, channelNames } = opts;

  // Rolling window: the N most recent month columns up to the report period.
  const windowCols: string[] = [];
  for (let i = 0; i < rollingMonths; i++) {
    let m = refMonth - i;
    let y = refYear;
    while (m <= 0) { m += 12; y -= 1; }
    const col = `${String(m).padStart(2, "0")}-${y}`;
    if (dateColumns.includes(col)) windowCols.push(col);
  }
  const sortedWin = [...windowCols].sort();
  const windowLabel = sortedWin.length
    ? `${rollingMonths} months (${sortedWin[0]} â€¦ ${sortedWin[sortedWin.length - 1]})`
    : `${rollingMonths} months`;

  // DISPO presence lookup, keyed by site|article and site|cpid.
  interface Presence { present: boolean; prst: string; article: string; soh: number; vendor: string; }
  const bySiteArticle = new Map<string, Presence>();
  const bySiteCpid = new Map<string, Presence>();
  const stockRows: { site: string; article: string; cpid: string; soh: number; prst: string; vendor: string }[] = [];

  /* ND's universe is the ranging file / PMF, not the ledger, so a
     not-distributed combination has no DISPO row to read a vendor off. The
     vendor is a property of the PRODUCT though, so it can be recovered from
     any ledger line for the same article/CPID. */
  const vendorByArticle = new Map<string, string>();
  const vendorByCpid = new Map<string, string>();

  for (const row of rows) {
    const site = String(row["Site"] ?? "").trim().toLowerCase();
    const article = String(row["Article"] ?? "").trim().toLowerCase();
    const cpid = String(row["_clientProductId"] ?? "").trim().toLowerCase();
    if (!site) continue;

    let windowSales = 0;
    for (const col of windowCols) {
      const v = parseNum(row[col], 0);
      if (!isNaN(v)) windowSales += v;
    }
    const soh = parseNum(row["SOH"], 0);
    const soo = parseNum(row["SOO"], 0);
    const sit = parseNum(row["SIT"], 0);
    const hasStock = (soh > 0) || (soo > 0) || (sit > 0);
    const present = windowSales > 0 || hasStock;
    const prst = String(row["Status"] ?? row["PR ST"] ?? "").trim();
    const vendor = rowVendor(row);
    const p: Presence = { present, prst, article, soh: isNaN(soh) ? 0 : soh, vendor };

    if (article) bySiteArticle.set(`${site}|${article}`, p);
    if (cpid) bySiteCpid.set(`${site}|${cpid}`, p);
    if (soh > 0) stockRows.push({ site, article, cpid, soh, prst, vendor });
    if (vendor) {
      if (article && !vendorByArticle.has(article)) vendorByArticle.set(article, vendor);
      if (cpid && !vendorByCpid.has(cpid)) vendorByCpid.set(cpid, vendor);
    }
  }

  // Rollup accumulators
  const mk = () => new Map<string, { expected: number; present: number; label: string }>();
  const subAcc = mk(), provAcc = mk(), skuAcc = mk(), siteAcc = mk();
  const bump = (acc: ReturnType<typeof mk>, key: string, label: string, nd: number) => {
    if (!key) return;
    let e = acc.get(key);
    if (!e) { e = { expected: 0, present: 0, label }; acc.set(key, e); }
    e.expected++;
    e.present += nd;
  };

  const detail: NDDetailRow[] = [];
  const falseDetail: NDFalseRow[] = [];

  if (hasRanging && rangingRows.length > 0) {
    const rangedKeys = new Set<string>();
    for (const rr of rangingRows) {
      const indicator = rangingField(rr, ["rangeindicator", "range"]);
      if (!isTrueRange(indicator)) continue;

      const cpid = rangingField(rr, ["productid"]).toLowerCase();
      const article = rangingField(rr, ["articlechannelcode", "article"]).toLowerCase();
      const site = rangingField(rr, ["sitecode", "site"]).toLowerCase();
      const subCh = rangingField(rr, ["subchannel"]) || "Unknown";
      const prov = rangingField(rr, ["province"]) || "Unknown";
      const siteName = rangingField(rr, ["storename"]);
      const desc = rangingField(rr, ["productdescription", "description"]);
      if (!site || (!article && !cpid)) continue;

      if (article) rangedKeys.add(`${site}|${article}`);
      if (cpid) rangedKeys.add(`${site}|${cpid}`);

      const p = (article && bySiteArticle.get(`${site}|${article}`)) || (cpid && bySiteCpid.get(`${site}|${cpid}`)) || null;
      const nd = p && p.present ? 1 : 0;
      const pmf = products.get(cpid)?.status ?? "";

      detail.push({
        vendor: p?.vendor || vendorByCpid.get(cpid) || vendorByArticle.get(article) || "",
        subChannel: subCh, province: prov, site, siteName,
        productCode: cpid.toUpperCase(), article: (p?.article || article).toUpperCase(),
        description: desc || products.get(cpid)?.description || "",
        prst: p?.prst ?? "", pmfStatus: pmf, ranging: "TRUE", nd,
      });

      bump(subAcc, subCh, subCh, nd);
      bump(provAcc, prov, prov, nd);
      bump(skuAcc, cpid, `${cpid.toUpperCase()} â€” ${desc || products.get(cpid)?.description || ""}`, nd);
      bump(siteAcc, site, `${site.toUpperCase()} â€” ${siteName}`, nd);
    }

    // ND False â€” SOH>0 in combinations that are NOT ranged TRUE
    for (const s of stockRows) {
      const isRanged = (s.article && rangedKeys.has(`${s.site}|${s.article}`)) || (s.cpid && rangedKeys.has(`${s.site}|${s.cpid}`));
      if (isRanged) continue;
      const store = stores.find((st) => st.siteNum.toLowerCase().trim() === s.site);
      const prod = products.get(s.cpid);
      falseDetail.push({
        vendor: s.vendor,
        subChannel: store?.subChannel || "", province: store?.province || "",
        site: s.site.toUpperCase(), siteName: store?.storeName || "",
        productCode: s.cpid.toUpperCase(), article: s.article.toUpperCase(),
        description: prod?.description || "", prst: s.prst, pmfStatus: prod?.status || "", soh: s.soh,
      });
    }
  } else {
    // Scenario 2 â€” active SKU Ã— active site, SCOPED to the report's channels
    // (never the entire store master, which would explode the cartesian).
    const chSet = new Set((channelNames ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean));
    let activeSites = stores.filter((st) => String(st.status ?? "").trim().toUpperCase() === "ACTIVE");
    if (chSet.size) {
      activeSites = activeSites.filter(
        (st) => chSet.has(String(st.subChannel ?? "").trim().toUpperCase()) || chSet.has(String(st.channel ?? "").trim().toUpperCase())
      );
    }
    // Fallback: if nothing matched (channel naming mismatch), scope to sites in the data.
    if (activeSites.length === 0) {
      const dataSites = new Set(rows.map((r) => String(r["Site"] ?? "").trim().toLowerCase()).filter(Boolean));
      activeSites = stores.filter(
        (st) => String(st.status ?? "").trim().toUpperCase() === "ACTIVE" && dataSites.has(String(st.siteNum ?? "").trim().toLowerCase())
      );
    }
    const activeProducts = [...products.values()].filter((p) => String(p.status ?? "").trim().toUpperCase() === "ACTIVE");

    for (const prod of activeProducts) {
      const cpid = String(prod.clientProductId ?? "").toLowerCase().trim();
      if (!cpid) continue;
      for (const st of activeSites) {
        const site = String(st.siteNum ?? "").trim().toLowerCase();
        if (!site) continue;
        const p = bySiteCpid.get(`${site}|${cpid}`) || null;
        const nd = p && p.present ? 1 : 0;
        const subCh = st.subChannel || "Unknown";
        const prov = st.province || "Unknown";

        detail.push({
          vendor: p?.vendor || vendorByCpid.get(cpid) || "",
          subChannel: subCh, province: prov, site: st.siteNum, siteName: st.storeName,
          productCode: prod.clientProductId, article: (p?.article || "").toUpperCase(),
          description: prod.description || "", prst: p?.prst ?? "",
          pmfStatus: prod.status || "", ranging: "N/A", nd,
        });

        bump(subAcc, subCh, subCh, nd);
        bump(provAcc, prov, prov, nd);
        bump(skuAcc, cpid, `${prod.clientProductId} â€” ${prod.description || ""}`, nd);
        bump(siteAcc, site, `${st.siteNum} â€” ${st.storeName}`, nd);
      }
    }
  }

  const toRollup = (acc: ReturnType<typeof mk>): NDRollupRow[] =>
    [...acc.values()]
      .map((e) => ({ name: e.label, expected: e.expected, present: e.present, ndPct: e.expected > 0 ? r2((e.present / e.expected) * 100) : 0 }))
      .sort((a, b) => a.ndPct - b.ndPct || b.expected - a.expected);

  detail.sort((a, b) => a.subChannel.localeCompare(b.subChannel) || a.siteName.localeCompare(b.siteName) || a.description.localeCompare(b.description));
  falseDetail.sort((a, b) => a.subChannel.localeCompare(b.subChannel) || a.siteName.localeCompare(b.siteName));

  return {
    hasRanging: hasRanging && rangingRows.length > 0,
    rollingMonths,
    windowLabel,
    bySubChannel: toRollup(subAcc),
    byProvince: toRollup(provAcc),
    bySku: toRollup(skuAcc),
    bySite: toRollup(siteAcc),
    detail,
    falseDetail,
  };
}

// â”€â”€ Open to Order (OTO) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Suggested replenishment for SKU/site lines that are out of stock AND
// orderable. A line qualifies only when SOH = 0, nothing is on order or in
// transit (SOO = SIT = 0), the DISPO status classifies POSITIVE, and the PMF
// product status is ACTIVE. OTO Units = category multiplier Ã— R. Profile;
// OTO Value = OTO Units Ã— Nett Cost. (Logic shared with the Vital Signs report
// via calcOpenToOrder.) Because every qualifying line meets the same
// conditions, the detail sheet omits SOH/SOO/SIT/Status columns.

export interface OTOSummaryRow {
  name: string;
  lines: number;
  units: number;
  value: number;
  contributionPct: number; // share of total OTO value within its table
}

export interface OTODetailRow {
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  vendor: string;
  rangeIndicator: string; // "TRUE" | "FALSE" | "N/A" (when no ranging file)
  description: string;
  units: number;
  value: number;
}

export interface OTOAnalysis {
  hasRanging: boolean;
  totalLines: number;
  totalUnits: number;
  totalValue: number;
  bySubChannel: OTOSummaryRow[];
  byCategory: OTOSummaryRow[];
  bySku: OTOSummaryRow[];
  bySite: OTOSummaryRow[];
  detail: OTODetailRow[];
}

export function buildOpenToOrder(opts: {
  rows: Row[];
  statusDefs: StatusDefinition[];
  statusScenarios: StatusScenario[];
  otoMultipliers: Record<string, number>;
  hasRanging: boolean;
  rangingRows: Row[];
}): OTOAnalysis {
  const { rows, statusDefs, statusScenarios, otoMultipliers, hasRanging, rangingRows } = opts;

  // Ranged set (site|article and site|cpid) â€” only used to label the detail
  // rows' Range Indicator when a ranging file exists.
  const rangedKeys = new Set<string>();
  if (hasRanging) {
    for (const rr of rangingRows) {
      if (!isTrueRange(rangingField(rr, ["rangeindicator", "range"]))) continue;
      const cpid = rangingField(rr, ["productid"]).toLowerCase();
      const article = rangingField(rr, ["articlechannelcode", "article"]).toLowerCase();
      const site = rangingField(rr, ["sitecode", "site"]).toLowerCase();
      if (!site) continue;
      if (article) rangedKeys.add(`${site}|${article}`);
      if (cpid) rangedKeys.add(`${site}|${cpid}`);
    }
  }

  const detail: OTODetailRow[] = [];
  const mk = () => new Map<string, { units: number; value: number; lines: number; label: string }>();
  const subAcc = mk(), catAcc = mk(), skuAcc = mk(), siteAcc = mk();
  const bump = (acc: ReturnType<typeof mk>, key: string, label: string, units: number, value: number) => {
    if (!key) return;
    let e = acc.get(key);
    if (!e) { e = { units: 0, value: 0, lines: 0, label }; acc.set(key, e); }
    e.units += units; e.value += value; e.lines++;
  };

  let totalUnits = 0, totalValue = 0;

  for (const row of rows) {
    const category = String(row["_category"] ?? "").trim().toLowerCase();
    const multiplier = (category && otoMultipliers[category]) || 1;
    const { oto, otoValue } = calcOpenToOrder(row, statusDefs, multiplier, statusScenarios);
    if (oto <= 0) continue; // only qualifying lines with a positive suggested order

    const site = String(row["Site"] ?? "").trim();
    const article = String(row["Article"] ?? "").trim();
    const cpid = String(row["_clientProductId"] ?? "").trim();
    const siteKey = site.toLowerCase(), artKey = article.toLowerCase(), cpidKey = cpid.toLowerCase();

    const rangeIndicator = !hasRanging
      ? "N/A"
      : (artKey && rangedKeys.has(`${siteKey}|${artKey}`)) || (cpidKey && rangedKeys.has(`${siteKey}|${cpidKey}`))
        ? "TRUE"
        : "FALSE";

    const subCh = String(row["_storeSubChannel"] || row["_storeChannel"] || "Unknown");
    const catName = String(row["_category"] || "Unknown");
    const siteName = String(row["_storeName"] || "");
    const desc = String(row["_productDescription"] || row["Article Desc"] || "");

    detail.push({ vendor: rowVendor(row), site, siteName, productCode: cpid, article, rangeIndicator, description: desc, units: oto, value: otoValue });

    bump(subAcc, subCh, subCh, oto, otoValue);
    bump(catAcc, catName, catName, oto, otoValue);
    bump(skuAcc, cpidKey || artKey, `${cpid || article}${desc ? ` â€” ${desc}` : ""}`, oto, otoValue);
    bump(siteAcc, siteKey, `${site}${siteName ? ` â€” ${siteName}` : ""}`, oto, otoValue);

    totalUnits += oto;
    totalValue += otoValue;
  }

  const toRows = (acc: ReturnType<typeof mk>): OTOSummaryRow[] => {
    const total = [...acc.values()].reduce((s, e) => s + e.value, 0);
    return [...acc.values()]
      .map((e) => ({
        name: e.label,
        lines: e.lines,
        units: r2(e.units),
        value: r2(e.value),
        contributionPct: total > 0 ? r2((e.value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  };

  detail.sort((a, b) => b.value - a.value);

  return {
    hasRanging,
    totalLines: detail.length,
    totalUnits: r2(totalUnits),
    totalValue: r2(totalValue),
    bySubChannel: toRows(subAcc),
    byCategory: toRows(catAcc),
    bySku: toRows(skuAcc),
    bySite: toRows(siteAcc),
    detail,
  };
}

// â”€â”€ Charts summary (web dashboard) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Aggregates the headline metrics + time series for the in-app Charts page.
// Opportunity values are all in Rands at Nett Cost (the user's definition):
//   OTO       â€” total OTO Value (suggested replenishment for orderable OOS).
//   ND        â€” 1 unit Ã— Nett Cost for every active SKU/site combo NOT
//               distributed (ND = 0); uses the ranging universe when present.
//   OOS       â€” OTO-default order (category multiplier Ã— R. Profile) Ã— Nett
//               Cost for every out-of-stock line.
//   Phantom   â€” OTO-default order Ã— Nett Cost for every phantom line with
//               SOH < 5 (treated as written off and reordered).

const MON_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ChartsDimSeries {
  months: string[]; // x-axis labels, e.g. "Jan26"
  series: { name: string; values: number[] }[];
}

export interface ChartsData {
  cards: {
    unitSalesMonth: number;
    unitSalesYtd: number;
    valueSalesMonth: number;
    valueSalesYtd: number;
    growthYtdPct: number | null;
    growthSameMonthLyPct: number | null;
  };
  opportunity: { oto: number; nd: number; oos: number; phantom: number; total: number };
  risk: { marginSupport: number };
  cyLabel: string;
  pyLabel: string;
  monthlyBars: { month: string; cyValue: number; pyValue: number; cyVolume: number; pyVolume: number }[];
  subChannelSeries: ChartsDimSeries; // rolling 24 months, value
  categorySeries: ChartsDimSeries;   // rolling 24 months, value
}

// Price for a row's units in a given calendar year â€” uses that year's price
// snapshot if captured, else the current effective selling price ex-VAT.
function priceForYear(row: Row, year: number, basePrice: number): number {
  return effectivePriceExVat(row, `_inclSP_${year}`, `_promSP_${year}`) || basePrice;
}

function rollingMonths(endYear: number, endMonth: number, count: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let m = endMonth - i, y = endYear;
    while (m <= 0) { m += 12; y -= 1; }
    out.push({ key: `${String(m).padStart(2, "0")}-${y}`, label: `${MON_ABBR[m]}${String(y).slice(-2)}` });
  }
  return out;
}

// Value-by-month for one dimension, across the rolling window.
function dimensionSeries(
  rows: Row[],
  months: { key: string; label: string }[],
  accessor: (row: Row) => string,
): ChartsDimSeries {
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const byDim = new Map<string, number[]>();
  for (const row of rows) {
    const base = effectivePriceExVat(row);
    const name = accessor(row) || "Unknown";
    let arr = byDim.get(name);
    if (!arr) { arr = new Array(months.length).fill(0); byDim.set(name, arr); }
    for (const m of months) {
      const units = Number(row[m.key]);
      if (isNaN(units) || units === 0) continue;
      const year = Number(m.key.split("-")[1]);
      arr[idx.get(m.key)!] += units * priceForYear(row, year, base);
    }
  }
  const series = [...byDim.entries()]
    .map(([name, values]) => ({ name, values: values.map(r2), total: values.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total)
    .map(({ name, values }) => ({ name, values }));
  return { months: months.map((m) => m.label), series };
}

export function buildChartsData(opts: {
  rows: Row[];
  dateColumns: string[];
  ctx: DateContext;
  salesSummary: SalesSummaryLevel[];
  otoTotalValue: number;
  marginSupport: number;
  ndDetail: NDDetailRow[];
  otoMultipliers: Record<string, number>;
  referenceDate: Date;
  phLastSold: number | null;
  phLastReceived: number | null;
}): ChartsData {
  const { rows, dateColumns, ctx, salesSummary, otoTotalValue, marginSupport, ndDetail, otoMultipliers, referenceDate, phLastSold, phLastReceived } = opts;

  // â”€â”€ Sales cards (value growth) â€” from the grand-total summary row â”€â”€
  const top = salesSummary[0];
  const vol = top?.volumeTotal;
  const val = top?.valueTotal;
  const cards = {
    unitSalesMonth: vol?.currentMonth ?? 0,
    unitSalesYtd: vol?.ytd ?? 0,
    valueSalesMonth: val?.currentMonth ?? 0,
    valueSalesYtd: val?.ytd ?? 0,
    growthYtdPct: val?.growthYtdPct ?? null,
    growthSameMonthLyPct: val?.growthVsPymPct ?? null,
  };

  // â”€â”€ Opportunity: OOS + Phantom (row scan) + Nett-cost lookup for ND â”€â”€
  const cutoffSold = phLastSold != null ? minusMonths(referenceDate, phLastSold) : null;
  const cutoffRec = phLastReceived != null ? minusMonths(referenceDate, phLastReceived) : null;
  const nettByCpid = new Map<string, number>();
  const nettByArticle = new Map<string, number>();
  let oosOpp = 0, phantomOpp = 0;

  for (const row of rows) {
    const nett = parseNum(row["Nett Cost"], 0);
    const ncost = isNaN(nett) ? 0 : nett;
    const cpid = String(row["_clientProductId"] ?? "").toLowerCase().trim();
    const article = String(row["Article"] ?? "").toLowerCase().trim();
    if (ncost > 0) {
      if (cpid && !nettByCpid.has(cpid)) nettByCpid.set(cpid, ncost);
      if (article && !nettByArticle.has(article)) nettByArticle.set(article, ncost);
    }

    const category = String(row["_category"] ?? "").toLowerCase().trim();
    const mult = (category && otoMultipliers[category]) || 1;
    const rp = parseNum(row["R. Profile"], 0);
    const otoUnits = mult * (isNaN(rp) ? 0 : rp);
    if (otoUnits <= 0 || ncost <= 0) continue;

    // OOS opportunity â€” order the OTO default for every out-of-stock line
    if (classifyOOS(row, dateColumns).isOOS) oosOpp += otoUnits * ncost;

    // Phantom opportunity â€” phantom line (SOH > 0, stale sale + receipt) with SOH < 5
    const soh = parseNum(row["SOH"], 0);
    if (!isNaN(soh) && soh > 0 && soh < 5) {
      const lastSold = parseDispoDate(row["Last Sold"]);
      const lastRec = parseDispoDate(row["Last Recv"]);
      const soldOld = cutoffSold === null || lastSold === null || lastSold.getTime() <= cutoffSold.getTime();
      const recOld = cutoffRec === null || lastRec === null || lastRec.getTime() <= cutoffRec.getTime();
      if (soldOld && recOld) phantomOpp += otoUnits * ncost;
    }
  }

  // ND opportunity â€” 1 unit Ã— Nett Cost for each not-distributed combo (ND = 0)
  let ndOpp = 0;
  for (const d of ndDetail) {
    if (d.nd !== 0) continue;
    const nc = nettByCpid.get(String(d.productCode ?? "").toLowerCase()) ??
      nettByArticle.get(String(d.article ?? "").toLowerCase()) ?? 0;
    ndOpp += nc;
  }

  const oto = r2(otoTotalValue);
  const nd = r2(ndOpp);
  const oos = r2(oosOpp);
  const phantom = r2(phantomOpp);
  const opportunity = { oto, nd, oos, phantom, total: r2(oto + nd + oos + phantom) };

  // â”€â”€ Monthly bars: CY vs PY, value + volume â”€â”€
  const maxYear = ctx.maxYear, pyYear = maxYear - 1;
  const monthlyBars: ChartsData["monthlyBars"] = [];
  for (let m = 1; m <= 12; m++) {
    const cyCol = `${String(m).padStart(2, "0")}-${maxYear}`;
    const pyCol = `${String(m).padStart(2, "0")}-${pyYear}`;
    const hasCy = dateColumns.includes(cyCol), hasPy = dateColumns.includes(pyCol);
    if (!hasCy && !hasPy) continue;
    let cyVol = 0, pyVol = 0, cyVal = 0, pyVal = 0;
    for (const row of rows) {
      const base = effectivePriceExVat(row);
      if (hasCy) { const u = Number(row[cyCol]) || 0; cyVol += u; cyVal += u * base; }
      if (hasPy) { const u = Number(row[pyCol]) || 0; pyVol += u; pyVal += u * priceForYear(row, pyYear, base); }
    }
    monthlyBars.push({ month: MON_ABBR[m], cyValue: r2(cyVal), pyValue: r2(pyVal), cyVolume: r2(cyVol), pyVolume: r2(pyVol) });
  }

  // â”€â”€ Rolling 24-month line series by sub-channel + category (value) â”€â”€
  const window = rollingMonths(maxYear, ctx.maxMonth || 12, 24);
  const subChannelSeries = dimensionSeries(rows, window, (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || ""));
  const categorySeries = dimensionSeries(rows, window, (r) => String(r["_category"] || ""));

  return {
    cards,
    opportunity,
    risk: { marginSupport: r2(marginSupport) },
    cyLabel: String(maxYear),
    pyLabel: String(pyYear),
    monthlyBars,
    subChannelSeries,
    categorySeries,
  };
}
