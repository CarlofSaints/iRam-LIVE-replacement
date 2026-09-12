/* ──────────────────────────────────────────────────────────────
   Report vendor scope — "give me just this vendor's SKUs".

   USABCO carries two vendor numbers with a DIFFERENT Account Manager on each,
   and Month-End / Vital Signs are presented (and met on) per vendor, so a
   whole-client report is the wrong artefact to hand either AM (Sibonelo,
   12 Sep 2026).

   Nothing new has to be joined to do this. Every ledger row already knows its
   own owner: the DISPO parser and the PMF Principal stamp `_vendor` per row
   and it survives the merge and the enrichment (see lib/principalVendor.ts).
   Scoping a report is therefore a filter over rows that already carry the
   answer — which is also why the filename comes out right for free, since
   `reportVendorPart` reads the vendors present in the rows it is given.

   Three rules worth keeping:

   • A vendor number means nothing outside its channel. VERIGREEN is 9677 on
     MAKRO and 1544 on MASSBUILD, so the picker is built from the rows of the
     channels ACTUALLY SELECTED, never from the client's declared list. A
     declared vendor with no rows in this channel would be an option that
     returns an empty report.

   • Nobody knows a 10-digit vendor number by heart, so every option carries
     its name. The name may only be read off a row whose OWN `Vendor` cell is
     the vendor we resolved: `_vendor` is inherited onto DC lines, and those
     carry the DC's name, so reading the name off any matching row labels a
     whole vendor with a distribution centre's name.

   • Rows whose vendor could not be resolved (`_vendor` blank) are never
     quietly folded into whichever vendor was picked. They drop out of a scoped
     report, and the count is reported alongside the options, so "the totals
     don't add up to the full report" has an answer on screen instead of being
     discovered in a meeting.
   ────────────────────────────────────────────────────────────── */

type Row = { [k: string]: unknown };

/** One selectable vendor, as it appears in the data. */
export interface VendorOption {
  /** The vendor number as stamped on the rows. */
  vendor: string;
  /** DISPO "Name" for that vendor, "" when no row could name it safely. */
  name: string;
  /** How many ledger rows belong to it, within the current channel selection. */
  rowCount: number;
  /** Is this vendor on the client record, or only in the data? */
  declared: boolean;
}

export interface VendorScopeOptions {
  vendors: VendorOption[];
  /** Rows carrying no resolvable vendor — excluded by ANY vendor selection. */
  rowsWithoutVendor: number;
}

/** The vendor stamped on a row, or "" when it could not be resolved. */
export function rowVendor(row: Row): string {
  return String(row["_vendor"] ?? "").trim();
}

/**
 * vendor number → vendor name, read only from rows that genuinely belong to
 * that vendor.
 *
 * ⚠️ `_vendor` is INHERITED onto DC lines, which carry the DC's name. So the
 * name is taken only where the row's own `Vendor` cell starts with the same
 * number we resolved — otherwise a vendor ends up labelled with a DC's name.
 */
export function collectVendorNames(rows: Row[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const resolved = rowVendor(row);
    if (!resolved || names.has(resolved)) continue;
    const own = String(row["Vendor"] ?? "").trim().match(/^(\d+)/);
    if (!own || own[1] !== resolved) continue;
    const name = String(row["Name"] ?? "").trim();
    if (name) names.set(resolved, name);
  }
  return names;
}

/**
 * Every vendor present in these rows, ordered by the client's declared list
 * first (so the picker is stable between runs) and then by number.
 *
 * A vendor found in the data but NOT declared on the client is still offered —
 * that disagreement is worth seeing rather than hiding, and it is exactly the
 * case where someone is missing data they expected to have.
 */
export function buildVendorOptions(
  rows: Row[],
  declared: string[] | undefined,
): VendorScopeOptions {
  const counts = new Map<string, number>();
  let rowsWithoutVendor = 0;

  for (const row of rows) {
    const v = rowVendor(row);
    if (!v) {
      rowsWithoutVendor++;
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const names = collectVendorNames(rows);
  const declaredList = (declared ?? []).map((v) => String(v).trim()).filter(Boolean);
  const declaredSet = new Set(declaredList);

  const inDeclaredOrder = declaredList.filter((v) => counts.has(v));
  const rest = [...counts.keys()].filter((v) => !declaredSet.has(v)).sort();

  const vendors: VendorOption[] = [...inDeclaredOrder, ...rest].map((vendor) => ({
    vendor,
    name: names.get(vendor) ?? "",
    rowCount: counts.get(vendor) ?? 0,
    declared: declaredSet.has(vendor),
  }));

  return { vendors, rowsWithoutVendor };
}

/** Read the `vendors` query param (comma-separated). Empty = no scoping. */
export function parseVendorParam(raw: string | null): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Narrow rows to the selected vendors. An empty selection means "all vendors"
 * and returns the array untouched — a client with one vendor, which is most of
 * them, behaves exactly as it did before this existed.
 */
export function filterRowsByVendor<T extends Row>(rows: T[], vendors: string[]): T[] {
  if (vendors.length === 0) return rows;
  const wanted = new Set(vendors);
  return rows.filter((row) => wanted.has(rowVendor(row)));
}

/** Label for a vendor option: "9677 — VERIGREEN" (or just the number). */
export function vendorLabel(opt: VendorOption): string {
  return opt.name ? `${opt.vendor} - ${opt.name}` : opt.vendor;
}
