/* ──────────────────────────────────────────────────────────────
   Vital Signs Report — pure computation engine

   Takes enriched ledger rows + config, returns rows with computed
   columns appended: DSC Alert, Date Last Sold, Site Ranking,
   Open to Order, OTO Value, Num of Site, Num of SKU, etc.

   Column order matches the client example report.
   ────────────────────────────────────────────────────────────── */

import { classifyDSC, type DSCBrackets } from "./reportConfig";
import type { StatusDefinition } from "./types";

type Row = Record<string, unknown>;

export interface VitalSignsRow extends Record<string, unknown> {}

// ── Date column helpers ───────────────────────────────────────

const DATE_RE = /^(\d{2})-(\d{4})$/; // MM-YYYY

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseDateKey(col: string): { month: number; year: number } | null {
  const m = col.match(DATE_RE);
  if (!m) return null;
  return { month: parseInt(m[1], 10), year: parseInt(m[2], 10) };
}

function sortDateKeysAsc(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const pa = parseDateKey(a);
    const pb = parseDateKey(b);
    if (!pa || !pb) return 0;
    return (pa.year * 100 + pa.month) - (pb.year * 100 + pb.month);
  });
}

function sortDateKeysDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const pa = parseDateKey(a);
    const pb = parseDateKey(b);
    if (!pa || !pb) return 0;
    return (pb.year * 100 + pb.month) - (pa.year * 100 + pa.month);
  });
}

// ── Date Last Sold ────────────────────────────────────────────

export function calcMonthLastSold(
  row: Row,
  dateColumns: string[]
): string {
  const sorted = sortDateKeysDesc(dateColumns);
  for (const col of sorted) {
    const val = row[col];
    if (val !== undefined && val !== null && val !== "" && val !== 0 && val !== "0") {
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        // Return as friendly label e.g. "May-2026"
        const p = parseDateKey(col);
        if (p) return `${MONTH_NAMES[p.month]}-${p.year}`;
        return col;
      }
    }
  }
  return "";
}

// ── Site Rankings (A/B/C) ─────────────────────────────────────

export function calcSiteRankings(
  rows: Row[],
  dateColumns: string[]
): Map<string, "A" | "B" | "C"> {
  const siteTotals = new Map<string, number>();

  for (const row of rows) {
    const site = String(row["Site"] ?? "").trim();
    if (!site) continue;

    let total = siteTotals.get(site) ?? 0;
    for (const col of dateColumns) {
      const val = Number(row[col]);
      if (!isNaN(val)) total += val;
    }
    siteTotals.set(site, total);
  }

  const sorted = Array.from(siteTotals.entries()).sort((a, b) => b[1] - a[1]);
  const count = sorted.length;
  if (count === 0) return new Map();

  const third = Math.ceil(count / 3);
  const rankings = new Map<string, "A" | "B" | "C">();

  for (let i = 0; i < sorted.length; i++) {
    const [site] = sorted[i];
    if (i < third) rankings.set(site, "A");
    else if (i < third * 2) rankings.set(site, "B");
    else rankings.set(site, "C");
  }

  return rankings;
}

// ── Article Rank by Units ─────────────────────────────────────

export function calcArticleRankings(
  rows: Row[],
  dateColumns: string[]
): Map<string, number> {
  const articleTotals = new Map<string, number>();

  for (const row of rows) {
    const article = String(row["Article"] ?? "").trim();
    if (!article) continue;

    let total = articleTotals.get(article) ?? 0;
    for (const col of dateColumns) {
      const val = Number(row[col]);
      if (!isNaN(val)) total += val;
    }
    articleTotals.set(article, total);
  }

  // Sort descending, assign rank
  const sorted = Array.from(articleTotals.entries()).sort((a, b) => b[1] - a[1]);
  const rankings = new Map<string, number>();
  sorted.forEach(([article], idx) => rankings.set(article, idx + 1));

  return rankings;
}

// ── Open to Order ─────────────────────────────────────────────

export function calcOpenToOrder(
  row: Row,
  statusDefs: StatusDefinition[],
  categoryMultiplier: number
): { oto: 0 | 1; otoValue: number } {
  const soh = Number(row["SOH"] ?? 0);
  if (soh > 0) return { oto: 0, otoValue: 0 };

  const statusRaw = String(row["Status"] ?? "").trim();
  if (statusRaw !== "" && statusRaw !== "0") {
    const statusUpper = statusRaw.toUpperCase();
    const def = statusDefs.find((s) => s.code === statusUpper);
    if (def && def.classification !== "POSITIVE") return { oto: 0, otoValue: 0 };
    if (!def) return { oto: 0, otoValue: 0 };
  }

  const soo = Number(row["SOO"] ?? 0);
  const sit = Number(row["SIT"] ?? 0);
  if (soo + sit !== 0) return { oto: 0, otoValue: 0 };

  const productStatus = String(row["_productStatus"] ?? "").trim().toUpperCase();
  if (productStatus !== "ACTIVE") return { oto: 0, otoValue: 0 };

  const rp = Number(row["RP"] ?? 0);
  return { oto: 1, otoValue: categoryMultiplier * rp };
}

