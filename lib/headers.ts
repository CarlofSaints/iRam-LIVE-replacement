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
};

// Regex to detect date-style columns
export const DATE_COL_REGEX = /^([A-Za-z]+-\d{4}|\d{2}-\d{4})$/;

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
