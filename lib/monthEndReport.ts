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

interface DateContext {
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
  mode: "volume" | "value"
): SummaryRow[] {
  const groups = new Map<string, { metrics: RowMetrics; stores: Set<string> }>();

  for (const row of rows) {
    const key = groupKey(row);
    const m = getRowMetrics(row, ctx);
    const site = String(row["Site"] ?? "").trim();

    let group = groups.get(key);
    if (!group) {
      group = {
        metrics: { ytdUnits: 0, ytdValue: 0, lyYtdUnits: 0, lyYtdValue: 0, currentMonthUnits: 0, currentMonthValue: 0, sameMonthLyUnits: 0, sameMonthLyValue: 0, lastMonthUnits: 0, lastMonthValue: 0 },
        stores: new Set(),
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
  }

  const result: SummaryRow[] = [];

  for (const [name, { metrics, stores }] of groups) {
    const ytd = mode === "volume" ? metrics.ytdUnits : metrics.ytdValue;
    const lyYtd = mode === "volume" ? metrics.lyYtdUnits : metrics.lyYtdValue;
    const cm = mode === "volume" ? metrics.currentMonthUnits : metrics.currentMonthValue;
    const smly = mode === "volume" ? metrics.sameMonthLyUnits : metrics.sameMonthLyValue;
    const lm = mode === "volume" ? metrics.lastMonthUnits : metrics.lastMonthValue;

    result.push({
      name,
      storeCount: stores.size,
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

function computeGrandTotal(summaryRows: SummaryRow[]): SummaryRow {
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
    totals.storeCount += row.storeCount; // approximate — groups may share stores
  }

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

  const levels: SalesSummaryLevel[] = [];

  // Level 1: Sub-Channel
  const subChVolume = aggregateRows(rows, ctx, (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || "Unknown"), grandYtdUnits, "volume");
  const subChValue = aggregateRows(rows, ctx, (r) => String(r["_storeSubChannel"] || r["_storeChannel"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Sub-Channel",
    volumeRows: subChVolume,
    volumeTotal: computeGrandTotal(subChVolume),
    valueRows: subChValue,
    valueTotal: computeGrandTotal(subChValue),
  });

  // Level 2: Province
  const provVolume = aggregateRows(rows, ctx, (r) => String(r["_province"] || "Unknown"), grandYtdUnits, "volume");
  const provValue = aggregateRows(rows, ctx, (r) => String(r["_province"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Province",
    volumeRows: provVolume,
    volumeTotal: computeGrandTotal(provVolume),
    valueRows: provValue,
    valueTotal: computeGrandTotal(provValue),
  });

  // Level 3: Category
  const catVolume = aggregateRows(rows, ctx, (r) => String(r["_category"] || "Unknown"), grandYtdUnits, "volume");
  const catValue = aggregateRows(rows, ctx, (r) => String(r["_category"] || "Unknown"), grandYtdValue, "value");
  levels.push({
    level: "Category",
    volumeRows: catVolume,
    volumeTotal: computeGrandTotal(catVolume),
    valueRows: catValue,
    valueTotal: computeGrandTotal(catValue),
  });

  // Level 4: Store
  const storeVolume = aggregateRows(rows, ctx, (r) => String(r["_storeName"] || r["Site Name"] || r["Site"] || "Unknown"), grandYtdUnits, "volume");
  const storeValue = aggregateRows(rows, ctx, (r) => String(r["_storeName"] || r["Site Name"] || r["Site"] || "Unknown"), grandYtdValue, "value");
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
    volumeTotal: computeGrandTotal(prodVolume),
    valueRows: prodValue,
    valueTotal: computeGrandTotal(prodValue),
  });

  return levels;
}

// ── OOS Summary ────────────────────────────────────────────────

export interface OOSSummary {
  baseCount: number;       // total rows
  oosCount: number;        // rows where SOH < 1
  oosPct: number;
  productSummary: OOSProductRow[];
}

export interface OOSProductRow {
  article: string;
  description: string;
  category: string;
  totalStores: number;
  oosStores: number;
  oosPct: number;
}

export function buildOOSSummary(rows: Row[]): OOSSummary {
  const baseCount = rows.length;
  let oosCount = 0;

  // Per-product: total stores + OOS stores
  const productMap = new Map<string, {
    description: string;
    category: string;
    totalStores: Set<string>;
    oosStores: Set<string>;
  }>();

  for (const row of rows) {
    const soh = Number(row["SOH"] ?? 0);
    const isOOS = !isNaN(soh) && soh < 1;
    if (isOOS) oosCount++;

    const article = String(row["Article"] ?? "").trim();
    if (!article) continue;

    let entry = productMap.get(article);
    if (!entry) {
      entry = {
        description: String(row["Article Desc"] ?? ""),
        category: String(row["_category"] ?? ""),
        totalStores: new Set(),
        oosStores: new Set(),
      };
      productMap.set(article, entry);
    }

    const site = String(row["Site"] ?? "").trim();
    if (site) {
      entry.totalStores.add(site);
      if (isOOS) entry.oosStores.add(site);
    }
  }

  const productSummary: OOSProductRow[] = [];
  for (const [article, entry] of productMap) {
    if (entry.oosStores.size === 0) continue; // only include products with OOS
    productSummary.push({
      article,
      description: entry.description,
      category: entry.category,
      totalStores: entry.totalStores.size,
      oosStores: entry.oosStores.size,
      oosPct: entry.totalStores.size > 0
        ? r2((entry.oosStores.size / entry.totalStores.size) * 100)
        : 0,
    });
  }

  // Sort by OOS % descending
  productSummary.sort((a, b) => b.oosPct - a.oosPct);

  return {
    baseCount,
    oosCount,
    oosPct: baseCount > 0 ? r2((oosCount / baseCount) * 100) : 0,
    productSummary,
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
  dscAlert: string;
  dateLastSold: string;
  brand: string;
}

export function buildOOSDetail(rows: Row[]): OOSDetailRow[] {
  const detail: OOSDetailRow[] = [];

  for (const row of rows) {
    const soh = Number(row["SOH"] ?? 0);
    if (isNaN(soh) || soh >= 1) continue;

    detail.push({
      subChannel: String(row["_storeSubChannel"] || row["_storeChannel"] || ""),
      province: String(row["_province"] || ""),
      category: String(row["_category"] || ""),
      subCategory: String(row["_subCategory"] || ""),
      article: String(row["Article"] ?? ""),
      description: String(row["Article Desc"] ?? ""),
      site: String(row["Site"] ?? ""),
      siteName: String(row["_storeName"] || row["Site Name"] || ""),
      soh,
      soo: Number(row["SOO"] ?? 0),
      sit: Number(row["SIT"] ?? 0),
      status: String(row["Status"] ?? row["PR ST"] ?? ""),
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
