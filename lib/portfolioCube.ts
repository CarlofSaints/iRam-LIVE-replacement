/* ──────────────────────────────────────────────────────────────
   The filterable cube behind Portfolio Stock Health.

   ── Why a cube, and not just more query params ─────────────────
   Filtering server-side would mean re-reading every client's ledger for the
   channel on every click — twenty-odd seconds on Massbuild's 205 798 lines.
   Nobody explores a report at twenty seconds a click, so the filtering has to
   happen in the browser, which means the browser needs the facts.

   ── Why it fits ────────────────────────────────────────────────
   It only carries FLAGGED lines. Every tile and every table on the report
   counts something that is wrong, so a line with nothing wrong with it can
   never change a number on the page. That is the difference between 205 798
   rows and roughly 60 000.

   Then the strings come out. Site codes, client names and article codes repeat
   thousands of times each, so they go in dictionaries and each row carries
   three integers and a bitmask instead. A row is `[siteIdx, clientIdx,
   articleIdx, flags]` — about fourteen bytes of JSON, against a few hundred
   for the object it replaces. Massbuild lands around a megabyte, comfortably
   inside the 4.5MB body limit, and the page can then recompute every tile and
   every table on a click with no round trip at all.

   ── This file must stay client-safe ────────────────────────────
   ⚠️ It is imported by the report PAGE, which is a client component. Do not
   import anything here that reaches lib/blob.ts or node:fs — lib/stockFlags
   does, through monthEndReport, which is why the flag shapes are redeclared
   below rather than imported. Types only, no runtime imports.
   ────────────────────────────────────────────────────────────── */

/** Bit per measure. A line can carry several at once, which is the point. */
export const FLAG_OOS = 1;
export const FLAG_LOW = 2;
export const FLAG_PHANTOM = 4;
export const FLAG_NEG = 8;
export const FLAG_DISC = 16;

export interface CubeSite {
  code: string;
  name: string;
  province: string;
  profile: string;
}

export interface CubeClient {
  id: string;
  name: string;
}

export interface CubeArticle {
  code: string;
  description: string;
}

/** One flagged line: indexes into the dictionaries, plus its flag bits. */
export type CubeRow = [site: number, client: number, article: number, flags: number];

export interface PortfolioCube {
  version: 1;
  channelId: string;
  /** Capture date this cube belongs to, so a stale fetch is detectable. */
  date: string;
  sites: CubeSite[];
  clients: CubeClient[];
  articles: CubeArticle[];
  rows: CubeRow[];
  /** In-base lines behind the whole channel, for the coverage line. */
  activeLines: number;
}

export interface CubeCounts {
  oos: number;
  lowCover: number;
  phantom: number;
  negSoh: number;
  discontinued: number;
}

export interface CubeBreakdownRow {
  key: string;
  label: string;
  sites: number;
  counts: CubeCounts;
  extra?: Record<string, string>;
}

/** Which dimensions are being filtered on. Empty array = no filter on it. */
export interface CubeFilter {
  provinces: string[];
  profiles: string[];
  clients: string[];
  sites: string[];
  articles: string[];
}

export function emptyFilter(): CubeFilter {
  return { provinces: [], profiles: [], clients: [], sites: [], articles: [] };
}

export function filterIsEmpty(f: CubeFilter): boolean {
  return (
    f.provinces.length === 0 &&
    f.profiles.length === 0 &&
    f.clients.length === 0 &&
    f.sites.length === 0 &&
    f.articles.length === 0
  );
}

export type CubeDimension = keyof CubeFilter;

/** Toggle one value on one dimension. Clicking the same row again clears it. */
export function toggleFilter(f: CubeFilter, dim: CubeDimension, value: string): CubeFilter {
  const current = f[dim];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...f, [dim]: next };
}

function zero(): CubeCounts {
  return { oos: 0, lowCover: 0, phantom: 0, negSoh: 0, discontinued: 0 };
}

function add(into: CubeCounts, flags: number): void {
  if (flags & FLAG_OOS) into.oos++;
  if (flags & FLAG_LOW) into.lowCover++;
  if (flags & FLAG_PHANTOM) into.phantom++;
  if (flags & FLAG_NEG) into.negSoh++;
  if (flags & FLAG_DISC) into.discontinued++;
}

interface Bucket {
  label: string;
  sites: Set<number>;
  counts: CubeCounts;
  extra?: Record<string, string>;
}

function bucket(map: Map<string, Bucket>, key: string, label: string, extra?: Record<string, string>): Bucket {
  let b = map.get(key);
  if (!b) {
    b = { label, sites: new Set(), counts: zero(), extra };
    map.set(key, b);
  }
  return b;
}

