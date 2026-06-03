/* ──────────────────────────────────────────────────────────────
   Store Dimension Lookup — reads from merged store master
   ────────────────────────────────────────────────────────────── */

import { getMergedStores } from "./storeFileData";
import type { StoreRecord } from "./types";

/**
 * Load the merged store master and build a Map for O(1) lookup.
 * Keys by siteNum (trimmed, lowercased) since DISPO rows use Site
 * numbers as the join key.
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

  return lookup;
}
