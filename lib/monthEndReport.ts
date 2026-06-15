/* ──────────────────────────────────────────────────────────────
   Month-End Report — aggregation & computation engine

   Takes enriched ledger rows, groups and aggregates them into
   cascading summary tables at multiple levels:
     Sub-Channel → Province → Category → Store → Product

   Each level has Volume + Value variants with columns:
     Entity, # Stores, YTD, LY YTD, Current Month, Same Month LY,
     Last Month, Growth YTD %, Growth vs LM %, Growth vs PYM %,
     Contribution %

   Also computes OOS summary + detail data.
   ────────────────────────────────────────────────────────────── */

import type { StatusDefinition, StatusScenario, StatusClassification } from "./types";
import { evaluateScenarios } from "./statusScenarioData";

type Row = Record<string, unknown>;

const VAT_RATE = 0.15;
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

// ── Date column classification ─────────────────────────────────

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

// ── Row-level value extraction ─────────────────────────────────

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

// ── Aggregated summary row ─────────────────────────────────────

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

// ── Grand total row ────────────────────────────────────────────

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

// ── Full Sales Summary (cascading levels) ──────────────────────

export interface SalesSummaryLevel {
  level: string;          // "Sub-Channel", "Province", "Category", "Store", "Product"
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

  // True unique store count across the whole dataset — used for the grand
  // total of every "stores" mode level (a store can sit in many Category /
  // Product groups, so summing per-group counts would over-count).
  const storeSet = new Set<string>();
  for (const row of rows) {
    const s = String(row["Site"] ?? "").trim();
    if (s) storeSet.add(s);
  }
  const tStores = storeSet.size;

  const levels: SalesSummaryLevel[] = [];

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

  // Level 4: Store — count is "Number of SKUs" (SKU instances with sales
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

// ── OOS Summary ────────────────────────────────────────────────

export interface OOSSummary {
  baseCount: number;       // SKU×store rows with stock and/or sales (the base)
  oosCount: number;        // base rows where SOH <= 0
  oosPct: number;
  productSummary: OOSProductRow[];
  storeSummary: OOSStoreRow[];
}

export interface OOSProductRow {
  article: string;
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

// Parse a possibly string/blank numeric cell. Blank → blankAs; non-numeric → NaN.
function parseNum(v: unknown, blankAs: number): number {
  if (typeof v === "number") return v;
  if (v == null) return blankAs;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return blankAs;
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

// A SKU×store is "in base" if it has stock on hand and/or any sales (across the
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

// ── OOS Detail (granular rows where SOH < 1) ──────────────────

export interface OOSDetailRow {
  subChannel: string;
  province: string;
  category: string;
  subCategory: string;
  article: string;
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

// ── Status (PMF Product Status vs DISPO PR ST) ─────────────────
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
  prstByPmf: StatusPmfRow[];     // Table 2: PR ST × PMF Product Status
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
    if (!inBase) continue; // same SKU×store base as OOS
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

// ── Status Detail (negative SKU×store combinations only) ───────

export interface StatusDetailRow {
  subChannel: string;
  province: string;
  category: string;
  brand: string;
  article: string;
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

// ── Margin Opportunity & Risk ──────────────────────────────────
//
// For each site/SKU with SOH > 0 and valid costs:
//   MAC < Nett Cost → OPPORTUNITY (retailer's cost is below ours; we can
//     drop the shelf price while holding our product margin)
//   MAC > Nett Cost → RISK (retailer's cost is above ours; margin eroded —
//     we either pay margin support or supply free stock)
//
// Product Margin (not in DISPO) = ((Incl SP / 1.15) − Nett Cost) / (Incl SP / 1.15)

export interface MarginRow {
  site: string;
  siteName: string;
  productCode: string;
  article: string;
  productStatus: string;
  prst: string;
  soh: number;
  mac: number;
  nettCost: number;
  inclSP: number;
  prodMargin: number;   // fraction (e.g. 0.29)
  prodMarginFromDispo: boolean;  // true = taken from DISPO "Prod Marg", false = calculated
  stkMargin: number;    // fraction
  macVsNett: number;    // Nett Cost − MAC
  marginStatus: "RISK" | "OPPORTUNITY";
  marginSupport: number | null;   // RISK: SOH × (MAC − Nett)
  freeStockUnits: number | null;  // RISK: marginSupport / Nett
  suggestedSP: number | null;     // OPPORTUNITY: MAC / (1 − prodMargin) × 1.15
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
// YTD = current year Jan→latest month; PY YTD = previous year Jan→same month.
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
function marginFraction(raw: unknown): number {
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
    if (!status) continue; // MAC == Nett → neither

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

// ── Phantom Stock ──────────────────────────────────────────────
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
