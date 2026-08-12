import { periodScore, snapshotWins, isInternalField, SNAPSHOT_PERIOD_FIELD } from "./dispoSnapshot";
import type { SalesLedgerMeta } from "./types";
import { readJson, readJsonStrict, writeJson, deleteBlob } from "./blob";
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
  sept: "09", // "Sept-2025" is common and was silently dropped by the exact-match lookup
};

/**
 * Month name → "MM". Falls back to the first three letters so any abbreviation
 * of a real month resolves ("Sept", "Augu"); an unknown word still returns
 * undefined, which is what keeps ordinary text headers out of the date path.
 */
function monthNumber(name: string): string | undefined {
  const n = name.toLowerCase();
  return MONTH_MAP[n] ?? MONTH_MAP[n.slice(0, 3)];
}

/**
 * Normalize a date column header to canonical MM-YYYY format.
 * Returns null if the header is not a recognizable date column.
 */
export function normalizeDateCol(header: string): string | null {
  const h = header.trim();
  // Expand a 2-digit year to 4 digits (retail data is always 20xx).
  const yr4 = (y: string) => (y.length === 2 ? `20${y}` : y);

  // Month name (abbrev or full) + optional separator + 2/4-digit year:
  // "Jul26", "Jul-26", "Jul 2026", "July-2026", "September2025"
  const alpha = h.match(/^([A-Za-z]+)[\s\-/]?(\d{4}|\d{2})$/);
  if (alpha) {
    const mm = monthNumber(alpha[1]);
    return mm ? `${mm}-${yr4(alpha[2])}` : null;
  }

  // Numeric month + separator + 2/4-digit year: "07-2026", "7-26"
  const num = h.match(/^(\d{1,2})[\s\-/](\d{4}|\d{2})$/);
  if (num) {
    const m = parseInt(num[1], 10);
    return m >= 1 && m <= 12 ? `${num[1].padStart(2, "0")}-${yr4(num[2])}` : null;
  }

  // 2-digit year FIRST, then month name: "26-Jul" = Jul 2026, "25-Jul" = Jul 2025.
  // Read year-first, not day-first: Vermont's Massbuild DISPO carries
  // 26-Feb · 26-Mar · 26-Apr · 26-May · 26-Jun · 26-Jul · 25-Jul — six
  // consecutive months plus the same-month-last-year column, which is the
  // standard DISPO shape and is impossible to read as days of one month.
  const yyMon = h.match(/^(\d{2})[\s\-/]([A-Za-z]+)$/);
  if (yyMon) {
    const mm = monthNumber(yyMon[2]);
    return mm ? `${mm}-${yr4(yyMon[1])}` : null;
  }

  // A monthly column Excel rendered from a date serial: "8/1/25" = Aug 2025.
  // Month-first (US) when both parts could be a month: Cartoon Candy's file
  // reads 8/1/25 · Sept-2025 · 10/1/25 · 11/1/25 · 12/1/25, and the one column
  // that DID parse pins the neighbours to Aug/Oct/Nov/Dec. When the first part
  // can't be a month (>12) it must be day-first, so take the second.
  const slash = h.match(/^(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{4}|\d{2})$/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    const m = a >= 1 && a <= 12 ? a : b;
    return m >= 1 && m <= 12 ? `${String(m).padStart(2, "0")}-${yr4(slash[3])}` : null;
  }

  // Year-first: "2026-07", "2026/7"
  const yyyyMM = h.match(/^(\d{4})[\s\-/](\d{1,2})$/);
  if (yyyyMM) {
    const m = parseInt(yyyyMM[2], 10);
    return m >= 1 && m <= 12 ? `${yyyyMM[2].padStart(2, "0")}-${yyyyMM[1]}` : null;
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

  // Load existing ledger (or start empty).
  // STRICT on purpose: this whole function is a read-modify-write of the
  // client's entire sales history, so a transient read failure that quietly
  // returned [] would merge this one DISPO into nothing and then SAVE that
  // over every month already in the ledger. Failing the upload is recoverable;
  // silently replacing the history is not.
  const existing = await readJsonStrict<Record<string, unknown>[]>(
    ledgerKey(clientId, channelId),
    [],
  );

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

  // Determine the primary year of this upload (for Nett Cost snapshots)
  let uploadPrimaryYear = 0;
  for (const norm of dateNormMap.values()) {
    const p = norm.match(/^\d{2}-(\d{4})$/);
    if (p) {
      const y = parseInt(p[1], 10);
      if (y > uploadPrimaryYear) uploadPrimaryYear = y;
    }
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  // Stamp every row this upload touches with the upload's vendor + a load marker
  // so reports can tell which SKUs are in the LATEST DISPO (point-in-time fields:
  // STATUS/SOH/SOO/SIT) vs stale rows that lingered from an earlier load. Sales
  // (date) columns still accumulate across loads for YTD — only presence/snapshot
  // freshness is gated by this stamp downstream.
  const loadStamp = new Date().toISOString();

  /* Which period THIS upload speaks for. Snapshot fields (stock, prices, status)
     may only be overwritten by a period that is the same or newer — see
     lib/dispoSnapshot.ts. Sales columns are unaffected and still merge from any
     period, which is what makes back-loading history safe. */
  const incomingPeriod = periodScore(reportYear, reportMonth, reportWeek);
  let snapshotsApplied = 0;
  let snapshotsSkipped = 0;

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

    // Snapshot pricing per year so LY value calculations use historical prices
    if (uploadPrimaryYear > 0) {
      if (hasValue(normalizedRow["Nett Cost"])) {
        normalizedRow[`_nettCost_${uploadPrimaryYear}`] = normalizedRow["Nett Cost"];
      }
      if (hasValue(normalizedRow["Incl SP"])) {
        normalizedRow[`_inclSP_${uploadPrimaryYear}`] = normalizedRow["Incl SP"];
      }
      if (hasValue(normalizedRow["Prom SP"])) {
        normalizedRow[`_promSP_${uploadPrimaryYear}`] = normalizedRow["Prom SP"];
      }
    }

    const existingRow = ledgerMap.get(key);

    // Prefer the row's OWN resolved vendor (set by the parser — a DC line
    // inherits the vendor of the same article under a numeric vendor). Fall back
    // to the upload's vendor for legacy callers that don't stamp per row.
    const rowVendor = (typeof normalizedRow["_vendor"] === "string" && normalizedRow["_vendor"])
      ? (normalizedRow["_vendor"] as string)
      : vendorNumber;

    if (!existingRow) {
      // INSERT — new combination
      normalizedRow["_vendor"] = rowVendor;
      normalizedRow["_lastLoadedAt"] = loadStamp;
      normalizedRow[SNAPSHOT_PERIOD_FIELD] = incomingPeriod;
      ledgerMap.set(key, normalizedRow);
      inserted++;
    } else {
      // MERGE — compare each field
      let changed = false;

      /* Snapshot columns describe stock and prices AS AT this DISPO's period.
         An older DISPO loaded later must NOT roll them back — that is what put
         stale SOH into reports while sales still matched. Sales columns below
         are untouched by this, so back-loading history still works. */
      const takeSnapshot = snapshotWins(existingRow[SNAPSHOT_PERIOD_FIELD], incomingPeriod);
      if (takeSnapshot) snapshotsApplied++; else snapshotsSkipped++;

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
        } else if (isInternalField(col)) {
          // Our own bookkeeping (`_nettCost_2025`, …) — already year-scoped in
          // the key, so it is not a snapshot and keeps its previous behaviour.
          if (existingVal !== newVal) {
            existingRow[col] = newVal;
            changed = true;
          }
        } else {
          // Snapshot column — only a same-or-newer period may write it.
          if (!takeSnapshot) continue;
          if (existingVal !== newVal) {
            existingRow[col] = newVal;
            changed = true;
          }
        }
      }

      if (takeSnapshot) existingRow[SNAPSHOT_PERIOD_FIELD] = incomingPeriod;

      // Always re-stamp: this row WAS in the current upload, so it's part of the
      // latest load even if no field value changed.
      existingRow["_vendor"] = rowVendor;
      existingRow["_lastLoadedAt"] = loadStamp;

      if (changed) {
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  /* Visible in the Vercel logs, because "this load didn't change the stock" is
     otherwise indistinguishable from "the load did nothing". A large skip count
     is EXPECTED and correct when back-loading history. */
  if (snapshotsSkipped > 0) {
    console.log(
      `[mergeDispo] ${clientName}/${channelName} period ${reportYear}-${reportMonth}Wk${reportWeek}: ` +
      `kept ${snapshotsSkipped} newer snapshot(s), applied ${snapshotsApplied} — sales merged for all rows.`,
    );
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
    lastMergedAt: loadStamp,
    reportYear: reportYear ?? existingMeta?.reportYear,
    reportMonth: reportMonth ?? existingMeta?.reportMonth,
    reportWeek: reportWeek ?? existingMeta?.reportWeek,
  };

  await writeJson(metaKey(clientId, channelId), meta);

  // Update client-level index (strict — same reason as the ledger read above:
  // a failed read here would drop every other channel from Reports/Charts)
  const clientIndex = await readJsonStrict<SalesLedgerMeta[]>(clientMetaIndexKey(clientId), []);
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
