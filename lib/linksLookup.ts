/* ──────────────────────────────────────────────────────────────
   Links Lookup — Article → Client Product ID mapping

   The LINKS control file bridges channel-specific Article numbers
   (found in DISPO) to global Client Product IDs (found in PMF).
   One Client Product ID may appear multiple times — once per
   channel, each with a different Article.
   ────────────────────────────────────────────────────────────── */

import { getControlFileData } from "./controlFileData";

/**
 * Common column name aliases for auto-detecting the
 * Client Product ID column in LINKS data (case-insensitive).
 */
const CPID_ALIASES = [
  "client product id",
  "product id",
  "cpid",
  "client prod id",
  "sku",
  "product code",
  "item code",
];

/**
 * Common column name aliases for auto-detecting the
 * Article column in LINKS data (case-insensitive).
 */
const ARTICLE_ALIASES = [
  "article",
  "article number",
  "art no",
  "article no",
  "article code",
];

/**
 * Find a column name in a row by checking common aliases.
 * Returns the original (case-preserved) key, or null if not found.
 */
function findColumn(
  row: Record<string, unknown>,
  aliases: string[]
): string | null {
  const keys = Object.keys(row);
  const lowerKeys = keys.map((k) => k.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lowerKeys.indexOf(alias);
    if (idx !== -1) return keys[idx];
  }
  return null;
}

/**
 * Load LINKS control file data and build a Map:
 *   article (lowercased, trimmed) → clientProductId (original casing, trimmed)
 *
 * Auto-detects column names using common aliases.
 * Returns an empty Map if LINKS data is missing or columns can't be detected.
 */
export async function getLinksLookup(
  clientId: string
): Promise<Map<string, string>> {
  const rows = await getControlFileData<Record<string, unknown>>(
    clientId,
    "links"
  );
  const lookup = new Map<string, string>();

  if (rows.length === 0) return lookup;

  // Auto-detect column names from the first row
  const articleCol = findColumn(rows[0], ARTICLE_ALIASES);
  const cpidCol = findColumn(rows[0], CPID_ALIASES);

  if (!articleCol || !cpidCol) return lookup;

  for (const row of rows) {
    const articleVal = row[articleCol];
    const cpidVal = row[cpidCol];

    if (!articleVal || !cpidVal) continue;

    const article = String(articleVal).trim();
    const cpid = String(cpidVal).trim();

    if (!article || !cpid) continue;

    // Key by lowercased article for case-insensitive lookup
    lookup.set(article.toLowerCase(), cpid);
  }

  return lookup;
}
