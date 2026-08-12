/* ──────────────────────────────────────────────────────────────
   Which vendor does this SKU belong to?

   A DISPO's Vendor column holds either a vendor number or a "D"-prefixed DC
   code. A DC line says how the stock arrived, not whose product it is, so in
   a multi-vendor DISPO there is nothing in the row itself that says which
   vendor owns it. The parser guesses: it inherits the vendor of the same
   article from a numeric-vendor row, and failing that uses the file's
   dominant vendor — a coin toss once a file carries more than one vendor,
   and silent either way.

   The answer lives in the PMF. Its PRODUCT PRINCIPLE column is filled in per
   SKU with the owning vendor number, and the DISPO joins to it through
   Article → LINKS → Client Product ID → PMF.

   Read TOLERANTLY: a Principal counts only when it matches one of the
   client's declared vendor numbers. The column was previously filled with
   whatever the team had to hand, so anything else is treated as a name and
   ignored — which lets the PMFs be corrected SKU by SKU without a flag day.

   Pure functions; the upload route supplies the lookups.
   ────────────────────────────────────────────────────────────── */

import { normalizeArticle } from "./linksLookup";
import { vendorKind } from "./supplyRoute";
import type { ProductMaster } from "./types";

/** How a row's vendor was decided, most authoritative first. */
export type VendorSource = "cell" | "pmf" | "inherited" | "fallback" | "none";

export interface PrincipalConflict {
  article: string;
  clientProductId: string;
  cellVendor: string;
  pmfVendor: string;
}

export interface VendorResolution {
  /** Rows with `_vendor` set and `_vendorSource` stamped. Same array, mutated. */
  rows: Record<string, unknown>[];
  counts: Record<VendorSource, number>;
  /** Numeric Vendor cell disagrees with the PMF's Principal for that SKU. */
  conflicts: PrincipalConflict[];
  /** DC/blank rows that still had to be guessed — the number that matters. */
  unresolved: number;
}

/**
 * Client Product ID → owning vendor number, keeping only Principals that are
 * one of this client's declared vendor numbers.
 *
 * @param declaredVendors the client's vendorNumbers
 */
export function buildPrincipalMap(
  products: ProductMaster[],
  declaredVendors: string[],
): Map<string, string> {
  const declared = new Set(declaredVendors.map((v) => String(v).trim()).filter(Boolean));
  const map = new Map<string, string>();
  for (const p of products) {
    const cpid = String(p.clientProductId ?? "").trim();
    const principal = String(p.principal ?? "").trim();
    if (!cpid || !principal) continue;
    // Tolerant: a name, a brand or a typo simply isn't a vendor number.
    if (!declared.has(principal)) continue;
    map.set(cpid, principal);
  }
  return map;
}

/** How much of the PMF is actually usable for this — for the coverage line. */
export function principalCoverage(
  products: ProductMaster[],
  declaredVendors: string[],
): { total: number; withPrincipal: number; usable: number } {
  const declared = new Set(declaredVendors.map((v) => String(v).trim()).filter(Boolean));
  let withPrincipal = 0, usable = 0;
  for (const p of products) {
    const principal = String(p.principal ?? "").trim();
    if (!principal) continue;
    withPrincipal++;
    if (declared.has(principal)) usable++;
  }
  return { total: products.length, withPrincipal, usable };
}

/**
 * Decide every row's vendor.
 *
 * Order: the numeric Vendor cell (the file states it outright) → the PMF
 * Principal → the vendor of the same article on a numeric row in this file →
 * the dominant vendor. The last one is a guess and is counted, so a half-filled
 * PMF can't quietly look like it is working.
 *
 * @param articleToCpid  Article (normalised) → Client Product ID, from LINKS
 * @param principalByCpid Client Product ID → vendor number, from the PMF
 * @param dominantVendor the parser's fallback
 */
export function resolveVendors(
  rows: Record<string, unknown>[],
  articleToCpid: Map<string, string>,
  principalByCpid: Map<string, string>,
  dominantVendor: string,
): VendorResolution {
  const counts: Record<VendorSource, number> = { cell: 0, pmf: 0, inherited: 0, fallback: 0, none: 0 };
  const conflicts: PrincipalConflict[] = [];
  const seenConflict = new Set<string>();

  // Article → vendor, learned from this file's numeric rows (the old behaviour,
  // kept as the step below the PMF).
  const inherited = new Map<string, string>();
  for (const r of rows) {
    const m = String(r["Vendor"] ?? r["Vendor Number"] ?? "").trim().match(/^(\d+)/);
    if (!m) continue;
    const a = normalizeArticle(r["Article"]);
    if (a && !inherited.has(a)) inherited.set(a, m[1]);
  }

  const pmfVendorFor = (article: unknown): string => {
    const cpid = articleToCpid.get(normalizeArticle(article));
    return cpid ? principalByCpid.get(cpid) ?? "" : "";
  };

  for (const row of rows) {
    const raw = String(row["Vendor"] ?? row["Vendor Number"] ?? "").trim();
    const kind = vendorKind(raw);
    const pmfVendor = pmfVendorFor(row["Article"]);

    if (kind === "vendor") {
      const cell = raw.match(/^(\d+)/)![1];
      // The PMF disagreeing with a stated vendor is a real data fault on one
      // side or the other — worth reporting even though the cell still wins.
      if (pmfVendor && pmfVendor !== cell) {
        const article = String(row["Article"] ?? "").trim();
        const k = `${article}|${cell}|${pmfVendor}`;
        if (!seenConflict.has(k)) {
          seenConflict.add(k);
          conflicts.push({
            article,
            clientProductId: articleToCpid.get(normalizeArticle(row["Article"])) ?? "",
            cellVendor: cell,
            pmfVendor,
          });
        }
      }
      row["_vendor"] = cell;
      row["_vendorSource"] = "cell";
      counts.cell++;
      continue;
    }

    // DC line, or a Vendor value we can't read: the PMF is the authority.
    if (pmfVendor) {
      row["_vendor"] = pmfVendor;
      row["_vendorSource"] = "pmf";
      counts.pmf++;
      continue;
    }

    const fromFile = inherited.get(normalizeArticle(row["Article"]));
    if (fromFile) {
      row["_vendor"] = fromFile;
      row["_vendorSource"] = "inherited";
      counts.inherited++;
      continue;
    }

    if (dominantVendor) {
      row["_vendor"] = dominantVendor;
      row["_vendorSource"] = "fallback";
      counts.fallback++;
      continue;
    }

    row["_vendor"] = "";
    row["_vendorSource"] = "none";
    counts.none++;
  }

  return { rows, counts, conflicts, unresolved: counts.fallback + counts.none };
}

/** Rows for the spreadsheet when the PMF and the DISPO disagree. */
export function conflictSheetRows(
  conflicts: PrincipalConflict[],
  describe: (article: string) => string = () => "",
): Record<string, string>[] {
  return conflicts.map((c) => ({
    "Article": c.article,
    "Client Product ID": c.clientProductId,
    "Product Description": describe(c.article),
    "Vendor on the DISPO": c.cellVendor,
    "Principal on the PMF": c.pmfVendor,
  }));
}
