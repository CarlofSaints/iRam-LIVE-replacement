import * as XLSX from "xlsx";
import { resolveHeader, DATE_COL_REGEX } from "./headers";

export interface DispoParseResult {
  vendorNumber: string;
  rows: Record<string, unknown>[];
  dateColumns: string[];
  headerRow: number;
  totalRows: number;
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

  // Convert to array of arrays for header scanning
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
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
  const resolvedHeaders = rawHeaders.map((h) => (h ? resolveHeader(h) : ""));

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

  // Parse data rows
  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!Array.isArray(row)) continue;

    // Skip blank rows
    const hasData = row.some(
      (c) => c !== null && c !== undefined && String(c).trim() !== ""
    );
    if (!hasData) continue;

    const obj: Record<string, unknown> = {};
    for (let j = 0; j < resolvedHeaders.length; j++) {
      const header = resolvedHeaders[j];
      if (!header) continue;
      obj[header] = row[j] ?? "";
    }
    rows.push(obj);
  }

  return {
    vendorNumber,
    rows,
    dateColumns,
    headerRow: headerRowIdx,
    totalRows: rows.length,
  };
}
