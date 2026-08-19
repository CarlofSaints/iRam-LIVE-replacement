import * as XLSX from "xlsx";
import { resolveHeader, DATE_COL_REGEX, CANONICAL_HEADERS } from "./headers";
import {
  FIXED_QUANTITY_COLUMN,
  detectPeriodThousands,
  applyPeriodThousands,
  describeDetection,
  type ThousandsDetection,
} from "./dispoNumbers";

// Two source columns resolving to the same field (e.g. Libra's payment-terms
// "Descriptio" and the real "Article Description" both map to "Article Desc").
// The parser keeps the first and unmaps the rest; this records what happened so
// the upload can warn about it.
export interface HeaderCollision {
  field: string;                                // canonical field the columns fought over
  kept: { col: string; header: string };        // column letter + raw header used
  dropped: { col: string; header: string }[];   // later columns ignored
}

export interface DispoParseResult {
  vendorNumber: string;         // primary (dominant) vendor — kept for back-compat
  vendorNumbers: string[];      // ALL distinct real (numeric) vendors in the file
  rows: Record<string, unknown>[];  // each row stamped with `_vendor` (its own resolved vendor)
  dateColumns: string[];
  headerRow: number;
  totalRows: number;
  collisions: HeaderCollision[];
  /** Period-as-thousands detection over the quantity columns — see dispoNumbers. */
  thousands: ThousandsDetection & { cellsRescaled: number; notes: string[] };
}

/**
 * Parse a DISPO Excel buffer.
 * Returns the extracted vendor number, parsed rows, and detected date columns.
 */
