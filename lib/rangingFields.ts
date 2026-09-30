/* ──────────────────────────────────────────────────────────────
   Range-file column names — ONE place every reader takes them from.

   Range files arrive in more than one layout:
     • HelperProductID / HelperArticleChannelCode / HelperSiteCode /
       MandatoryRangeIndicator   (Helper/Mandatory-prefixed)
     • Product ID / Channel Article / Site Num / Range Indicator
       (e.g. PROGRESSIVE IMPRESSIONS, Channel Article = "MASSBUILD-171220-EA")
   Only knowing the first layout meant the second matched NO store at all, so
   the store report showed Ranging "—" and Month-End ND had no universe.
   ────────────────────────────────────────────────────────────── */

export const RANGE_SITE_KEYS = ["sitecode", "sitenum", "sitenumber", "site"];
export const RANGE_ARTICLE_KEYS = ["articlechannelcode", "channelarticle", "article"];
export const RANGE_PRODUCT_KEYS = ["productid"];
export const RANGE_INDICATOR_KEYS = ["rangeindicator", "range"];
export const RANGE_CHANNEL_KEYS = ["channel"];
export const RANGE_SUBCHANNEL_KEYS = ["subchannel"];

/** Resolve a range-file field, tolerating Helper/Mandatory prefixes + spacing/underscores. */
export function rangingField(row: Record<string, unknown>, targets: string[]): string {
  for (const [k, v] of Object.entries(row)) {
    const nk = k
      .trim()
      .toLowerCase()
      .replace(/^helper/, "")
      .replace(/^mandatory/, "")
      .replace(/[\s_]+/g, "");
    if (targets.includes(nk)) return v == null ? "" : String(v).trim();
  }
  return "";
}

/**
 * The DISPO article inside a range-file article code. "Channel Article" wraps
 * it as <CHANNEL>-<article>-<unit> ("MASSBUILD-171220-EA" → "171220"); a plain
 * code is returned as-is.
 */
export function rangeArticleCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^[A-Za-z][A-Za-z ]*-(.+)-[A-Za-z]+$/) ?? s.match(/^[A-Za-z][A-Za-z ]*-(\d+)$/);
  return m ? m[1].trim() : s;
}

/** The article from a range row, unwrapped. */
export function rangeRowArticle(row: Record<string, unknown>): string {
  return rangeArticleCode(rangingField(row, RANGE_ARTICLE_KEYS));
}
