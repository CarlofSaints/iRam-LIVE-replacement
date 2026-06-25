/* ──────────────────────────────────────────────────────────────
   DISPO load checklist — shared computation

   Builds the (client × channel × vendor) load-stream grid across the most
   recent N stamped (year, month, week) periods, folding in the per-period
   exclusions + armed state. Used by the checklist API and by the arm route's
   gate so both agree on what "outstanding" means.
   ────────────────────────────────────────────────────────────── */

import type { UploadMeta, Client } from "./types";
import type { StoreReportState } from "./storeReportState";
import { periodKey } from "./storeReportState";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// How many of the most recent (year, month, week) periods to show as columns.
export const CHECKLIST_WINDOW = 8;

export interface Period { year: number; month: number; week: number; key: string; label: string }
export type CellState = "loaded" | "excluded" | "outstanding" | "na";
export interface Cell { state: CellState; date?: string; count?: number }
export interface ChecklistRow {
  clientId: string;
  clientName: string;
  active: boolean;
  channelId: string;
  channelName: string;
  vendorNumber: string;
  streamId: string;
  placeholder: boolean;
  cells: Record<string, Cell>;
}
export interface PeriodSummary {
  loaded: number;
  excluded: number;
  outstanding: number;
  armed: boolean;
  armable: boolean; // outstanding === 0 AND at least one stream loaded
}
export interface ChecklistResult {
  periods: Period[];
  rows: ChecklistRow[];
  perPeriod: Record<string, PeriodSummary>;
  activePeriodKey: string | null;
}

const periodScore = (y: number, m: number, w: number) => y * 10000 + m * 100 + w;
const streamId = (clientId: string, channelId: string, vendor: string) => `${clientId}|${channelId}|${vendor}`;

export function buildChecklist(
  uploads: UploadMeta[],
  clients: Client[],
  state: StoreReportState,
): ChecklistResult {
  // Only DISPO loads stamped with a full period can be placed.
  const dispos = uploads.filter(
    (u) =>
      u.fileType === "dispo" &&
      u.status === "processed" &&
      u.reportYear != null &&
      u.reportMonth != null &&
      u.reportWeek != null,
  );

  // Columns = the most recent WINDOW distinct (year, month, week) periods.
  const periodMap = new Map<string, Period>();
  for (const u of dispos) {
    const y = u.reportYear!, m = u.reportMonth!, w = u.reportWeek!;
    const key = periodKey(y, m, w);
    if (!periodMap.has(key)) {
      periodMap.set(key, { year: y, month: m, week: w, key, label: `Wk${w} ${MON[m] ?? m} ${y}` });
    }
  }
  const periods = [...periodMap.values()]
    .sort((a, b) => periodScore(b.year, b.month, b.week) - periodScore(a.year, a.month, a.week))
    .slice(0, CHECKLIST_WINDOW)
    .reverse();
  const periodKeys = new Set(periods.map((p) => p.key));

  // Discover each client's real load streams from history (any period).
  const streams = new Map<string, { clientId: string; channelId: string; channelName: string; vendor: string }>();
  for (const u of dispos) {
    const vendor = (u.vendorNumber || "").trim();
    const id = streamId(u.clientId, u.channelId, vendor);
    if (!streams.has(id)) {
      streams.set(id, { clientId: u.clientId, channelId: u.channelId, channelName: u.channelName, vendor });
    }
  }

  // Loaded cells (within the window): stream|period → latest date + count.
  const loadedIndex = new Map<string, { date: string; count: number }>();
  for (const u of dispos) {
    const pk = periodKey(u.reportYear!, u.reportMonth!, u.reportWeek!);
    if (!periodKeys.has(pk)) continue;
    const vendor = (u.vendorNumber || "").trim();
    const ck = `${streamId(u.clientId, u.channelId, vendor)}|${pk}`;
    const existing = loadedIndex.get(ck);
    if (!existing) loadedIndex.set(ck, { date: u.uploadDate, count: 1 });
    else {
      existing.count++;
      if (u.uploadDate > existing.date) existing.date = u.uploadDate;
    }
  }

  const isExcluded = (pk: string, sid: string) =>
    state.periods[pk]?.excludedStreams?.includes(sid) ?? false;

  // One row per (client, stream); clients with no streams get a placeholder row.
  const rows: ChecklistRow[] = [];
  const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of sortedClients) {
    const clientStreams = [...streams.values()]
      .filter((s) => s.clientId === c.id)
      .sort((a, b) => a.channelName.localeCompare(b.channelName) || a.vendor.localeCompare(b.vendor));

    if (clientStreams.length === 0) {
      rows.push({
        clientId: c.id, clientName: c.name, active: c.active,
        channelId: "", channelName: "", vendorNumber: "", streamId: "",
        placeholder: true,
        cells: Object.fromEntries(periods.map((p) => [p.key, { state: "na" } as Cell])),
      });
      continue;
    }

    for (const s of clientStreams) {
      const sid = streamId(c.id, s.channelId, s.vendor);
      const cells: Record<string, Cell> = {};
      for (const p of periods) {
        const loaded = loadedIndex.get(`${sid}|${p.key}`);
        if (loaded) cells[p.key] = { state: "loaded", date: loaded.date, count: loaded.count };
        else if (isExcluded(p.key, sid)) cells[p.key] = { state: "excluded" };
        else cells[p.key] = { state: "outstanding" };
      }
      rows.push({
        clientId: c.id, clientName: c.name, active: c.active,
        channelId: s.channelId, channelName: s.channelName, vendorNumber: s.vendor,
        streamId: sid, placeholder: false, cells,
      });
    }
  }

  // Per-period summary + armability (placeholders excluded).
  const perPeriod: Record<string, PeriodSummary> = {};
  const streamRows = rows.filter((r) => !r.placeholder);
  for (const p of periods) {
    let loaded = 0, excluded = 0, outstanding = 0;
    for (const r of streamRows) {
      const st = r.cells[p.key]?.state;
      if (st === "loaded") loaded++;
      else if (st === "excluded") excluded++;
      else if (st === "outstanding") outstanding++;
    }
    perPeriod[p.key] = {
      loaded, excluded, outstanding,
      armed: state.periods[p.key]?.armed ?? false,
      armable: outstanding === 0 && loaded > 0,
    };
  }

  return { periods, rows, perPeriod, activePeriodKey: state.activePeriodKey };
}