export function parseDispo(buffer: Buffer): DispoParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  // Find the data sheet — prefer one with numeric-prefix name
  let sheetName = workbook.SheetNames[0];
  for (const name of workbook.SheetNames) {
    if (/^\d/.test(name.trim())) {
      sheetName = name;
      break;
    }
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("No data sheet found");

  // Convert to array of arrays for header scanning. `raw:false` gives Excel's
  // formatted text (so dates/numbers read as they display). A parallel `raw:true`
  // pass keeps the underlying values — used only for ID columns (Article, Vendor
  // Prod Code) where a large barcode would otherwise come through in scientific
  // notation (e.g. "8.50016E+11") and lose its digits.
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const aoaRaw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  // Find header row — scan first 10 rows for one containing "Vendor" or "Article"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => String(c ?? "").toLowerCase().trim());
    if (
      cells.includes("vendor") ||
      cells.includes("article") ||
      cells.includes("article desc") ||
      cells.includes("article description")
    ) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error("Could not find header row — expected 'Vendor' or 'Article' column");
  }

  const rawHeaders = (aoa[headerRowIdx] as unknown[]).map((c) =>
    String(c ?? "").trim()
  );

  // Resolve headers
  const resolvedHeadersRaw = rawHeaders.map((h) => (h ? resolveHeader(h) : ""));

  // Guard against two source columns resolving to the SAME canonical header.
  // e.g. Libra's payment-terms column "Descriptio" and the real "Article
  // Description" both map to "Article Desc". Because rows are built left-to-right
  // with obj[header] = value, the LATER column silently overwrote the earlier —
  // so every SKU's name became the payment-terms text. Keep the FIRST occurrence
  // (in a DISPO the genuine field always appears earlier, beside "Article") and
  // unmap later duplicates so they can't clobber real data. Blank headers are
  // already unmapped and skipped, so they never collide. Conflicts on a real
  // (canonical) field are recorded so the upload can warn the user.
  const canonicalSet = new Set(CANONICAL_HEADERS);
  const firstSeenAt = new Map<string, number>();
  const collisionByField = new Map<string, HeaderCollision>();
  const resolvedHeaders = resolvedHeadersRaw.map((h, j) => {
    if (!h) return "";
    const firstJ = firstSeenAt.get(h);
    if (firstJ !== undefined) {
      // Only surface conflicts on fields the app actually uses; ignore
      // unrecognised passthrough columns (e.g. two "Curr" columns) as noise.
      if (canonicalSet.has(h)) {
        let c = collisionByField.get(h);
        if (!c) {
          c = {
            field: h,
            kept: { col: XLSX.utils.encode_col(firstJ), header: rawHeaders[firstJ] },
            dropped: [],
          };
          collisionByField.set(h, c);
        }
        c.dropped.push({ col: XLSX.utils.encode_col(j), header: rawHeaders[j] });
      }
      return ""; // drop the later duplicate so it can't overwrite the first
    }
    firstSeenAt.set(h, j);
    return h;
  });
  const collisions = [...collisionByField.values()];

  // Detect date columns
  const dateColumns: string[] = [];
  for (const h of resolvedHeaders) {
    if (DATE_COL_REGEX.test(h) && !dateColumns.includes(h)) {
      dateColumns.push(h);
    }
  }

  // ID columns whose raw numeric value we keep verbatim (as a plain integer
  // string) instead of Excel's scientific-notation display text.
  const ID_COLUMNS = new Set(["Article", "Vendor Prod Code", "Barcode"]);
  const plainInt = (v: unknown): string | null => {
    if (typeof v === "number" && Number.isFinite(v)) {
      // EAN/article codes are integers well within Number.MAX_SAFE_INTEGER, so
      // toString() is exact and never uses exponent notation at this magnitude.
      return Number.isInteger(v) ? v.toString() : String(v);
    }
    return null;
  };

  // Parse data rows
  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;
    const rawRow = Array.isArray(aoaRaw[i]) ? (aoaRaw[i] as unknown[]) : [];

    // Skip blank rows
    const hasData = row.some(
      (c) => c !== null && c !== undefined && String(c).trim() !== ""
    );
    if (!hasData) continue;

    const obj: Record<string, unknown> = {};
    for (let j = 0; j < resolvedHeaders.length; j++) {
      const header = resolvedHeaders[j];
      if (!header) continue;
      if (ID_COLUMNS.has(header)) {
        obj[header] = plainInt(rawRow[j]) ?? (row[j] ?? "");
      } else {
        obj[header] = row[j] ?? "";
      }
    }
    rows.push(obj);
  }

  // ── Multi-vendor resolution ──
  // A single DISPO often carries more than one real vendor. REAL vendor codes
  // are NUMERIC; a non-numeric value in the Vendor column (e.g. "D102") is a DC
  // code — the Africa / DC-supplied lines that get stock via the DC rather than
  // the vendor directly — NOT a vendor. We therefore:
  //   1. collect every distinct numeric vendor,
  //   2. map each Article to its real vendor from the numeric rows,
  //   3. stamp every row with its own resolved `_vendor` — a DC line inherits
  //      the vendor of the SAME article found under a numeric vendor, so its
  //      stock/sales are written to that vendor (never dropped).
  const vendorCount = new Map<string, number>();
  const articleVendor = new Map<string, string>();
  for (const r of rows) {
    const m = String(r["Vendor"] ?? "").trim().match(/^(\d+)/);
    if (!m) continue;                       // skip DC / non-numeric here
    const vn = m[1];
    vendorCount.set(vn, (vendorCount.get(vn) ?? 0) + 1);
    const a = String(r["Article"] ?? "").trim().toLowerCase();
    if (a && !articleVendor.has(a)) articleVendor.set(a, vn);
  }
  let vendorNumbers = [...vendorCount.keys()].sort();

  // No numeric vendor found in the data → fall back to the sheet-name prefix.
  if (vendorNumbers.length === 0) {
    const nameMatch = sheetName.match(/^(\d+)/);
    if (nameMatch) vendorNumbers = [nameMatch[1]];
  }

  // Dominant (most rows) vendor is the fallback for a DC line whose article
  // isn't found under any numeric vendor (rare) — keeps it with a real vendor.
  let dominantVendor = vendorNumbers[0] ?? "";
  let domCount = -1;
  for (const [vn, c] of vendorCount) if (c > domCount) { domCount = c; dominantVendor = vn; }

  const resolveRowVendor = (r: Record<string, unknown>): string => {
    const m = String(r["Vendor"] ?? "").trim().match(/^(\d+)/);
    if (m) return m[1];
    const a = String(r["Article"] ?? "").trim().toLowerCase();
    return articleVendor.get(a) || dominantVendor || "";
  };
  for (const r of rows) r["_vendor"] = resolveRowVendor(r);

  const vendorNumber = dominantVendor;

  // ── Period-as-thousands ──
  // Some SAP exports write 1,525 as "1.525" in the quantity columns. Judge it
  // against the file's own "**" total lines and rescale only on a unanimous
  // verdict. MUST run before the UOM collapse, because the collapse reads and
  // compares those same values. Prices are deliberately excluded — they carry
  // real decimals.
  const quantityColumns = [...dateColumns, FIXED_QUANTITY_COLUMN];
  const detection = detectPeriodThousands(rows, quantityColumns);
  const cellsRescaled = detection.applies
    ? applyPeriodThousands(rows, quantityColumns)
    : 0;

  // Makro-style DISPOs list the same Article×Site once per UOM (EA, CS, PAL,
  // LAY, SW…). Stock sits only on the selling-unit row; the pack rows carry
  // SOH=0. Because the sales ledger dedups by Article|Site, the zero-stock pack
  // rows would otherwise overwrite the real stock and make every SKU look out of
  // stock. Collapse each Article|Site to its most meaningful row here. Files
  // with one row per Article|Site (e.g. Massbuild) are unchanged.
  const collapsed = collapseUomRows(rows, dateColumns);

  return {
    vendorNumber,
    vendorNumbers,
    rows: collapsed,
    dateColumns,
    headerRow: headerRowIdx,
    totalRows: collapsed.length,
    collisions,
    thousands: {
      ...detection,
      cellsRescaled,
      notes: describeDetection(detection, cellsRescaled),
    },
  };
}

