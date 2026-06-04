/* ──────────────────────────────────────────────────────────────
   Vital Signs Report — pure computation engine

   Takes enriched ledger rows + config, returns rows with computed
   columns appended: DSC Alert, Month Last Sold, Site Ranking,
   Open to Order, OTO Value, Num of Site, Num of SKU.
   ────────────────────────────────────────────────────────────── */

import { classifyDSC, type DSCBrackets } from "./reportConfig";
import type { StatusDefinition } from "./types";

type Row = Record<string, unknown>;

export interface VitalSignsRow extends Record<string, unknown> {
  "DSC Alert": string;
  "Month Last Sold": string;
  "Site Ranking": string;
  "Open to Order": number;
  "OTO Value": number;
  "Num of Site": number;
  "Num of SKU": number;
}

// ── Date column helpers ───────────────────────────────────────

const DATE_RE = /^(\d{2})-(\d{4})$/; // MM-YYYY

function parseDateKey(col: string): { month: number; year: number } | null {
  const m = col.match(DATE_RE);
  if (!m) return null;
  return { month: parseInt(m[1], 10), year: parseInt(m[2], 10) };
}

function sortDateKeysDesc(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const pa = parseDateKey(a);
    const pb = parseDateKey(b);
    if (!pa || !pb) return 0;
    const da = pa.year * 100 + pa.month;
    const db = pb.year * 100 + pb.month;
    return db - da; // descending (newest first)
  });
}

// ── Month Last Sold ───────────────────────────────────────────

export function calcMonthLastSold(
  row: Row,
  dateColumns: string[]
): string {
  const sorted = sortDateKeysDesc(dateColumns);
  for (const col of sorted) {
    const val = row[col];
    if (val !== undefined && val !== null && val !== "" && val !== 0 && val !== "0") {
      const num = Number(val);
      if (!isNaN(num) && num > 0) return col;
    }
  }
  return "";
}

// ── Site Rankings (A/B/C) ─────────────────────────────────────

export function calcSiteRankings(
  rows: Row[],
  dateColumns: string[]
): Map<string, "A" | "B" | "C"> {
  // Sum all sales per Site across all date columns
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

  // Sort sites descending by total
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

// ── Open to Order ─────────────────────────────────────────────

/**
 * Open to Order calculation.
 *
 * Conditions (all must be true):
 *   1. SOH <= 0
 *   2. Channel Status is empty/blank/"0" or classified as POSITIVE
 *   3. SOO + SIT = 0
 *   4. PMF Status = ACTIVE
 *
 * OTO Value = categoryMultiplier * RP (R_Profile).
 * The multiplier is configurable per category; defaults to 1.
 */
export function calcOpenToOrder(
  row: Row,
  statusDefs: StatusDefinition[],
  categoryMultiplier: number
): { oto: 0 | 1; otoValue: number } {
  // SOH <= 0
  const soh = Number(row["SOH"] ?? 0);
  if (soh > 0) return { oto: 0, otoValue: 0 };

  // Channel Status check: empty/blank OR classified as POSITIVE (meaning no block)
  const statusRaw = String(row["Status"] ?? "").trim();
  if (statusRaw !== "" && statusRaw !== "0") {
    const statusUpper = statusRaw.toUpperCase();
    const def = statusDefs.find((s) => s.code === statusUpper);
    if (def && def.classification !== "POSITIVE") {
      return { oto: 0, otoValue: 0 };
    }
    // If no def found but status is non-empty and not "0", treat as blocking
    if (!def) {
      return { oto: 0, otoValue: 0 };
    }
  }

  // SOO + SIT = 0
  const soo = Number(row["SOO"] ?? 0);
  const sit = Number(row["SIT"] ?? 0);
  if (soo + sit !== 0) return { oto: 0, otoValue: 0 };

  // PMF Status = ACTIVE
  const productStatus = String(row["_productStatus"] ?? "").trim().toUpperCase();
  if (productStatus !== "ACTIVE") return { oto: 0, otoValue: 0 };

  // All conditions met — OTO Value = multiplier * RP
  const rp = Number(row["RP"] ?? 0);
  return { oto: 1, otoValue: categoryMultiplier * rp };
}

// ── Column output builder ─────────────────────────────────────

/**
 * Returns the ordered list of output column headers for the Vital Signs Excel.
 * Date columns slot between "Order Unit" and "Curr Y/S".
 */
export function getVitalSignsColumnOrder(dateColumns: string[]): string[] {
  const sortedDates = [...dateColumns].sort((a, b) => {
    const pa = parseDateKey(a);
    const pb = parseDateKey(b);
    if (!pa || !pb) return 0;
    return (pa.year * 100 + pa.month) - (pb.year * 100 + pb.month);
  });

  return [
    "Vendor",
    "Name",
    "Article",
    "Article Desc",
    "Category",
    "Sub Category",
    "Sales Ranking",
    "BMC",
    "BMC Description",
    "PBC",
    "Order Unit",
    ...sortedDates,
    "Curr Y/S",
    "UOM",
    "Compo",
    "Site",
    "Site Name",
    "Region",
    "Status",
    "RP",
    "SOH",
    "SOO",
    "SIT",
    "PR QTY",
    "MAC",
    "Stock Margin",
    "List Price",
    "Nett Cost",
    "End Date",
    "Product Margin",
    "Planned Margin",
    "Incl SP",
    "Prom SP",
    "SB",
    "TB",
    "Ret Ord",
    "Plan DSC",
    "Act DSC",
    "RR",
    "Last Recv",
    "Last Sold",
    "Dist.Prof.",
    "Buyer",
    "DSC Alert",
    "Month Last Sold",
    "Site Ranking",
    "Open to Order",
    "OTO Value",
    "Num of Site",
    "Num of SKU",
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
  // Pre-compute site rankings
  const siteRankings = calcSiteRankings(rows, dateColumns);

  return rows.map((row) => {
    // DSC Alert
    const actDsc = Number(row["Act DSC"] ?? 0);
    const dscAlert = classifyDSC(actDsc, dscBrackets);

    // Month Last Sold
    const monthLastSold = calcMonthLastSold(row, dateColumns);

    // Site Ranking
    const site = String(row["Site"] ?? "").trim();
    const siteRanking = siteRankings.get(site) ?? "";

    // Open to Order — resolve category multiplier (default 1)
    const category = String(row["_category"] ?? "").trim().toLowerCase();
    const categoryMultiplier = (category && otoMultipliers[category]) || 1;
    const { oto, otoValue } = calcOpenToOrder(row, statusDefs, categoryMultiplier);

    // Map enriched fields to output column names
    const output: VitalSignsRow = {
      ...row,
      // Enriched fields → output column names
      "Category": row._category ?? "",
      "Sub Category": row._subCategory ?? "",
      "Sales Ranking": row._productStatus ?? "",
      "Site Name": row._storeName ?? "",
      "Region": row._province ?? "",
      // Computed columns
      "DSC Alert": dscAlert,
      "Month Last Sold": monthLastSold,
      "Site Ranking": siteRanking,
      "Open to Order": oto,
      "OTO Value": Math.round(otoValue * 100) / 100,
      "Num of Site": 1,
      "Num of SKU": 1,
    };

    return output;
  });
}
