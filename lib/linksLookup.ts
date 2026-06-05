/* ──────────────────────────────────────────────────────────────
   Links Lookup — Article → Client Product ID mapping

   The LINKS control file bridges channel-specific Article numbers
   (found in DISPO) to global Client Product IDs (found in PMF).
   One Client Product ID may appear multiple times — once per
   channel, each with a different Article.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import { getRawLinksData } from "./controlFileData";
import type { LinksFieldMapping } from "./types";

// ── Blob key ─────────────────────────────────────────────────

function mappingKey(clientId: string) {
  return `clients/${clientId}/links-mapping.json`;
}

// ── CRUD ─────────────────────────────────────────────────────

export async function getLinksMapping(
  clientId: string
): Promise<LinksFieldMapping | null> {
  return readJson<LinksFieldMapping | null>(mappingKey(clientId), null);
}

export async function saveLinksMapping(
  clientId: string,
  mapping: LinksFieldMapping
): Promise<void> {
  await writeJson(mappingKey(clientId), mapping);
}

// ── Auto-Match ───────────────────────────────────────────────

export const LINKS_AUTO_MATCH: Record<keyof LinksFieldMapping, string[]> = {
  article: [
    "article",
    "article number",
    "art no",
    "article no",
    "article code",
  ],
  clientProductId: [
    "client product id",
    "product id",
    "cpid",
    "client prod id",
    "sku",
    "product code",
    "item code",
  ],
};

export function autoMatchLinksHeaders(
  headers: string[]
): Partial<LinksFieldMapping> {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const result: Partial<LinksFieldMapping> = {};

  for (const [field, aliases] of Object.entries(LINKS_AUTO_MATCH) as [
    keyof LinksFieldMapping,
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

// ── Normalize ─────────────────────────────────────────────────

/**
 * Normalize an article value for comparison:
 * - Convert to string, trim, lowercase
 * - Strip trailing ".0" (Excel number→string artifact)
 * - Strip leading zeros (e.g. "007890" → "7890")
 *
 * This ensures numeric articles match regardless of whether the
 * source stored them as text ("12345") or number (12345 → "12345.0").
 */
export function normalizeArticle(val: unknown): string {
  let s = String(val ?? "").trim().toLowerCase();
  // Strip trailing .0 / .00 etc. (only when the entire value is numeric-ish)
  s = s.replace(/\.0+$/, "");
  // Strip leading zeros but keep at least one digit
  s = s.replace(/^0+(?=\d)/, "");
  return s;
}

// ── Lookup ───────────────────────────────────────────────────

/**
 * Load LINKS raw data + saved mapping, build a Map:
 *   article (normalized) → clientProductId (original casing, trimmed)
 *
 * Returns empty Map if no mapping saved or no LINKS data.
 */
export async function getLinksLookup(
  clientId: string
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();

  const mapping = await getLinksMapping(clientId);
  if (!mapping || !mapping.article || !mapping.clientProductId) {
    return lookup;
  }

  const rows = await getRawLinksData(clientId);
  if (rows.length === 0) return lookup;

  for (const row of rows) {
    const articleVal = row[mapping.article];
    const cpidVal = row[mapping.clientProductId];

    if (!articleVal || !cpidVal) continue;

    const article = normalizeArticle(articleVal);
    const cpid = String(cpidVal).trim();

    if (!article || !cpid) continue;

    lookup.set(article, cpid);
  }

  return lookup;
}
