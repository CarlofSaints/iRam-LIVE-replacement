/* ──────────────────────────────────────────────────────────────
   Enrichment Engine — query-time dimension enrichment

   Join path for product dimensions:
     DISPO Article → LINKS (Article → Client Product ID) → PMF Product Master

   Join path for store dimensions:
     DISPO Site → Store Master (siteNum)
   ────────────────────────────────────────────────────────────── */

import { getProductLookup } from "./productMasterData";
import { getLinksLookup, normalizeArticle } from "./linksLookup";
import { getStoreLookup } from "./storeLookup";
import { normalizeSiteKey } from "./siteCode";
import { getControlFileData } from "./controlFileData";
import {
  rangingField, rangeRowArticle, rangeRowSite,
  RANGE_PRODUCT_KEYS, RANGE_INDICATOR_KEYS,
  RANGE_CHANNEL_KEYS, RANGE_SUBCHANNEL_KEYS,
} from "./rangingFields";
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
  rangingLookup?: Set<string>,            // set of article keys that exist in ranging file
  siteRanging?: SiteRanging               // per-store range (site × article / product)
): EnrichedRow {
  const enriched: EnrichedRow = { ...row };

  // ── Product join (two-hop: Article → LINKS → Client Product ID → PMF) ──
  const articleRaw = row["Article"] ?? row["article"] ?? row["ARTICLE"];
  if (articleRaw != null) {
    // Normalize the SAME way the LINKS map is indexed (normalizeArticle strips
    // leading zeros / trailing .0) — otherwise the join silently misses and all
    // PMF fields (incl. Vendor Status) come back blank.
    const articleKey = normalizeArticle(articleRaw);

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
    // Exact key first; fall back to the padding-agnostic key so an Excel-mangled
    // site ("R001" → "R1") still resolves (storeLookup carries both).
    const store = storeLookup.get(siteKey) ?? storeLookup.get(normalizeSiteKey(siteRaw));
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

  // ── Ranging AT THIS STORE (Site × Article, or Site × Client Product ID) ──
  // `_rangingStatus` above only says "this article is in the range file for SOME
  // store". This answers for the row's own site:
  //   true      — ranged TRUE for this site and product
  //   false     — anything else in a channel the range file covers. Range files
  //               are often loaded TRUE-ONLY, so a missing row — or a whole
  //               missing store — means not ranged (Carl's call, 30 Sep 2026).
  //   undefined — no range file, or the store is in a channel the file doesn't
  //               cover (a MASSBUILD-only file says nothing about Makro stores)
  // `_rangeSiteListed` says whether the store itself appears in the file; the
  // store report's code-mismatch guard needs to tell the two FALSEs apart.
  if (siteRanging) {
    const siteKey = normalizeSiteKey(row["Site"] ?? row["site"] ?? row["SITE"]);
    const listed = !!siteKey && siteRanging.sites.has(siteKey);
    const ch = String(enriched._storeChannel ?? "").trim().toLowerCase();
    const sub = String(enriched._storeSubChannel ?? "").trim().toLowerCase();
    const channelCovered = siteRanging.trustUnlisted && (
      siteRanging.channels.size === 0 ||
      (!!ch && siteRanging.channels.has(ch)) ||
      (!!sub && siteRanging.channels.has(sub)));
    if (siteKey && (listed || channelCovered)) {
      const art = normalizeArticle(row["Article"] ?? row["article"] ?? row["ARTICLE"]);
      const cpid = String(enriched._clientProductId ?? "").toLowerCase().trim();
      enriched._rangedAtSite =
        listed &&
        ((!!art && siteRanging.ranged.has(`${siteKey}|a:${art}`)) ||
          (!!cpid && siteRanging.ranged.has(`${siteKey}|p:${cpid}`)));
      enriched._rangeSiteListed = listed;
    }
  }

  return enriched;
}

/** Per-store range, built from the range control file (long format: one row per product × site). */
export interface SiteRanging {
  sites: Set<string>;    // every site key in the range file, TRUE or FALSE
  ranged: Set<string>;   // "<site>|a:<article>" and "<site>|p:<product id>" ranged TRUE
  channels: Set<string>; // Channel + Sub_Channel values in the file (lowercase); empty = no such columns
  // May a store MISSING from the file be read as "nothing ranged there"? Only
  // when at least one store-master site matches the file's site codes. If none
  // do, the codes are in a different format ("MASSBUILD-B28" once hid every OOS
  // at every Builders store) and an unlisted store is left unjudged instead.
  trustUnlisted: boolean;
}

// Same TRUE spellings Month-End's Numerical Distribution accepts (isTrueRange there).
function isTrueRange(v: string): boolean {
  const s = v.trim().toUpperCase();
  return s === "TRUE" || s === "T" || s === "1" || s === "Y" || s === "YES";
}

export function buildSiteRanging(
  rangingRows: RawRow[],
  knownSites: Iterable<string> = [],   // store-master site codes, for the trustUnlisted check
): SiteRanging | undefined {
  const sites = new Set<string>();
  const ranged = new Set<string>();
  const channels = new Set<string>();
  for (const r of rangingRows) {
    const site = normalizeSiteKey(rangeRowSite(r));
    if (!site) continue;
    sites.add(site);
    for (const c of [rangingField(r, RANGE_CHANNEL_KEYS), rangingField(r, RANGE_SUBCHANNEL_KEYS)]) {
      if (c) channels.add(c.toLowerCase());
    }
    if (!isTrueRange(rangingField(r, RANGE_INDICATOR_KEYS))) continue;
    const art = normalizeArticle(rangeRowArticle(r));
    const cpid = rangingField(r, RANGE_PRODUCT_KEYS).toLowerCase().trim();
    if (art) ranged.add(`${site}|a:${art}`);
    if (cpid) ranged.add(`${site}|p:${cpid}`);
  }
  if (!sites.size) return undefined;
  let trustUnlisted = false;
  for (const k of knownSites) {
    if (sites.has(normalizeSiteKey(k))) { trustUnlisted = true; break; }
  }
  return { sites, ranged, channels, trustUnlisted };
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

  // Build ranging lookup — set of article keys present in ranging file.
  // Column names vary by file layout — see lib/rangingFields.ts.
  let rangingLookup: Set<string> | undefined;
  if (rangingRows.length > 0) {
    rangingLookup = new Set<string>();
    for (const r of rangingRows) {
      const article = rangeRowArticle(r).toLowerCase().trim();
      if (article) rangingLookup.add(article);
    }
  }

  const siteRanging = buildSiteRanging(rangingRows, storeLookup.keys());

  const enrichedRows = rows.map((row) =>
    enrichLedgerRow(row, linksLookup, productLookup, storeLookup, rangingLookup, siteRanging)
  );

  return {
    rows: enrichedRows,
    productCount: productLookup.size,
    storeCount: storeLookup.size,
    linksCount: linksLookup.size,
  };
}
