import type { SalesLedgerMeta } from "./types";
import { readJson, writeJson, deleteBlob } from "./blob";
import { DATE_COL_REGEX } from "./headers";

/* ──────────────────────────────────────────────────────────────
   Sales Ledger — Intelligent Merge for DISPO uploads
   ────────────────────────────────────────────────────────────── */

// ── Blob key helpers ──

function ledgerKey(clientId: string, channelId: string): string {
  return `sales/${clientId}/${channelId}.json`;
}

function metaKey(clientId: string, channelId: string): string {
  return `sales/${clientId}/${channelId}-meta.json`;
}

function clientMetaIndexKey(clientId: string): string {
  return `sales/${clientId}/index.json`;
}

// ── Month column normalization ──

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  january: "01", february: "02", march: "03", april: "04",
  june: "06", july: "07", august: "08", september: "09",
  october: "10", november: "11", december: "12",
};

/**
 * Normalize a date column header to canonical MM-YYYY format.
 * Returns null if the header is not a recognizable date column.
 */
export function normalizeDateCol(header: string): string | null {
  const h = header.trim();

  // Mon-YYYY or FullMonth-YYYY → MM-YYYY
  const monYYYY = h.match(/^([A-Za-z]+)-(\d{4})$/);
  if (monYYYY) {
    const mm = MONTH_MAP[monYYYY[1].toLowerCase()];
    return mm ? `${mm}-${monYYYY[2]}` : null;
  }

  // MM-YYYY already canonical
  if (/^\d{2}-\d{4}$/.test(h)) return h;

  // M-YYYY → pad
  const mYYYY = h.match(/^(\d{1,2})-(\d{4})$/);
  if (mYYYY) return `${mYYYY[1].padStart(2, "0")}-${mYYYY[2]}`;

  // YYYY-MM → flip
  const yyyyMM = h.match(/^(\d{4})-(\d{1,2})$/);
  if (yyyyMM) return `${yyyyMM[2].padStart(2, "0")}-${yyyyMM[1]}`;

  // "FullMonth YYYY" (space-separated)
  const fullMonth = h.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (fullMonth) {
    const mm = MONTH_MAP[fullMonth[1].toLowerCase()];
    return mm ? `${mm}-${fullMonth[2]}` : null;
  }

  return null;
}

/**
 * Returns true if the value is non-empty and should overwrite existing data.
 */
function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

/**
 * Test whether a resolved header name is a date column.
 */
function isDateColumn(header: string): boolean {
  return DATE_COL_REGEX.test(header) || /^\d{2}-\d{4}$/.test(header);
}

// ── CRUD functions ──

export async function getSalesLedger(
  clientId: string,
  channelId: string,
): Promise<Record<string, unknown>[]> {
  return readJson<Record<string, unknown>[]>(ledgerKey(clientId, channelId), []);
}

export async function getSalesLedgerMeta(
  clientId: string,
  channelId: string,
): Promise<SalesLedgerMeta | null> {
  return readJson<SalesLedgerMeta | null>(metaKey(clientId, channelId), null);
}

export async function getAllSalesLedgers(
  clientId: string,
): Promise<SalesLedgerMeta[]> {
  return readJson<SalesLedgerMeta[]>(clientMetaIndexKey(clientId), []);
}

export async function deleteSalesLedger(
  clientId: string,
  channelId: string,
): Promise<void> {
  await deleteBlob(ledgerKey(clientId, channelId));
  await deleteBlob(metaKey(clientId, channelId));

  // Remove from client index
  const index = await getAllSalesLedgers(clientId);
  const filtered = index.filter((m) => m.channelId !== channelId);
  await writeJson(clientMetaIndexKey(clientId), filtered);
}

// ── Core merge logic ──

export interface MergeDispoParams {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  vendorNumber: string;
  rows: Record<string, unknown>[];
  dateColumns: string[]; // raw date column names from the upload
  uploadId: string;
  reportYear?: number;
  reportMonth?: number;
  reportWeek?: number;
}

export interface MergeResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export async function mergeDispo(params: MergeDispoParams): Promise<MergeResult> {
  const {
    clientId,
    clientName,
    channelId,
    channelName,
    vendorNumber,
    rows,
    dateColumns,
    uploadId,
    reportYear,
    reportMonth,
    reportWeek,
  } = params;

