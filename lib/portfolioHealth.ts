/* ──────────────────────────────────────────────────────────────
   Portfolio Stock Health — one channel, every client, rolled up.

   The per-store report (lib/storeReport.ts) answers "what should this rep do
   in this store today". This answers the Account Manager's question instead:
   across my whole channel, where is the stock broken, and is it getting
   better or worse. Same five measures, same definitions — they are imported
   from lib/stockFlags.ts precisely so the two reports can never drift.

   ── The grain ──────────────────────────────────────────────────
   A LINE is one SKU at one site — the DISPO row. Every count here is a count
   of lines unless it says "sites". A site appears in several rollups at once
   (a province, a site profile, a client) which is why the rollup totals agree
   with each other but a site count summed across clients does not equal the
   portfolio site count: two clients can both sell into the same store.

   ── Stale vendors are EXCLUDED, not footnoted ──────────────────
   A vendor that has stopped sending data still has its last known stock
   sitting in the ledger, and that stock reads as real. Left in, a supplier who
   went quiet in October is still "out of stock in 131 stores" every week
   forever, and the number drifts further from the truth the longer they stay
   quiet. So a stale vendor's lines are removed from EVERY figure and EVERY
   comparison period, and the vendor is named at the top of the report with the
   date of its last data. The exclusion is the point; the note is just how the
   reader finds out.

   ⚠️ The staleness threshold is deliberately NOT 7 days. Makro and Massbuild
   DISPOs are weekly files exported by hand, so a 7-day rule would drop a
   vendor every time a file landed a day late and re-admit it the next day —
   a KPI that flickers is worse than one that lags. 14 days means two missed
   weeks, which is a real signal rather than a slipped Tuesday.
   ────────────────────────────────────────────────────────────── */

import {
  computeStockFlags,
  daysElapsedInYear,
  hasAnyFlag,
  minusMonths,
  LOW_COVER_DAYS,
  MS_PER_DAY,
  PHANTOM_MONTHS,
  type StockFlagInputs,
  type StockFlags,
} from "./stockFlags";

type Row = { [k: string]: unknown };

/** Days without new data before a vendor's lines leave the report entirely. */
export const STALE_VENDOR_DAYS = 14;

export interface KpiCounts {
  oos: number;
  lowCover: number;
  phantom: number;
  negSoh: number;
  discontinued: number;
}

export function emptyCounts(): KpiCounts {
  return { oos: 0, lowCover: 0, phantom: 0, negSoh: 0, discontinued: 0 };
}

export function addCounts(into: KpiCounts, f: StockFlags): void {
  if (f.oos) into.oos++;
  if (f.lowCover) into.lowCover++;
  if (f.phantom) into.phantom++;
  if (f.negSoh) into.negSoh++;
  if (f.discontinued) into.discontinued++;
}

/** One row of a breakdown table. */
export interface BreakdownRow {
  key: string;
  label: string;
  /** Distinct sites contributing to this row. */
  sites: number;
  /** Lines in base for this row — the denominator behind the counts. */
  lines: number;
  counts: KpiCounts;
  /** Extra columns a specific breakdown carries (store name, rep, article…). */
  extra?: Record<string, string>;
}

/** A vendor whose data went quiet, and whose lines were therefore dropped. */
export interface ExcludedVendor {
  clientId: string;
  clientName: string;
  vendor: string;
  /** ISO date of its most recent load, "" when nothing was ever stamped. */
  lastData: string;
  /** How many ledger lines were removed because of it. */
  linesRemoved: number;
}

export interface PortfolioHealth {
  /** Sites carrying at least one in-base line. */
  sites: number;
  clients: number;
  /** Distinct articles flagged by at least one measure. */
  productsFlagged: number;
  /** In-base lines behind every figure. */
  activeLines: number;
  /** Every line read, before the in-base test. */
  baseLines: number;
  totals: KpiCounts;
  byProvince: BreakdownRow[];
  bySiteProfile: BreakdownRow[];
  byClient: BreakdownRow[];
  bySite: BreakdownRow[];
  byProduct: BreakdownRow[];
  excluded: ExcludedVendor[];
  /**
   * Has anyone marked which status codes mean discontinued for this channel?
   * When false the discontinued count is meaningless and the report says so
   * instead of printing a zero that reads as good news.
   */
  discontinuedConfigured: boolean;
}

