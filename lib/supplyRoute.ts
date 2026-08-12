/* ──────────────────────────────────────────────────────────────
   Vendor × Source of Supply — is this line orderable?

   A DISPO's Vendor column holds one of two things:
     • a vendor number  (numeric, e.g. 1063)
     • a DC code        ("D"-prefixed, e.g. D102)

   The Source of Supply column says how the store is actually supplied, and
   the two must agree or the order is never placed:

     vendor number + ZL   local supplier delivering directly to store    ✓
     DC code       + ZD   DC delivering to store                         ✓
     vendor number + ZF   supplier delivering directly across the border ✓

   Anything else is a mismatch the customer has to fix on their side — a DC
   code against ZL, or a vendor number against ZD, means the order will not
   be placed even though the line looks fine in the DISPO.

   Pure functions only, so the upload route, the weekly alert and the tests
   all judge a row the same way.
   ────────────────────────────────────────────────────────────── */

export type VendorKind = "vendor" | "dc" | "unknown";
export type SupplyVerdict = "ok" | "mismatch" | "no source of supply" | "unknown vendor";

/**
 * Which kind of value is in the Vendor column? A real vendor code is numeric;
 * a DC code starts with "D". Anything else is reported rather than guessed at.
 */
export function vendorKind(value: unknown): VendorKind {
  const v = String(value ?? "").trim();
  if (!v) return "unknown";
  if (/^\d/.test(v)) return "vendor";
  if (/^d/i.test(v)) return "dc";
  return "unknown";
}

/**
 * Source of supply, read from either spelling. New loads resolve to the
 * canonical "Source of Supply", but rows already in the ledger were stored
 * under the raw "SS", so both are checked — the same fallback the report
 * code uses for Status / PR ST.
 */
export function sourceOfSupply(row: Record<string, unknown>): string {
  const raw = row["Source of Supply"] ?? row["SS"] ?? row["Source Of Supply"] ?? "";
  return String(raw ?? "").trim().toUpperCase();
}

/** The vendor value as written in the file — a vendor number or a DC code. */
export function vendorValue(row: Record<string, unknown>): string {
  return String(row["Vendor"] ?? row["Vendor Number"] ?? "").trim();
}

/** Which vendor kind each source of supply requires. */
const REQUIRED_KIND: Record<string, VendorKind> = {
  ZL: "vendor", // local supplier delivering directly to store
  ZD: "dc",     // DC delivering to store
  ZF: "vendor", // supplier delivering directly to store across the border
};

export const SUPPLY_DEFINITIONS: Record<string, string> = {
  ZL: "Local supplier delivering directly to store",
  ZD: "DC delivering to store",
  ZF: "Supplier delivering directly to store across border",
};

export function judge(kind: VendorKind, ss: string): SupplyVerdict {
  if (!ss) return "no source of supply";
  const required = REQUIRED_KIND[ss];
  // An unrecognised source-of-supply code can't be judged against the rules,
  // so it is reported as a mismatch rather than quietly passed.
  if (!required) return "mismatch";
  if (kind === "unknown") return "unknown vendor";
  return kind === required ? "ok" : "mismatch";
}

export interface SupplyIssue {
  siteNum: string;
  siteName: string;
  vendor: string;          // the vendor number or DC code as written
  vendorKind: VendorKind;
  article: string;
  description: string;
  soh: string;
  sourceOfSupply: string;
  verdict: SupplyVerdict;
  /** What the pairing would have to be to work, in plain words. */
  expected: string;
}

export interface SupplyScan {
  ok: number;
  mismatches: SupplyIssue[];
  /** Rows with no source of supply at all — reported separately, not as errors. */
  blank: number;
  /** Rows whose Vendor value is neither numeric nor D-prefixed. */
  unknownVendor: number;
  /** Whether the file carried a source-of-supply column at all. */
  hasColumn: boolean;
}

function expectedText(kind: VendorKind, ss: string): string {
  if (!REQUIRED_KIND[ss]) return `"${ss}" is not a recognised source of supply (expected ZL, ZD or ZF)`;
  const need = REQUIRED_KIND[ss];
  return need === "dc"
    ? `${ss} (${SUPPLY_DEFINITIONS[ss]}) needs a DC code, not a vendor number`
    : `${ss} (${SUPPLY_DEFINITIONS[ss]}) needs a vendor number, not a DC code`;
}

/**
 * Check every row of a parsed DISPO. `storeName` resolves a site code to its
 * name so the report names the store rather than just its number.
 */
export function scanSupplyRoutes(
  rows: Record<string, unknown>[],
  storeName: (siteNum: string) => string = () => "",
): SupplyScan {
  let ok = 0, blank = 0, unknownVendor = 0, hasColumn = false;
  const mismatches: SupplyIssue[] = [];

  for (const row of rows) {
    const ss = sourceOfSupply(row);
    if (ss) hasColumn = true;
    const vendor = vendorValue(row);
    const kind = vendorKind(vendor);
    const verdict = judge(kind, ss);

    if (verdict === "ok") { ok++; continue; }
    if (verdict === "no source of supply") { blank++; continue; }
    if (verdict === "unknown vendor") { unknownVendor++; continue; }

    const siteNum = String(row["Site"] ?? "").trim();
    mismatches.push({
      siteNum,
      siteName: String(row["Site Name"] ?? "").trim() || storeName(siteNum),
      vendor,
      vendorKind: kind,
      article: String(row["Article"] ?? "").trim(),
      description: String(row["Article Desc"] ?? row["Description"] ?? "").trim(),
      soh: String(row["SOH"] ?? "").trim(),
      sourceOfSupply: ss,
      verdict,
      expected: expectedText(kind, ss),
    });
  }

  return { ok, mismatches, blank, unknownVendor, hasColumn };
}

/**
 * Rows for the spreadsheet attachment, in the order Carl asked for:
 * site number, site name, vendor value, article number, product description, SOH.
 */
export function issueSheetRows(issues: SupplyIssue[]): Record<string, string>[] {
  return issues.map((i) => ({
    "Site Number": i.siteNum,
    "Site Name": i.siteName,
    "Vendor / DC": i.vendor,
    "Vendor Type": i.vendorKind === "dc" ? "DC code" : i.vendorKind === "vendor" ? "Vendor number" : "Unrecognised",
    "Source of Supply": i.sourceOfSupply,
    "Article": i.article,
    "Product Description": i.description,
    "SOH": i.soh,
    "Why it will not be ordered": i.expected,
  }));
}