  // Load existing ledger (or start empty)
  const existing = await getSalesLedger(clientId, channelId);

  // Build lookup map keyed by Article|Site
  const ledgerMap = new Map<string, Record<string, unknown>>();
  for (const row of existing) {
    const key = buildRowKey(row);
    if (key) ledgerMap.set(key, row);
  }

  // Build date column normalization map: rawName → normalizedName
  const dateNormMap = new Map<string, string>();
  for (const raw of dateColumns) {
    const normalized = normalizeDateCol(raw);
    if (normalized) {
      dateNormMap.set(raw, normalized);
    }
  }

  // Also detect any additional date columns in the rows that weren't in dateColumns
  // (some parsers might miss edge cases)
  if (rows.length > 0) {
    for (const key of Object.keys(rows[0])) {
      if (!dateNormMap.has(key) && isDateColumn(key)) {
        const normalized = normalizeDateCol(key);
        if (normalized) dateNormMap.set(key, normalized);
      }
    }
  }

  // Track all normalized date columns across all merged data
  const existingMeta = await getSalesLedgerMeta(clientId, channelId);
  const allDateCols = new Set<string>(existingMeta?.dateColumns ?? []);
  for (const norm of dateNormMap.values()) {
    allDateCols.add(norm);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const key = buildRowKey(row);
    if (!key) continue; // skip rows with no Article or Site

    // Remap date column keys to normalized names
    const normalizedRow: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(row)) {
      const normCol = dateNormMap.get(col);
      if (normCol) {
        normalizedRow[normCol] = val;
      } else {
        normalizedRow[col] = val;
      }
    }

    const existingRow = ledgerMap.get(key);

    if (!existingRow) {
      // INSERT — new combination
      ledgerMap.set(key, normalizedRow);
      inserted++;
    } else {
      // MERGE — compare each field
      let changed = false;

      for (const [col, newVal] of Object.entries(normalizedRow)) {
        const existingVal = existingRow[col];
        const isDate = isDateColumn(col) || /^\d{2}-\d{4}$/.test(col);

        if (!hasValue(newVal)) {
          // New value is empty — keep existing
          continue;
        }

        if (isDate) {
          // Date column: only overwrite if new value has data
          if (!hasValue(existingVal) || existingVal !== newVal) {
            if (hasValue(existingVal) && existingVal === newVal) continue;
            existingRow[col] = newVal;
            changed = true;
          }
        } else {
          // Non-date column: overwrite with new value (latest snapshot)
          if (existingVal !== newVal) {
            existingRow[col] = newVal;
            changed = true;
          }
        }
      }

      if (changed) {
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  // Convert map back to array
  const mergedRows = Array.from(ledgerMap.values());

  // Save ledger
  await writeJson(ledgerKey(clientId, channelId), mergedRows);

  // Update metadata
  const mergedUploadIds = existingMeta?.mergedUploadIds ?? [];
  if (!mergedUploadIds.includes(uploadId)) {
    mergedUploadIds.push(uploadId);
  }

  const meta: SalesLedgerMeta = {
    clientId,
    clientName,
    channelId,
    channelName,
    vendorNumber,
    totalRows: mergedRows.length,
    dateColumns: Array.from(allDateCols).sort(),
    mergedUploadIds,
    lastMergedAt: new Date().toISOString(),
    reportYear: reportYear ?? existingMeta?.reportYear,
    reportMonth: reportMonth ?? existingMeta?.reportMonth,
    reportWeek: reportWeek ?? existingMeta?.reportWeek,
  };

  await writeJson(metaKey(clientId, channelId), meta);

  // Update client-level index
  const clientIndex = await getAllSalesLedgers(clientId);
  const idx = clientIndex.findIndex((m) => m.channelId === channelId);
  if (idx >= 0) {
    clientIndex[idx] = meta;
  } else {
    clientIndex.push(meta);
  }
  await writeJson(clientMetaIndexKey(clientId), clientIndex);

  return { inserted, updated, unchanged };
}

// ── Helpers ──

function buildRowKey(row: Record<string, unknown>): string | null {
  const article = String(row["Article"] ?? "").trim();
  const site = String(row["Site"] ?? "").trim();
  if (!article || !site) return null;
  return `${article}|${site}`;
}