// Reduce duplicate Article|Site rows (one per UOM) to a single representative.
//
// TWO different rows are needed and they are not the same row:
//
//   • STOCK, prices and status come from the SELLING-UNIT row — the one with
//     real SOH. The pack rows (CS/PAL/LAY) carry SOH=0.
//
//   • SALES come from the "**" row, which is the file's own grand total for
//     that Article×Site expressed in base units — i.e. Σ(units × Compo) across
//     the UOM lines. A store that bought 32 eaches AND 1 case of 25 has 32 on
//     the EA line, 1 on the CS line and 57 on "**". Taking the selling row
//     alone silently DROPS every case, pallet and layer sale.
//     Verified against a real Makro DISPO: the "**" line reconciles to
//     Σ(units × Compo) for 194 of 194 keys that have one.
//
// Where a group has no "**" line we keep the selling row's own sales, because
// without the file's own total there is nothing to prove a multi-UOM sale
// against — and Σ(units × Compo) over a single-row group would multiply a
// Massbuild-style row by its pack size. Those cases are counted so a file that
// needs the total but hasn't got one can't pass unnoticed.
//
// Files with one row per Article|Site (e.g. Massbuild) are unchanged.
function collapseUomRows(
  rows: Record<string, unknown>[],
  dateColumns: string[],
): Record<string, unknown>[] {
  const numOf = (v: unknown): number => {
    const n = Number(String(v ?? "").replace(/,/g, "").trim());
    return isNaN(n) ? -Infinity : n;
  };
  const salesTotal = (r: Record<string, unknown>): number => {
    let t = 0;
    for (const c of dateColumns) {
      const n = Number(String(r[c] ?? "").replace(/,/g, "").trim());
      if (!isNaN(n)) t += n;
    }
    return t;
  };
  const isTotalRow = (r: Record<string, unknown>): boolean =>
    String(r["UOM"] ?? "").trim() === "**";

  const groups = new Map<string, Record<string, unknown>[]>();
  const order: (string | Record<string, unknown>)[] = [];
  for (const r of rows) {
    const a = String(r["Article"] ?? "").trim().toLowerCase();
    const s = String(r["Site"] ?? "").trim().toLowerCase();
    if (!a || !s) { order.push(r); continue; } // unkeyed rows pass through as-is
    const k = `${a}|${s}`;
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push(r);
  }

  // Every column whose value must come off the "**" total line.
  const salesColumns = [...dateColumns, FIXED_QUANTITY_COLUMN];

  const out: Record<string, unknown>[] = [];
  for (const item of order) {
    if (typeof item !== "string") { out.push(item); continue; }
    const g = groups.get(item)!;
    if (g.length === 1) { out.push(g[0]); continue; }

    // The selling-unit row: highest SOH, tie-broken by highest sales. The "**"
    // line is never eligible — it carries SOH=0 and no prices of its own.
    const sellCandidates = g.filter((r) => !isTotalRow(r));
    const pool = sellCandidates.length > 0 ? sellCandidates : g;
    let best = pool[0];
    for (const r of pool) {
      if (numOf(r["SOH"]) - numOf(best["SOH"]) > 0) best = r;
      else if (numOf(r["SOH"]) === numOf(best["SOH"]) && salesTotal(r) > salesTotal(best)) best = r;
    }

    const total = g.find(isTotalRow);
    if (!total) { out.push(best); continue; }

    // Selling row for everything, "**" for the sales columns only.
    const merged: Record<string, unknown> = { ...best };
    for (const c of salesColumns) {
      if (c in total) merged[c] = total[c];
    }
    out.push(merged);
  }
  return out;
}