function toRows(map: Map<string, Bucket>, topN?: number): CubeBreakdownRow[] {
  const rows = [...map.entries()].map(([key, b]) => ({
    key,
    label: b.label,
    sites: b.sites.size,
    counts: b.counts,
    extra: b.extra,
  }));
  rows.sort((a, b) => {
    if (b.counts.oos !== a.counts.oos) return b.counts.oos - a.counts.oos;
    if (b.counts.phantom !== a.counts.phantom) return b.counts.phantom - a.counts.phantom;
    return a.label.localeCompare(b.label);
  });
  return topN && topN > 0 ? rows.slice(0, topN) : rows;
}

export interface CubeView {
  totals: CubeCounts;
  /** Sites carrying at least one flagged line under the current filter. */
  sites: number;
  clients: number;
  products: number;
  /** Flagged lines under the current filter. */
  lines: number;
  byProvince: CubeBreakdownRow[];
  bySiteProfile: CubeBreakdownRow[];
  byClient: CubeBreakdownRow[];
  bySite: CubeBreakdownRow[];
  byProduct: CubeBreakdownRow[];
}

/**
 * Recompute every figure on the report under a filter.
 *
 * ⚠️ A dimension does NOT filter its own breakdown. Click Western Cape and the
 * province table must keep showing every province — otherwise the table you
 * just clicked collapses to the single row you picked and there is no way to
 * see what else there was, or to switch to Gauteng without first clearing.
 * Every OTHER table narrows, which is the drill-down; the one you are
 * filtering on stays whole and shows the selection highlighted. This mirrors
 * how a pivot filter behaves and is the difference between exploring and
 * getting stuck.
 */
export function aggregateCube(cube: PortfolioCube, filter: CubeFilter, topN = 10): CubeView {
  const provSel = new Set(filter.provinces);
  const profSel = new Set(filter.profiles);
  const clientSel = new Set(filter.clients);
  const siteSel = new Set(filter.sites);
  const artSel = new Set(filter.articles);

  const totals = zero();
  const siteSeen = new Set<number>();
  const clientSeen = new Set<number>();
  const articleSeen = new Set<number>();
  let lines = 0;

  const provinces = new Map<string, Bucket>();
  const profiles = new Map<string, Bucket>();
  const byClient = new Map<string, Bucket>();
  const bySite = new Map<string, Bucket>();
  const byProduct = new Map<string, Bucket>();

  for (const [si, ci, ai, flags] of cube.rows) {
    const site = cube.sites[si];
    const client = cube.clients[ci];
    const article = cube.articles[ai];
    if (!site || !client || !article) continue;

    // Each dimension's own match, kept separately so a table can be built
    // from "everything except my own filter".
    const okProv = provSel.size === 0 || provSel.has(site.province);
    const okProf = profSel.size === 0 || profSel.has(site.profile);
    const okClient = clientSel.size === 0 || clientSel.has(client.id);
    const okSite = siteSel.size === 0 || siteSel.has(site.code);
    const okArt = artSel.size === 0 || artSel.has(article.code);

    const all = okProv && okProf && okClient && okSite && okArt;

    if (all) {
      lines++;
      add(totals, flags);
      siteSeen.add(si);
      clientSeen.add(ci);
      articleSeen.add(ai);
    }

    if (okProf && okClient && okSite && okArt) {
      const b = bucket(provinces, site.province, site.province);
      b.sites.add(si);
      add(b.counts, flags);
    }
    if (okProv && okClient && okSite && okArt) {
      const b = bucket(profiles, site.profile, site.profile);
      b.sites.add(si);
      add(b.counts, flags);
    }
    if (okProv && okProf && okSite && okArt) {
      const b = bucket(byClient, client.id, client.name);
      b.sites.add(si);
      add(b.counts, flags);
    }
    if (okProv && okProf && okClient && okArt) {
      const b = bucket(bySite, site.code, site.code, {
        storeName: site.name,
        province: site.province,
        profile: site.profile,
      });
      b.sites.add(si);
      add(b.counts, flags);
    }
    if (okProv && okProf && okClient && okSite) {
      const b = bucket(byProduct, article.code, article.code, { description: article.description });
      b.sites.add(si);
      add(b.counts, flags);
    }
  }

  return {
    totals,
    sites: siteSeen.size,
    clients: clientSeen.size,
    products: articleSeen.size,
    lines,
    byProvince: toRows(provinces),
    bySiteProfile: toRows(profiles),
    byClient: toRows(byClient, topN),
    bySite: toRows(bySite, topN),
    byProduct: toRows(byProduct, topN),
  };
}

/** Human label for a filter chip. */
export function filterLabel(dim: CubeDimension, value: string, cube: PortfolioCube | null): string {
  if (dim === "clients" && cube) {
    return cube.clients.find((c) => c.id === value)?.name ?? value;
  }
  return value;
}

export const DIMENSION_LABELS: Record<CubeDimension, string> = {
  provinces: "Province",
  profiles: "Site profile",
  clients: "Client",
  sites: "Site",
  articles: "Product",
};