export interface PortfolioInput {
  /** Enriched ledger rows for ONE channel, across every client. */
  rows: Row[];
  /** clientId → display name, for the client rollup. */
  clientNames: Map<string, string>;
  dateColumns: string[];
  /**
   * End of the report month — anchors DROS and phantom age.
   *
   * ⚠️ NOT staleness. See `asOf`: this date is in the FUTURE for most of the
   * month it describes, and measuring "when did we last hear from this vendor"
   * against it excluded every vendor in the portfolio on the first live run.
   */
  referenceDate: Date;
  /**
   * Wall-clock instant the report is being produced. Staleness alone is
   * measured against this, because "has this vendor gone quiet" is a question
   * about when a FILE ARRIVED, not about the period the data describes.
   * Defaults to now.
   */
  asOf?: Date;
  /** PR ST codes meaning discontinued for this channel (uppercased). */
  discontinuedCodes: Set<string>;
  lowCoverDays?: number;
  phantomMonths?: number;
  staleVendorDays?: number;
  /** Cap on the "most affected" tables. */
  topN?: number;
}

/** A row's client id, stamped by the loader. */
function rowClient(row: Row): string {
  return String(row["_clientId"] ?? "");
}

/**
 * Which (client, vendor) streams have gone quiet, and the rows they own.
 *
 * Freshness is read from `_lastLoadedAt`, stamped on every row at merge time.
 * A stream with NO stamp anywhere is legacy data that predates stamping — it
 * is left IN rather than dropped, because "we cannot date it" is not evidence
 * that it is stale, and dropping it would silently empty the report for any
 * client who has not re-uploaded since stamping began.
 */
export function findStaleVendors(
  rows: Row[],
  clientNames: Map<string, string>,
  /**
   * ⚠️ WALL-CLOCK NOW, not the report's reference date. `_lastLoadedAt` is the
   * moment a file arrived, so the only meaningful thing to subtract it from is
   * the present. Passing the end of the report month here — which is in the
   * future for most of that month — marks every vendor stale and empties the
   * whole report. That is exactly what happened on the first live run.
   */
  asOf: Date,
  staleDays: number,
): { excluded: ExcludedVendor[]; keyOf: (row: Row) => string; staleKeys: Set<string> } {
  const keyOf = (row: Row) => `${rowClient(row)}|${String(row["_vendor"] ?? "")}`;

  const latest = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = keyOf(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    const stamp = String(row["_lastLoadedAt"] ?? "");
    if (!stamp) continue;
    const prev = latest.get(k);
    if (prev === undefined || stamp > prev) latest.set(k, stamp);
  }

  const cutoff = asOf.getTime() - staleDays * MS_PER_DAY;
  const excluded: ExcludedVendor[] = [];
  const staleKeys = new Set<string>();

  for (const [k, stamp] of latest) {
    const t = Date.parse(stamp);
    if (isNaN(t) || t > cutoff) continue;
    const [clientId, vendor] = k.split("|");
    staleKeys.add(k);
    excluded.push({
      clientId,
      clientName: clientNames.get(clientId) ?? clientId,
      vendor,
      lastData: stamp,
      linesRemoved: counts.get(k) ?? 0,
    });
  }

  excluded.sort((a, b) => b.linesRemoved - a.linesRemoved);
  return { excluded, keyOf, staleKeys };
}

/** Accumulator that keeps a distinct-site set alongside the counts. */
interface Bucket {
  label: string;
  sites: Set<string>;
  lines: number;
  counts: KpiCounts;
  extra?: Record<string, string>;
}

function bucketFor(map: Map<string, Bucket>, key: string, label: string, extra?: Record<string, string>): Bucket {
  let b = map.get(key);
  if (!b) {
    b = { label, sites: new Set(), lines: 0, counts: emptyCounts(), extra };
    map.set(key, b);
  } else if (extra && !b.extra) {
    b.extra = extra;
  }
  return b;
}

