/* Which parser wrote the numbers sitting in each ledger right now.

   The point of this is to answer "has this stream actually been repaired?"
   from the data rather than by comparing load timestamps against a deployment
   clock — which is how six clients were reloaded on 25 Aug 2026 by the OLD
   parser and everyone, the DISPO Checklist included, believed them fixed.

   A row with no stamp was written before stamping existed (25 Aug 2026), so it
   is NOT evidence of anything except age. Treat "unstamped" and "behind" the
   same way: reload the stream's latest DISPO. */

import { getClients } from "./clientData";
import { getAllSalesLedgers, getSalesLedger } from "./salesData";
import { PARSER_VERSION, parserVersionOf } from "./parserVersion";

export interface LedgerVersionRow {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  totalRows: number;
  /** Rows written by the current parser. */
  current: number;
  /** Rows written by an older stamped parser. */
  behind: number;
  /** Rows with no stamp at all — written before 25 Aug 2026. */
  unstamped: number;
  /** Version → row count, for the detail line. */
  byVersion: Record<string, number>;
  /** Newest `_lastLoadedAt` on any row that is NOT current — the load that
      needs redoing is at or after this. Empty when the ledger is clean. */
  staleAsOf: string;
}

export interface ParserVersionReport {
  generatedAt: string;
  currentVersion: number;
  metered: boolean;
  /** Ledgers with any row not written by the current parser, worst first. */
  stale: LedgerVersionRow[];
  /** Ledgers entirely on the current parser. */
  clean: LedgerVersionRow[];
  totals: { rows: number; current: number; behind: number; unstamped: number };
}

/** Classify one ledger's rows. Pure, so the rule is testable without a blob
    store — the whole value of this feature is that the classification is
    trustworthy. */
export function summariseRows(rows: Record<string, unknown>[]): {
  totalRows: number; current: number; behind: number; unstamped: number;
  byVersion: Record<string, number>; staleAsOf: string;
} {
  let current = 0, behind = 0, unstamped = 0;
  const byVersion: Record<string, number> = {};
  let staleAsOf = "";
  for (const row of rows) {
    const v = parserVersionOf(row);
    const key = v === null ? "unstamped" : `v${v}`;
    byVersion[key] = (byVersion[key] ?? 0) + 1;
    if (v === PARSER_VERSION) { current++; continue; }
    if (v === null) unstamped++; else behind++;
    // Newest load among the rows that still need redoing — the reload to
    // repair them is at or after this.
    const loaded = String(row["_lastLoadedAt"] ?? "");
    if (loaded > staleAsOf) staleAsOf = loaded;
  }
  return { totalRows: rows.length, current, behind, unstamped, byVersion, staleAsOf };
}

export async function auditParserVersions(): Promise<ParserVersionReport> {
  const generatedAt = new Date().toISOString();
  const empty: ParserVersionReport = {
    generatedAt, currentVersion: PARSER_VERSION, metered: false,
    stale: [], clean: [], totals: { rows: 0, current: 0, behind: 0, unstamped: 0 },
  };
  if (!process.env.BLOB_READ_WRITE_TOKEN) return empty;

  const clients = await getClients();
  const all: LedgerVersionRow[] = [];

  for (const client of clients) {
    const ledgers = await getAllSalesLedgers(client.id);
    const perLedger = await Promise.all(
      ledgers.map(async (meta) => {
        const rows = await getSalesLedger(client.id, meta.channelId);
        return {
          clientId: client.id,
          clientName: client.name,
          channelId: meta.channelId,
          channelName: meta.channelName ?? meta.channelId,
          ...summariseRows(rows),
        } as LedgerVersionRow;
      }),
    );
    all.push(...perLedger);
  }

  const isStale = (l: LedgerVersionRow) => l.behind + l.unstamped > 0;
  const stale = all.filter(isStale)
    .sort((a, b) => (b.behind + b.unstamped) - (a.behind + a.unstamped));
  const clean = all.filter((l) => !isStale(l) && l.totalRows > 0)
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  const totals = all.reduce(
    (t, l) => ({
      rows: t.rows + l.totalRows,
      current: t.current + l.current,
      behind: t.behind + l.behind,
      unstamped: t.unstamped + l.unstamped,
    }),
    { rows: 0, current: 0, behind: 0, unstamped: 0 },
  );

  return { generatedAt, currentVersion: PARSER_VERSION, metered: true, stale, clean, totals };
}
