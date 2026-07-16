/* ──────────────────────────────────────────────────────────────
   Store Dimension Lookup — reads from merged store master
   ────────────────────────────────────────────────────────────── */

import { getMergedStores } from "./storeFileData";
import { normalizeSiteKey } from "./siteCode";
import type { StoreRecord } from "./types";

/**
 * Load the merged store master and build a Map for O(1) lookup.
 * Keys by siteNum (trimmed, lowercased) since DISPO rows use Site
 * numbers as the join key.
 *
 * Also keyed by normalizeSiteKey so a ledger row whose Site was Excel-mangled
 * ("R001" → "R1") still resolves its store name / province etc. Uploads repair
 * the code at load time, but this covers rows stored before that fix. Exact keys
 * are set first and win; normalized keys only fill gaps (never clobber an exact
 * match).
 */
export async function getStoreLookup(): Promise<Map<string, StoreRecord>> {
  const stores = await getMergedStores();

  const lookup = new Map<string, StoreRecord>();
  for (const store of stores) {
    // Key by siteNum (primary join key from DISPO)
    if (store.siteNum) {
      lookup.set(store.siteNum.toLowerCase().trim(), store);
    }
  }
  // Second pass: add normalized keys only where they don't shadow an exact one.
  for (const store of stores) {
    if (store.siteNum) {
      const norm = normalizeSiteKey(store.siteNum);
      if (norm && !lookup.has(norm)) lookup.set(norm, store);
    }
  }

  return lookup;
}