/** Most-affected-first, by out of stock, then by the other measures. */
function toRows(map: Map<string, Bucket>, topN?: number): BreakdownRow[] {
  const rows: BreakdownRow[] = [...map.entries()].map(([key, b]) => ({
    key,
    label: b.label,
    sites: b.sites.size,
    lines: b.lines,
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

/**
 * Rolls rows up a CLIENT AT A TIME.
 *
 * The loader cannot hold every client's enriched ledger for a whole channel in
 * memory at once — that is thirty clients' worth of DISPO rows, and Month-End
 * already needs a memory bench for ONE of them. So rows arrive in batches and
 * are counted as they come, and nothing but the (small) buckets survives a
 * batch. Staleness is a property of a (client, vendor) stream, so it resolves
 * correctly inside a single client's batch and does not need a global pass.
 */
export interface PortfolioAccumulator {
  /** Fold in one client's enriched rows. */
  addRows(rows: Row[]): void;
  finish(): PortfolioHealth;
}

export function createPortfolioAccumulator(
  input: Omit<PortfolioInput, "rows">,
): PortfolioAccumulator {
  const {
    clientNames,
    dateColumns,
    referenceDate,
    asOf = new Date(),
    discontinuedCodes,
    lowCoverDays = LOW_COVER_DAYS,
    phantomMonths = PHANTOM_MONTHS,
    staleVendorDays = STALE_VENDOR_DAYS,
    topN = 10,
  } = input;

  const flagOpts: StockFlagInputs = {
    dateColumns,
    refYear: referenceDate.getUTCFullYear(),
    refMonth: referenceDate.getUTCMonth() + 1,
    daysElapsed: daysElapsedInYear(referenceDate),
    cutoff: minusMonths(referenceDate, phantomMonths),
    lowCoverDays,
    discontinuedCodes,
  };

  const totals = emptyCounts();
  const sites = new Set<string>();
  const clients = new Set<string>();
  const productsFlagged = new Set<string>();

  const provinces = new Map<string, Bucket>();
  const profiles = new Map<string, Bucket>();
  const byClient = new Map<string, Bucket>();
  const bySite = new Map<string, Bucket>();
  const byProduct = new Map<string, Bucket>();

  const excluded: ExcludedVendor[] = [];
  let activeLines = 0;
  let baseLines = 0;

  function addRows(rows: Row[]): void {
  // 1. Drop stale vendors BEFORE anything is counted, so no figure anywhere in
  //    the report — headline, breakdown or comparison — can contain them.
  const stale = findStaleVendors(rows, clientNames, asOf, staleVendorDays);
  excluded.push(...stale.excluded);
  const live = stale.staleKeys.size === 0
    ? rows
    : rows.filter((r) => !stale.staleKeys.has(stale.keyOf(r)));
  baseLines += live.length;

  for (const row of live) {
    const m = computeStockFlags(row, flagOpts);
    if (!m.inBase) continue;
    activeLines++;

    // Site code is read the same way lib/enrichment.ts reads it, casing and
    // all — a second spelling here would bucket rows the enrichment matched
    // into a different site from the one it named.
    const siteCode = String(row["Site"] ?? row["site"] ?? row["SITE"] ?? "").trim();
    const clientId = rowClient(row);
    const article = String(row["Article"] ?? "").trim();

    sites.add(siteCode);
    if (clientId) clients.add(clientId);
    addCounts(totals, m.flags);
    if (hasAnyFlag(m.flags) && article) productsFlagged.add(article);

    // Absence is a value: an unmapped store still has broken stock, and
    // bucketing it as "(no province)" keeps it in the totals where it belongs
    // instead of vanishing from a breakdown that is supposed to be complete.
    const province = String(row["_province"] ?? "").trim() || "(no province)";
    const profile = String(row["_storeType"] ?? "").trim() || "(no site profile)";
    const storeName = String(row["_storeName"] ?? row["Site Name"] ?? "").trim();
    const desc = String(row["_productDescription"] ?? row["Product Description"] ?? "").trim();

    const targets: Bucket[] = [
      bucketFor(provinces, province, province),
      bucketFor(profiles, profile, profile),
      bucketFor(byClient, clientId, clientNames.get(clientId) ?? clientId),
      bucketFor(bySite, siteCode, siteCode, { storeName, province, profile }),
      bucketFor(byProduct, article, article, { description: desc }),
    ];
    for (const b of targets) {
      b.sites.add(siteCode);
      b.lines++;
      addCounts(b.counts, m.flags);
    }
  }
  }

  function finish(): PortfolioHealth {
    excluded.sort((a, b) => b.linesRemoved - a.linesRemoved);
    return {
      sites: sites.size,
      clients: clients.size,
      productsFlagged: productsFlagged.size,
      activeLines,
      baseLines,
      totals,
      // Provinces and profiles are short lists — never truncated, because a
      // missing province reads as "we do not operate there".
      byProvince: toRows(provinces),
      bySiteProfile: toRows(profiles),
      // Clients are NEVER truncated. A snapshot is compared row-by-row against
      // an older one, and a top-10 list changes membership week to week — a
      // client that drops out would read as "no prior data" rather than as the
      // improvement that pushed it off the list. Sites and products are
      // thousands of rows, so those stay capped and their comparisons are
      // best-effort, exactly as Mark's report shows them.
      byClient: toRows(byClient),
      bySite: toRows(bySite, topN),
      byProduct: toRows(byProduct, topN),
      excluded,
      discontinuedConfigured: discontinuedCodes.size > 0,
    };
  }

  return { addRows, finish };
}

/** One-shot convenience: every row at once. Used by the tests. */
export function buildPortfolioHealth(input: PortfolioInput): PortfolioHealth {
  const acc = createPortfolioAccumulator(input);
  acc.addRows(input.rows);
  return acc.finish();
}
