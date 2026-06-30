/* ──────────────────────────────────────────────────────────────
   Product Master Data — CRUD, build from PMF, auto-match
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import { getRawPmfData } from "./controlFileData";
import type { ProductFieldMapping, ProductMaster } from "./types";

// ── Blob keys ────────────────────────────────────────────────

function mappingKey(clientId: string) {
  return `clients/${clientId}/product-mapping.json`;
}

function masterKey(clientId: string) {
  return `clients/${clientId}/product-master.json`;
}

// ── CRUD ─────────────────────────────────────────────────────

export async function getProductMapping(
  clientId: string
): Promise<ProductFieldMapping | null> {
  return readJson<ProductFieldMapping | null>(mappingKey(clientId), null);
}

export async function saveProductMapping(
  clientId: string,
  mapping: ProductFieldMapping
): Promise<void> {
  await writeJson(mappingKey(clientId), mapping);
}

export async function getProductMaster(
  clientId: string
): Promise<ProductMaster[]> {
  return readJson<ProductMaster[]>(masterKey(clientId), []);
}

// ── Build ────────────────────────────────────────────────────

/**
 * Build structured ProductMaster[] from raw PMF data + saved mapping.
 * Deduplicates by clientProductId (last row wins).
 * Returns the count of products built.
 */
export async function buildProductMaster(
  clientId: string
): Promise<{ count: number }> {
  const saved = await getProductMapping(clientId);
  if (!saved || !saved.clientProductId) {
    return { count: 0 };
  }

  const rawRows = await getRawPmfData(clientId);
  if (rawRows.length === 0) {
    return { count: 0 };
  }

  // Auto-resolve any UNMAPPED optional dimension from the PMF headers, so a
  // saved mapping that predates a field (e.g. Status) still pulls it from the
  // PMF instead of coming back blank. Explicit saved values always win.
  const headers = Object.keys(rawRows[0] ?? {});
  const auto = autoMatchHeaders(headers);
  const mapping: ProductFieldMapping = {
    clientProductId: saved.clientProductId,
    brand: saved.brand || auto.brand,
    category: saved.category || auto.category,
    subCategory: saved.subCategory || auto.subCategory,
    status: saved.status || auto.status,
    description: saved.description || auto.description,
    barcode: saved.barcode || auto.barcode,
  };

  // Build master, dedup by clientProductId (last row wins)
  const dedup = new Map<string, ProductMaster>();

  for (const row of rawRows) {
    const cpidVal = row[mapping.clientProductId];
    if (!cpidVal || !String(cpidVal).trim()) continue;

    const clientProductId = String(cpidVal).trim();
    const key = clientProductId.toLowerCase();

    const entry: ProductMaster = { clientProductId };

    if (mapping.brand && row[mapping.brand] !== undefined) {
      entry.brand = String(row[mapping.brand]).trim() || undefined;
    }
    if (mapping.category && row[mapping.category] !== undefined) {
      entry.category = String(row[mapping.category]).trim() || undefined;
    }
    if (mapping.subCategory && row[mapping.subCategory] !== undefined) {
      entry.subCategory = String(row[mapping.subCategory]).trim() || undefined;
    }
    if (mapping.status && row[mapping.status] !== undefined) {
      entry.status = String(row[mapping.status]).trim() || undefined;
    }
    if (mapping.description && row[mapping.description] !== undefined) {
      entry.description =
        String(row[mapping.description]).trim() || undefined;
    }
    if (mapping.barcode && row[mapping.barcode] !== undefined) {
      entry.barcode = String(row[mapping.barcode]).trim() || undefined;
    }

    dedup.set(key, entry);
  }

  const master = Array.from(dedup.values());
  await writeJson(masterKey(clientId), master);

  return { count: master.length };
}

// ── Lookup ───────────────────────────────────────────────────

/**
 * Load product master and build a Map keyed by clientProductId
 * (trimmed, lowercased) for O(1) lookup during enrichment.
 */
export async function getProductLookup(
  clientId: string
): Promise<Map<string, ProductMaster>> {
  const master = await getProductMaster(clientId);
  const lookup = new Map<string, ProductMaster>();
  for (const p of master) {
    lookup.set(p.clientProductId.toLowerCase().trim(), p);
  }
  return lookup;
}

// ── Auto-Match ───────────────────────────────────────────────

/**
 * Canonical field → common PMF column name aliases (case-insensitive).
 * First match wins.
 */
export const AUTO_MATCH: Record<keyof ProductFieldMapping, string[]> = {
  clientProductId: [
    "client product id",
    "product id",
    "sku",
    "cpid",
    "client prod id",
    "product code",
    "item code",
  ],
  brand: ["brand", "product brand", "brand name"],
  category: ["category", "product category", "cat", "product cat"],
  subCategory: ["sub category", "product sub category", "sub cat", "subcategory"],
  status: ["status", "product status", "prod status", "active"],
  description: [
    "description",
    "product description",
    "article desc",
    "article description",
    "prod desc",
  ],
  barcode: ["barcode", "ean", "gtin", "upc"],
};

/**
 * Given a list of detected PMF column headers, return a best-effort
 * auto-matched mapping. Only includes fields where a match is found.
 */
export function autoMatchHeaders(
  headers: string[]
): Partial<ProductFieldMapping> {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const result: Partial<ProductFieldMapping> = {};

  for (const [field, aliases] of Object.entries(AUTO_MATCH) as [
    keyof ProductFieldMapping,
    string[],
  ][]) {
    for (const alias of aliases) {
      const idx = lowerHeaders.indexOf(alias);
      if (idx !== -1) {
        result[field] = headers[idx]; // Use original casing
        break;
      }
    }
  }

  return result;
}
