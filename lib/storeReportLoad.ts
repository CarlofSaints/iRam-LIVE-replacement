/* ──────────────────────────────────────────────────────────────
   Store Report loader — assembles a live StoreReport for one store.

   Pulls every participating client's DISPO ledgers from Blob, filters to the
   one site code, enriches the (small) per-store subset with PMF / store /
   ranging dimensions, scopes the status rules to each client's channels, and
   runs the pure engine (lib/storeReport.ts).

   Used by both the on-demand preview / test-send and (later) the check-in
   trigger — same code path, so what a rep gets is exactly what we preview.
   ────────────────────────────────────────────────────────────── */

import { getClients } from "./clientData";
import { getAllSalesLedgers, getSalesLedger } from "./salesData";
import { enrichLedger } from "./enrichment";
import { getStatusDefinitions } from "./statusData";
import { getStatusScenarios } from "./statusScenarioData";
import { getMergedStores } from "./storeFileData";
import { buildStoreReport, type ClientStoreInput, type StoreReport } from "./storeReport";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export interface LoadStoreReportOpts {
  siteCode: string;
  clientIds?: string[];        // omit → all clients with sendConsolidatedStoreReports
  year?: number;
  month?: number;
  week?: number;
}

export interface LoadedStoreReport {
  report: StoreReport;
  year: number;
  month: number;
  week: number;
  periodLabel: string;         // "Wk 4 · Jun 2026"
}

export async function loadStoreReport(opts: LoadStoreReportOpts): Promise<LoadedStoreReport> {
  const site = norm(opts.siteCode);
  const allClients = await getClients();
  const clients = opts.clientIds && opts.clientIds.length
    ? allClients.filter((c) => opts.clientIds!.includes(c.id))
    : allClients.filter((c) => c.sendConsolidatedStoreReports);

  const [statusDefs, allScenarios] = await Promise.all([
    getStatusDefinitions(),
    getStatusScenarios(),
  ]);

  const inputs: ClientStoreInput[] = [];

  // Collect stamped periods so we can default to the latest one.
  const periods: { y: number; m: number; w: number }[] = [];

  for (const client of clients) {
    const ledgers = await getAllSalesLedgers(client.id);
    if (!ledgers.length) continue;

    const rows: Record<string, unknown>[] = [];
    const dateCols = new Set<string>();
    const channelIds: string[] = [];

    for (const meta of ledgers) {
      if (meta.reportYear) periods.push({ y: meta.reportYear, m: meta.reportMonth ?? 1, w: meta.reportWeek ?? 1 });
      for (const dc of meta.dateColumns ?? []) dateCols.add(dc);
      const ledger = await getSalesLedger(client.id, meta.channelId);
      const filtered = ledger.filter((r) => norm(r["Site"]) === site);
      if (filtered.length) {
        rows.push(...filtered);
        channelIds.push(meta.channelId);
      }
    }

    if (!rows.length) continue;

    const enriched = await enrichLedger(rows, client.id);
    const scenarios = allScenarios.filter((s) => channelIds.includes(s.channelId));

    inputs.push({
      clientId: client.id,
      clientName: client.name,
      rows: enriched.rows,
      dateColumns: Array.from(dateCols),
      statusDefs,
      scenarios,
      hasRanging: !!client.controlFiles?.ranging,
    });
  }

  periods.sort((a, b) => b.y - a.y || b.m - a.m || b.w - a.w);
  const best = periods[0];
  const now = new Date();
  const year = opts.year ?? best?.y ?? now.getUTCFullYear();
  const month = opts.month ?? best?.m ?? (now.getUTCMonth() + 1);
  const week = opts.week ?? best?.w ?? 1;

  // Phantom / DROS anchor = last day of the report month.
  const referenceDate = new Date(Date.UTC(year, month, 0));

  const report = buildStoreReport(inputs, { siteCode: opts.siteCode, referenceDate });
  const periodLabel = `Wk ${week} · ${MONTHS[month] || month} ${year}`;

  return { report, year, month, week, periodLabel };
}

// ── Store picker — distinct sites that have data for the given clients ────────

export interface StorePickEntry {
  siteCode: string;
  siteName: string;
  subChannel: string;
}

export async function listStoresForClients(clientIds?: string[]): Promise<StorePickEntry[]> {
  const allClients = await getClients();
  const clients = clientIds && clientIds.length
    ? allClients.filter((c) => clientIds.includes(c.id))
    : allClients.filter((c) => c.sendConsolidatedStoreReports);

  const stores = await getMergedStores();
  const storeByCode = new Map<string, { name: string; sub: string }>();
  for (const s of stores) {
    storeByCode.set(norm(s.siteNum), { name: s.storeName || "", sub: s.subChannel || s.channel || "" });
  }

  const seen = new Set<string>();
  const out: StorePickEntry[] = [];
  for (const client of clients) {
    const ledgers = await getAllSalesLedgers(client.id);
    for (const meta of ledgers) {
      const ledger = await getSalesLedger(client.id, meta.channelId);
      for (const r of ledger) {
        const code = String(r["Site"] ?? "").trim();
        if (!code) continue;
        const key = norm(code);
        if (seen.has(key)) continue;
        seen.add(key);
        const info = storeByCode.get(key);
        out.push({ siteCode: code, siteName: info?.name || "", subChannel: info?.sub || "" });
      }
    }
  }

  out.sort((a, b) => (a.subChannel || "").localeCompare(b.subChannel || "") || (a.siteName || a.siteCode).localeCompare(b.siteName || b.siteCode));
  return out;
}

// "26 Jun 2026 at 13:36" in SA local time.
export function formatGeneratedAt(d: Date = new Date()): string {
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });
  return `${date} at ${time}`;
}
