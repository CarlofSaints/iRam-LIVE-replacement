// Output column order -- exact labels as they appear in the cleaned file.
// Only columns present in the input will appear in the output.
// Date columns (Mon-YYYY or MM-YYYY format) are dynamic and slot between Order Unit and Curr Y/S.
export const CANONICAL_HEADERS = [
  "Vendor",
  "Name",
  "Vendor Prod Code",
  "P Term",
  "Article",
  "Article Desc",
  "Barcode",
  "BMC",
  "BMC Description",
  "PBC",
  "Order Unit",
  // DATE COLUMNS GO HERE (dynamic)
  "Curr Y/S",
  "UOM",
  "Compo",
  "Site",
  "Site Name",
  "Status",
  "RP",
  "R. Profile",
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
];

export const DATE_COL_INSERT_AFTER = "Order Unit";
export const DATE_COL_BEFORE = "Curr Y/S";

// Known header aliases: key = lower-cased name found in file, value = output label.
export const HEADER_ALIASES: Record<string, string> = {
  "vendor name": "Name",
  "article description": "Article Desc",
  "article desc": "Article Desc",
  descriptio: "Article Desc",
  "vend prod": "Vendor Prod Code",
  "vendor prod code": "Vendor Prod Code",
  payt: "P Term",
  "p term": "P Term",
  uom: "UOM",
  "sell uom": "UOM",
  comp: "Compo",
  compo: "Compo",
  "pr st": "Status",
  status: "Status",
  sit: "SIT",
  "stk margin": "Stock Margin",
  "stock margin": "Stock Margin",
  "prod marg": "Product Margin",
  "product margin": "Product Margin",
  promotional: "Prom SP",
  proms: "Prom SP",
  pro: "Prom SP",
  promo: "Prom SP",
  "net cost": "Nett Cost",
  "lst recpt": "Last Recv",
  "last recv": "Last Recv",
  "lst sold": "Last Sold",
  "last sold": "Last Sold",
  "dist. prof.": "Dist.Prof.",
  "dist prof": "Dist.Prof.",
  "future pro": "Future Promo",
  "r. profile": "R. Profile",
  "r_profile": "R. Profile",
  "r profile": "R. Profile",

  // ── Long-form (verbose) Massbuild/SAP export ──────────────────────────
  // The same DISPO is exported in two header styles: short codes ("Vendor",
  // "R. Profile", "Prom SP") and spelled-out names ("Vendor Number",
  // "Rounding Profile", "Promotion SP"). Only the short style was aliased, so
  // every long-style file silently lost these columns — most damagingly the
  // vendor, which left 43 uploads (all Massbuild, from 6 Jul 2026) with no
  // vendor number at all. Both styles were seen in the same client's files, so
  // this is a per-export choice, not a client-by-client one.
  "vendor number": "Vendor",
  "rounding profile": "R. Profile",
  "promotion sp": "Prom SP",
  "last receipt date": "Last Recv",
  "last sold date": "Last Sold",
  "base merchandise category": "BMC",
  "vendor product code": "Vendor Prod Code",
  "terms of payment": "P Term",
  "future prom": "Future Promo",
  // Non-canonical twins — aliased so the ledger doesn't end up holding the same
  // column under two different keys depending on which export style came in.
  "company code": "CoCd",
  "seq number": "Seq No",
  "article type": "MTyp",
  "stock in uom": "Stock In U",
  "zero vat rate": "0 VAT Rate",
  "comp in buom": "Comp in BU",
  "export indicator": "Exp Ind",
  "hazardous chemical": "Haz Chem",
  "abc indicator": "ABC",
  "exchange rate": "Exch. Rate",
};

// Regex to detect date-style columns. Accepts the many shapes retailers export
// month columns in, so a DISPO's sales history is never silently dropped:
//   - Month name + 2/4-digit year, with or without a separator:
//     "Jul26", "Jul-26", "Jul 2026", "July-2026", "September2025"
//   - Numeric month + separator + 2/4-digit year: "07-2026", "7-26"
//   - ISO-ish year-first: "2026-07", "2026/7"
//   - 2-digit year FIRST, then month name: "26-Jul", "25-Jul"
//   - A full date Excel rendered from a serial: "8/1/25", "12/1/25"
// The alpha branch is gated on real month prefixes so ordinary text headers
// (e.g. "Compo", "Curr Y/S") can't be mistaken for date columns.
const MONTH_ALT = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
export const DATE_COL_REGEX = new RegExp(
  "^(?:" +
    `(?:${MONTH_ALT})[a-z]*[\\s\\-/]?\\d{2}(?:\\d{2})?` + // Jul26, July-2026
    `|\\d{2}[\\s\\-/](?:${MONTH_ALT})[a-z]*` +            // 26-Jul  (year first)
    "|\\d{1,2}[\\s\\-/]\\d{1,2}[\\s\\-/]\\d{2}(?:\\d{2})?" + // 8/1/25
    "|\\d{1,2}[\\s\\-/]\\d{2}(?:\\d{2})?" +               // 07-2026, 7-26
    "|\\d{4}[\\s\\-/]\\d{1,2}" +                          // 2026-07
    ")$",
  "i",
);

export function resolveHeader(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (HEADER_ALIASES[lower]) return HEADER_ALIASES[lower];
  // Check if it's a canonical header (case-insensitive)
  const canonical = CANONICAL_HEADERS.find(
    (h) => h.toLowerCase() === lower
  );
  if (canonical) return canonical;
  // Check if it looks like a date column
  if (DATE_COL_REGEX.test(raw.trim())) return raw.trim();
  return raw.trim();
}
