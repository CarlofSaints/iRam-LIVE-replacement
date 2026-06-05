/* ──────────────────────────────────────────────────────────────
   Enrichment Engine — query-time dimension enrichment

   Join path for product dimensions:
     DISPO Article → LINKS (Article → Client Product ID) → PMF Product Master

   Join path for store dimensions:
     DISPO Site → Store Master (siteNum)
   ────────────────────────────────────────────────────────────── */

import { getProductLookup } from "./productMasterData";
import { getLinksLookup } from "./linksLookup";
import { getStoreLookup } from "./storeLookup";
import { getControlFileData } from "./controlFileData";
import type { ProductMaster, StoreRecord } from "./types";

type RawRow = Record<string, unknown>;
type EnrichedRow = Record<string, unknown>;

/**
 * Enrich a single row with product + store dimensions.
 * Prefixed field names avoid collisions with original data.
 *
 * Product fields (from ProductMaster via LINKS join):
 *   _clientProductId, _brand, _category, _subCategory, _productStatus,
 *   _productDescription, _barcode
 *
 * Store fields (from StoreRecord):
 *   _province, _townCity, _storeName, _storeChannel, _storeSubChannel,
 *   _clusterCode, _clusterName, _storeStatus, _storeType
 */
export function enrichLedgerRow(
  row: RawRow,
  linksLookup: Map<string, string>,      // article → clientProductId
  productLookup: Map<string, ProductMaster>,
  storeLookup: Map<string, StoreRecord>,
  rangingLookup?: Set<string>             // set of article keys that exist in ranging file
): EnrichedRow {
  const enriched: EnrichedRow = { ...row };

  // ── Product join (two-hop: Article → LINKS → Client Product ID → PMF) ──
  const articleRaw = row["Article"] ?? row["article"] ?? row["ARTICLE"];
  if (articleRaw != null) {
    const articleKey = String(articleRaw).toLowerCase().trim();

    // Step 1: Article → Client Product ID (via LINKS)
    const cpid = linksLookup.get(articleKey);
    enriched._clientProductId = cpid ?? "";

    // Step 2: Client Product ID → Product dimensions (via PMF master)
    const product = cpid ? productLookup.get(cpid.toLowerCase().trim()) : undefined;
    if (product) {
      enriched._brand = product.brand ?? "";
      enriched._category = product.category ?? "";
      enriched._subCategory = product.subCategory ?? "";
      enriched._productStatus = product.status ?? "";
      enriched._productDescription = product.description ?? "";
      enriched._barcode = product.barcode ?? "";
    } else {
      enriched._brand = "";
      enriched._category = "";
      enriched._subCategory = "";
      enriched._productStatus = "";
      enriched._productDescription = "";
      enriched._barcode = "";
    }
  }

  // ── Store join (by Site field) ──
  const siteRaw = row["Site"] ?? row["site"] ?? row["SITE"];
  if (siteRaw != null) {
    const siteKey = String(siteRaw).toLowerCase().trim();
    const store = storeLookup.get(siteKey);
    if (store) {
      enriched._province = store.province ?? "";
      enriched._townCity = store.townCity ?? "";
      enriched._storeName = store.storeName ?? "";
      enriched._storeChannel = store.channel ?? "";
      enriched._storeSubChannel = store.subChannel ?? "";
      enriched._clusterCode = store.clusterCode ?? "";
      enriched._clusterName = store.clusterName ?? "";
      enriched._storeStatus = store.status ?? "";
      enriched._storeType = store.type ?? "";
    } else {
      enriched._province = "";
      enriched._townCity = "";
      enriched._storeName = "";
      enriched._storeChannel = "";
      enriched._storeSubChannel = "";
      enriched._clusterCode = "";
      enriched._clusterName = "";
      enriched._storeStatus = "";
      enriched._storeType = "";
    }
  }

  // ── Ranging enrichment (by Article) ──
  if (rangingLookup) {
    const articleRaw2 = row["Article"] ?? row["article"] ?? row["ARTICLE"];
    if (articleRaw2 != null) {
      const articleKey2 = String(articleRaw2).toLowerCase().trim();
      enriched._rangingStatus = rangingLookup.has(articleKey2);
    } else {
      enriched._rangingStatus = false;
    }
  } else {
    enriched._rangingStatus = false;
  }

  return enriched;
}

/**
 * Enrich an array of ledger rows with product + store dimensions.
 * Loads all three lookups in parallel, then enriches all rows.
 */
export async function enrichLedger(
  rows: RawRow[],
  clientId: string
): Promise<{
  rows: EnrichedRow[];
  productCount: number;
  storeCount: number;
  linksCount: number;
}> {
  const [linksLookup, productLookup, storeLookup, rangingRows] = await Promise.all([
    getLinksLookup(clientId),
    getProductLookup(clientId),
    getStoreLookup(),
    getControlFileData<Record<string, unknown>>(clientId, "ranging"),
  ]);

  // Build ranging lookup — set of article keys present in ranging file
  let rangingLookup: Set<string> | undefined;
  if (rangingRows.length > 0) {
    rangingLookup = new Set<string>();
    for (const r of rangingRows) {
      const article = String(
        r["Article"] ?? r["article"] ?? r["ARTICLE"] ?? ""
      ).toLowerCase().trim();
      if (article) rangingLookup.add(article);
    }
  }

  const enrichedRows = rows.map((row) =>
    enrichLedgerRow(row, linksLookup, productLookup, storeLookup, rangingLookup)
  );

  return {
    rows: enrichedRows,
    productCount: productLookup.size,
    storeCount: storeLookup.size,
    linksCount: linksLookup.size,
  };
}