// ── Column output builder ─────────────────────────────────────

/**
 * Build monthly column pairs (Units + Value) for each date column.
 * Returns: { outputCols, dateMap } where dateMap maps raw date col
 * to { unitsCol, valueCol } for header + data building.
 */
function buildMonthlyColumns(dateColumns: string[]): {
  outputCols: string[];
  dateMap: Map<string, { unitsCol: string; valueCol: string }>;
} {
  const sorted = sortDateKeysAsc(dateColumns);
  const outputCols: string[] = [];
  const dateMap = new Map<string, { unitsCol: string; valueCol: string }>();

  // Determine if the first month is from a previous year (for labeling)
  const firstParsed = sorted.length > 0 ? parseDateKey(sorted[0]) : null;
  const lastParsed = sorted.length > 0 ? parseDateKey(sorted[sorted.length - 1]) : null;

  for (let i = 0; i < sorted.length; i++) {
    const col = sorted[i];
    const p = parseDateKey(col);
    if (!p) continue;

    const monName = MONTH_NAMES[p.month];
    const isPrevYear = firstParsed && lastParsed && p.year < lastParsed.year && i === 0;

    const unitsCol = isPrevYear
      ? `${monName} Units (Prev. Year)`
      : `${monName} Units`;
    const valueCol = isPrevYear
      ? `${monName} Value (Prev. Year)`
      : `${monName} Value`;

    outputCols.push(unitsCol, valueCol);
    dateMap.set(col, { unitsCol, valueCol });
  }

  return { outputCols, dateMap };
}

/**
 * Returns the ordered list of output column headers for the Vital Signs Excel.
 * Matches the example report column order.
 */
export function getVitalSignsColumnOrder(dateColumns: string[]): string[] {
  const { outputCols } = buildMonthlyColumns(dateColumns);

  return [
    // Pre-data columns
    "Vendor",
    "Channel",
    "Cat Name",
    "Sub Cat Name",
    "Article",
    "Barcode",
    "Vend. Prod.",
    "Material Description",
    "Replenishment",
    "Sales Ranking",
    "Article Rank by Units",
    "BMC",
    "DSC Alert",
    "Date Last Sold",
    "Last Recpt Y/M",
    "Site",
    "Site Name",
    "Site Ranking",
    "PR ST",
    "Selling UoM",
    "SOH",
    "SOO",
    "SIT",
    "STO",
    "Open to Order",
    "OTO Value",
    "Num. of Site",
    "Num. Of Sku",
    "Ave Monthly Sales",
    "Act DSC",
    "MAC",
    "Nett Cost",
    "Incl SP",
    "Promo SP",
    "Stk Margin %",
    // Monthly units/value pairs
    ...outputCols,
    // Post-data columns
    "Curr Y/S Units",
    "Curr Y/S Value",
    "Curr Y/S Value LY",
    "Curr Y/S Units LY",
    "Composition",
    "Regions",
    "Buyer",
    "R_Profile",
  ];
}

// ── Main computation ──────────────────────────────────────────

