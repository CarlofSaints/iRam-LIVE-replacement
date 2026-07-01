import * as XLSX from "xlsx";
import { resolveHeader, DATE_COL_REGEX, CANONICAL_HEADERS } from "./headers";

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
  vendorNumber: string;
  rows: Record<string, unknown>[];
  dateColumns: string[];
  headerRow: number;
  totalRows: number;
  collisions: HeaderCollision[];
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

  // Find vendor number from data rows
  let vendorNumber = "";
  const vendorColIdx = resolvedHeaders.findIndex(
    (h) => h.toLowerCase() === "vendor"
  );

  if (vendorColIdx !== -1) {
    // Scan first few data rows for a numeric vendor value
    for (let i = headerRowIdx + 1; i < Math.min(aoa.length, headerRowIdx + 5); i++) {
      const row = aoa[i];
      if (!Array.isArray(row)) continue;
      const val = String(row[vendorColIdx] ?? "").trim();
      const numMatch = val.match(/^(\d+)/);
      if (numMatch) {
        vendorNumber = numMatch[1];
        break;
      }
    }
  }

  // Fallback: extract from sheet name
  if (!vendorNumber) {
    const nameMatch = sheetName.match(/^(\d+)/);
    if (nameMatch) vendorNumber = nameMatch[1];
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

  // Makro-style DISPOs list the same Article×Site once per UOM (EA, CS, PAL,
  // LAY, SW…). Stock and sales are reported only on the selling-unit row; the
  // pack rows carry SOH=0. Because the sales ledger dedups by Article|Site, the
  // zero-stock pack rows would otherwise overwrite the real stock and make every
  // SKU look out of stock. Collapse each Article|Site to its most meaningful row
  // here. Files with one row per Article|Site (e.g. Massbuild) are unchanged.
  const collapsed = collapseUomRows(rows, dateColumns);

  return {
    vendorNumber,
    rows: collapsed,
    dateColumns,
    headerRow: headerRowIdx,
    totalRows: collapsed.length,
    collisions,
  };
}

// Reduce duplicate Article|Site rows (one per UOM) to a single representative:
// the row with the highest SOH, tie-broken by highest total sales, then first
// seen — i.e. the selling-unit row that actually carries the stock and sales.
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

  const out: Record<string, unknown>[] = [];
  for (const item of order) {
    if (typeof item !== "string") { out.push(item); continue; }
    const g = groups.get(item)!;
    if (g.length === 1) { out.push(g[0]); continue; }
    let best = g[0];
    for (const r of g) {
      if (numOf(r["SOH"]) - numOf(best["SOH"]) > 0) best = r;
      else if (numOf(r["SOH"]) === numOf(best["SOH"]) && salesTotal(r) > salesTotal(best)) best = r;
    }
    out.push(best);
  }
  return out;
}
