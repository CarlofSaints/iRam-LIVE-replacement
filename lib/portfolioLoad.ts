/* ──────────────────────────────────────────────────────────────
   Portfolio Stock Health loader — assembles one channel's whole portfolio.

   Reads every active client's ledger for a main channel (and its companions),
   enriches it, and folds it into the roll-up A CLIENT AT A TIME. The batching
   is not a style choice: this is thirty clients' worth of DISPO rows, and
   Month-End needs a memory bench for one of them. Nothing but the buckets
   survives a client.

   It deliberately mirrors the Vital Signs / Month-End read path — companion
   channel expansion, freshest-load dedupe, period resolution, date-column
   capping — so the portfolio view and the client reports are looking at the
   same universe. Where this report disagrees with a Month-End for the same
   client and channel, that is a bug in one of them, not a definition gap.
   ────────────────────────────────────────────────────────────── */

import { getActiveClients } from "./clientData";
import { getSalesLedger, getSalesLedgerMeta } from "./salesData";
import { enrichLedger } from "./enrichment";
import { getStatusDefinitions } from "./statusData";
import { getChannels } from "./channelData";
import { expandToChannelGroups, dedupeByFreshestLoad } from "./channelGroup";
import { resolveReportPeriod } from "./reportPeriod";
import { capDateColumns } from "./monthEndReport";
import {
  createPortfolioAccumulator,
  type PortfolioHealth,
} from "./portfolioHealth";
import type { PortfolioCube } from "./portfolioCube";
import type { SalesLedgerMeta } from "./types";

export interface LoadPortfolioOpts {
  /** Capture date the cube is stamped with (YYYY-MM-DD). Defaults to today. */
  date?: string;
  /** Main channel to report on. */
  channelId: string;
  year?: string | number | null;
  month?: string | number | null;
  week?: string | number | null;
  topN?: number;
}

export interface LoadedPortfolio {
  channelId: string;
  channelName: string;
  periodLabel: string;
  /** End of the report month — what every age and rate is measured against. */
  referenceDate: string;
  health: PortfolioHealth;
  /** The flagged-line cube the report page filters on. */
  cube: PortfolioCube;
  /** Clients that had no ledger at all for this channel. */
  clientsWithNoData: string[];
}

/**
 * PR ST codes meaning discontinued for a channel, uppercased.
 *
 * Empty is meaningful: it says nobody has marked any code yet, and the report
 * reports the measure as unconfigured rather than as a count of zero.
 */
export async function discontinuedCodesFor(channelIds: string[]): Promise<Set<string>> {
  const defs = await getStatusDefinitions();
  const wanted = new Set(channelIds);
  const out = new Set<string>();
  for (const d of defs) {
    if (!wanted.has(d.channelId)) continue;
    if (d.meansDiscontinued === true) out.add(d.code.trim().toUpperCase());
  }
  return out;
}

export async function loadPortfolioHealth(opts: LoadPortfolioOpts): Promise<LoadedPortfolio> {
  const allChannels = await getChannels();
  const channel = allChannels.find((c) => c.id === opts.channelId);
  const channelName = channel?.name ?? opts.channelId;

  // A Makro DISPO carries Walmart / Food Store / Cash & Carry sites, routed at
  // upload into the companion channel's own ledger. Read the group, or those
  // stores are missing from their own channel's portfolio view.
  const readChannelIds = expandToChannelGroups([opts.channelId], allChannels);

  const [clients, discontinuedCodes] = await Promise.all([
    getActiveClients(),
    discontinuedCodesFor(readChannelIds),
  ]);

  /* ── Pass 1: metas only ───────────────────────────────────────
     The report period and the date columns have to be settled BEFORE any row
     is counted — capping the columns afterwards would let a stray later month
     into the rate-of-sale that the period says is not in the report yet. Metas
     are small, so reading every client's is cheap; the rows are not, and are
     read one client at a time below. */
  const metasByClient = new Map<string, SalesLedgerMeta[]>();
  const allMetas: (SalesLedgerMeta | null)[] = [];
  const allDateCols = new Set<string>();

  for (const client of clients) {
    const metas = await Promise.all(
      readChannelIds.map((chId) => getSalesLedgerMeta(client.id, chId)),
    );
    const present = metas.filter((m): m is SalesLedgerMeta => !!m);
    if (present.length) metasByClient.set(client.id, present);
    allMetas.push(...metas);
    for (const m of present) for (const dc of m.dateColumns ?? []) allDateCols.add(dc);
  }

  const period = resolveReportPeriod(allMetas, {
    year: opts.year ?? null,
    month: opts.month ?? null,
    week: opts.week ?? null,
  });
  const capped = capDateColumns(Array.from(allDateCols), period.year, period.month);
  const dateColumns = capped.kept;

  // Anchor: last day of the report month, UTC. Day 0 of the NEXT month is that
  // day, and it keeps the anchor independent of when the report happens to run.
  const referenceDate = new Date(Date.UTC(period.year, period.month, 0));

  const clientNames = new Map<string, string>();
  for (const c of clients) clientNames.set(c.id, c.name);

  const acc = createPortfolioAccumulator({
    clientNames,
    dateColumns,
    referenceDate,
    discontinuedCodes,
    topN: opts.topN,
  });

  /* ── Pass 2: one client's rows at a time ──────────────────── */
  const clientsWithNoData: string[] = [];

  for (const client of clients) {
    if (!metasByClient.has(client.id)) {
      clientsWithNoData.push(client.name);
      continue;
    }

    const ledgers = await Promise.all(
      readChannelIds.map((chId) => getSalesLedger(client.id, chId)),
    );
    const rows = ledgers.flat();
    if (rows.length === 0) {
      clientsWithNoData.push(client.name);
      continue;
    }

    // One row per Article|Site, freshest load winning — the companion ledgers
    // mean a re-homed store otherwise appears twice, once live and once as the
    // frozen pre-split copy.
    const deduped = dedupeByFreshestLoad(rows, dateColumns);
    const enriched = await enrichLedger(deduped.rows, client.id);

    // The engine groups by client, and an enriched row does not carry one.
    for (const row of enriched.rows) row["_clientId"] = client.id;

    acc.addRows(enriched.rows);
  }

  return {
    channelId: opts.channelId,
    channelName,
    periodLabel: period.label,
    referenceDate: referenceDate.toISOString(),
    health: acc.finish(),
    cube: acc.cube(opts.channelId, opts.date ?? new Date().toISOString().slice(0, 10)),
    clientsWithNoData,
  };
}