export function computeVitalSigns(
  rows: Row[],
  dscBrackets: DSCBrackets,
  dateColumns: string[],
  statusDefs: StatusDefinition[],
  otoMultipliers: Record<string, number> = {}
): VitalSignsRow[] {
  // Pre-compute rankings
  const siteRankings = calcSiteRankings(rows, dateColumns);
  const articleRankings = calcArticleRankings(rows, dateColumns);
  const { dateMap } = buildMonthlyColumns(dateColumns);
  const monthCount = dateColumns.length || 1;

  return rows.map((row) => {
    // DSC Alert
    const actDsc = Number(row["Act DSC"] ?? 0);
    const dscAlert = classifyDSC(actDsc, dscBrackets);

    // Date Last Sold
    const dateLastSold = calcMonthLastSold(row, dateColumns);

    // Site Ranking
    const site = String(row["Site"] ?? "").trim();
    const siteRanking = siteRankings.get(site) ?? "";

    // Article Rank by Units
    const article = String(row["Article"] ?? "").trim();
    const articleRank = articleRankings.get(article) ?? "";

    // Open to Order
    const category = String(row["_category"] ?? "").trim().toLowerCase();
    const categoryMultiplier = (category && otoMultipliers[category]) || 1;
    const { oto, otoValue } = calcOpenToOrder(row, statusDefs, categoryMultiplier);

    // Ave Monthly Sales — sum of all date columns / number of months
    let totalUnits = 0;
    for (const col of dateColumns) {
      const v = Number(row[col]);
      if (!isNaN(v)) totalUnits += v;
    }
    const aveMonthly = Math.round((totalUnits / monthCount) * 100) / 100;

    // Nett Cost for value calculations
    const nettCost = Number(row["Nett Cost"] ?? 0);

    // Build monthly Units/Value columns
    const monthlyData: Record<string, unknown> = {};
    for (const [rawCol, { unitsCol, valueCol }] of dateMap) {
      const units = Number(row[rawCol] ?? 0);
      monthlyData[unitsCol] = isNaN(units) ? 0 : units;
      monthlyData[valueCol] = isNaN(units) ? 0 : Math.round(units * nettCost * 100) / 100;
    }

    // Curr Y/S — split to units + value
    const currYS = Number(row["Curr Y/S"] ?? 0);

    const output: VitalSignsRow = {
      // 1. Vendor
      "Vendor": row["Vendor"] ?? "",
      // 2. Channel (from store enrichment)
      "Channel": row["_storeSubChannel"] || row["_storeChannel"] || "",
      // 3. Cat Name
      "Cat Name": row["_category"] ?? "",
      // 4. Sub Cat Name
      "Sub Cat Name": row["_subCategory"] ?? "",
      // 5. Article
      "Article": row["Article"] ?? "",
      // 6. Barcode
      "Barcode": row["Barcode"] ?? row["_barcode"] ?? "",
      // 7. Vend. Prod.
      "Vend. Prod.": row["Vendor Prod Code"] ?? "",
      // 8. Material Description
      "Material Description": row["Article Desc"] ?? "",
      // 9. Replenishment
      "Replenishment": row["PR QTY"] ?? "",
      // 10. Sales Ranking
      "Sales Ranking": row["_productStatus"] ?? "",
      // 11. Article Rank by Units
      "Article Rank by Units": articleRank,
      // 12. BMC
      "BMC": row["BMC"] ?? "",
      // 13. DSC Alert
      "DSC Alert": dscAlert,
      // 14. Date Last Sold
      "Date Last Sold": dateLastSold,
      // 15. Last Recpt Y/M
      "Last Recpt Y/M": row["Last Recv"] ?? "",
      // 16. Site
      "Site": row["Site"] ?? "",
      // 17. Site Name
      "Site Name": row["_storeName"] || row["Site Name"] || "",
      // 18. Site Ranking
      "Site Ranking": siteRanking,
      // 19. PR ST
      "PR ST": row["Status"] ?? "",
      // 20. Selling UoM
      "Selling UoM": row["UOM"] ?? "",
      // 21-23. SOH, SOO, SIT
      "SOH": row["SOH"] ?? "",
      "SOO": row["SOO"] ?? "",
      "SIT": row["SIT"] ?? "",
      // 24. STO
      "STO": row["Ret Ord"] ?? "",
      // 25-26. Open to Order
      "Open to Order": oto,
      "OTO Value": Math.round(otoValue * 100) / 100,
      // 27-28. Counts
      "Num. of Site": 1,
      "Num. Of Sku": 1,
      // 29. Ave Monthly Sales
      "Ave Monthly Sales": aveMonthly,
      // 30. Act DSC
      "Act DSC": row["Act DSC"] ?? "",
      // 31. MAC
      "MAC": row["MAC"] ?? "",
      // 32. Nett Cost
      "Nett Cost": row["Nett Cost"] ?? "",
      // 33. Incl SP
      "Incl SP": row["Incl SP"] ?? "",
      // 34. Promo SP
      "Promo SP": row["Prom SP"] ?? "",
      // 35. Stk Margin %
      "Stk Margin %": row["Stock Margin"] ?? "",
      // Monthly Units/Value pairs
      ...monthlyData,
      // Curr Y/S split
      "Curr Y/S Units": currYS,
      "Curr Y/S Value": Math.round(currYS * nettCost * 100) / 100,
      "Curr Y/S Value LY": "",
      "Curr Y/S Units LY": "",
      // Trailing columns
      "Composition": row["Compo"] ?? "",
      "Regions": row["_province"] ?? "",
      "Buyer": row["Buyer"] ?? "",
      "R_Profile": row["RP"] ?? "",
    };

    return output;
  });
}
