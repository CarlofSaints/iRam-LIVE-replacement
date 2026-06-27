/* ──────────────────────────────────────────────────────────────
   Store Report loader — assembles a live StoreReport for one store.

   Pulls every participating client's DISPO ledgers from Blob, filters to the
   one site code, enriches the (small) per-store subset with PMF / store /
   ranging dimensions, scopes the status rules to each client's channels, and
   runs the pure engine (lib/storeReport.ts).

   Used by both the on-demand preview / test-send and (later) the check-in
   trigger — same code path, so what a rep gets is exactly what we preview.
   ────────────────────────────────────────────────────────────── */

import { existsSync } from "fs";
import { join } from "path";
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

// Keep only SKUs from the LATEST DISPO load, per vendor. Each row is stamped at
// merge time with `_vendor` + `_lastLoadedAt`; for each vendor the newest stamp
// is the latest load, and rows with an older stamp are stale (dropped out of a
// later DISPO) so their point-in-time fields (STATUS/SOH/SOO/SIT) are invalid.
// Rows with no stamp (legacy, pre-stamping) are kept until that vendor is
// re-uploaded (then the stamped rows win and the legacy ones drop).
export function latestLoadPerVendor<T extends Record<string, unknown>>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const v = String(r["_vendor"] ?? "");
    (groups.get(v) ?? groups.set(v, []).get(v)!).push(r);
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    let max = "";
    for (const r of g) { const s = String(r["_lastLoadedAt"] ?? ""); if (s > max) max = s; }
    if (!max) { out.push(...g); continue; }          // no stamps → legacy, keep all
    for (const r of g) if (String(r["_lastLoadedAt"] ?? "") === max) out.push(r);
  }
  return out;
}

export interface LoadStoreReportOpts {
  siteCode: string;
  clientIds?: string[];        // omit → all clients with sendConsolidatedStoreReports
  year?: number;
  month?: number;
  week?: number;
  excludedStreams?: string[];  // `${clientId}|${channelId}|${vendor}` to omit (per-week exclusions)
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
  // All date columns across every client — the latest one is the data's true
  // "as of" month, which we anchor age / DROS / phantom to.
  const allDateCols = new Set<string>();
  // Per-client data freshness (latest loaded period + when), shown on the report.
  const freshness = new Map<string, { y: number; m: number; w: number; loadedAt: string }>();

  for (const client of clients) {
    const ledgers = await getAllSalesLedgers(client.id);
    if (!ledgers.length) continue;

    const rows: Record<string, unknown>[] = [];
    const dateCols = new Set<string>();
    const channelIds: string[] = [];
    let cBest: { y: number; m: number; w: number } | null = null;
    let cLoadedAt = "";

    const excluded = new Set(opts.excludedStreams ?? []);
    for (const meta of ledgers) {
      if (meta.reportYear) periods.push({ y: meta.reportYear, m: meta.reportMonth ?? 1, w: meta.reportWeek ?? 1 });
      // Skip a channel stream that's been excluded for this week.
      const streamId = `${client.id}|${meta.channelId}|${meta.vendorNumber ?? ""}`;
      if (excluded.has(streamId)) continue;
      // Track this client's freshest loaded period + load timestamp.
      if (meta.reportYear) {
        const cand = { y: meta.reportYear, m: meta.reportMonth ?? 1, w: meta.reportWeek ?? 1 };
        if (!cBest || cand.y > cBest.y || (cand.y === cBest.y && cand.m > cBest.m) || (cand.y === cBest.y && cand.m === cBest.m && cand.w > cBest.w)) cBest = cand;
      }
      if (meta.lastMergedAt && meta.lastMergedAt > cLoadedAt) cLoadedAt = meta.lastMergedAt;
      for (const dc of meta.dateColumns ?? []) { dateCols.add(dc); allDateCols.add(dc); }
      const ledger = await getSalesLedger(client.id, meta.channelId);
      // Latest load per vendor only — drop SKUs that fell out of a later DISPO.
      const filtered = latestLoadPerVendor(ledger.filter((r) => norm(r["Site"]) === site));
      if (filtered.length) {
        rows.push(...filtered);
        channelIds.push(meta.channelId);
      }
    }

    if (!rows.length) continue;
    if (cBest) freshness.set(client.id, { ...cBest, loadedAt: cLoadedAt });

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

  // Reference ("as of") date = end of the LATEST month present in the data, so
  // "days since last sold/received", DROS and the phantom cutoff are measured
  // against the data's own latest month — not a stale stamped period (which can
  // sit before the actual Last Sold dates and make recent dates clamp to 0d).
  let referenceDate = new Date(Date.UTC(year, month, 0));
  let latestKey = 0;
  for (const col of allDateCols) {
    const m = col.match(/^(\d{2})-(\d{4})$/);
    if (!m) continue;
    const key = Number(m[2]) * 100 + Number(m[1]);
    if (key > latestKey) {
      latestKey = key;
      referenceDate = new Date(Date.UTC(Number(m[2]), Number(m[1]), 0));
    }
  }

  const report = buildStoreReport(inputs, { siteCode: opts.siteCode, referenceDate });

  // Attach per-client freshness ("data as of …") to the participating clients.
  const fmtLoaded = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Johannesburg" });
  };
  report.clients = report.clients.map((c) => {
    const f = freshness.get(c.clientId);
    if (!f) return c;
    return { ...c, asOf: `Wk ${f.w} · ${MONTHS[f.m] || f.m} ${f.y}`, loadedAt: fmtLoaded(f.loadedAt) };
  });

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

// ── Footer logos ─────────────────────────────────────────────────────────────
// iRam + OuterJoin are fixed brand marks; the retailer mark is chosen from the
// store's sub-channel / channel. All served as hosted files (so they render in
// Outlook, which blocks data-URL images). Drop new retailer files into
// public/brand/retailers/ and add the mapping below.
// Builders covers BWH, BEX, BTD, SS (and the MASSBUILD main channel).
const RETAILER_FILE: Record<string, string> = {
  makro: "makro.jpg",
  "makro-liquor": "makro.jpg",
  massbuild: "builders.jpg",
  builders: "builders.jpg",
  "builders warehouse": "builders.jpg",
  bwh: "builders.jpg",
  bex: "builders.jpg",
  btd: "builders.jpg",
  ss: "builders.jpg",
  bss: "builders.jpg",
  game: "game.png",
};

export function storeReportLogos(origin: string, subChannel: string): {
  iramLogoUrl: string;
  outerjoinLogoUrl: string;
  retailerLogoUrl?: string;
} {
  const file = RETAILER_FILE[norm(subChannel)];
  let retailerLogoUrl: string | undefined;
  if (file) {
    // Only advertise the URL if the file actually ships (else fall back to text).
    try {
      if (existsSync(join(process.cwd(), "public", "brand", "retailers", file))) {
        retailerLogoUrl = `${origin}/brand/retailers/${file}`;
      }
    } catch { /* ignore — fall back to text */ }
  }
  return {
    iramLogoUrl: `${origin}/brand/iram.png`,
    outerjoinLogoUrl: `${origin}/brand/outerjoin.png`,
    retailerLogoUrl,
  };
}

// "26 Jun 2026 at 13:36" in SA local time.
export function formatGeneratedAt(d: Date = new Date()): string {
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });
  return `${date} at ${time}`;
}
