/* ──────────────────────────────────────────────────────────────
   Store-report arming + weekly exclusions

   One small blob holds, per (year, month, week) period:
     - excludedStreams:  (client×channel×vendor) streams the CAM has marked
                         "send without this vendor this week"
     - armed:            whether the week's send window is open
   Plus activePeriodKey — the single currently-armed week (one at a time;
   arming a new week supersedes the previous). Live-render at trigger reads
   the exclusions; nothing freezes a data snapshot here.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

const KEY = "store-reports/state.json";

export interface WeekState {
  year: number;
  month: number;
  week: number;
  excludedStreams: string[]; // streamId = `${clientId}|${channelId}|${vendor}`
  armed: boolean;
  armedAt?: string;
  armedBy?: string;
  disarmedAt?: string;
}

export interface StoreReportState {
  activePeriodKey: string | null;
  periods: Record<string, WeekState>;
}

export function periodKey(year: number, month: number, week: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${week}`;
}

export async function getStoreReportState(): Promise<StoreReportState> {
  const s = await readJson<StoreReportState | null>(KEY, null);
  return { activePeriodKey: s?.activePeriodKey ?? null, periods: s?.periods ?? {} };
}

async function save(s: StoreReportState): Promise<void> {
  await writeJson(KEY, s);
}

function ensurePeriod(s: StoreReportState, year: number, month: number, week: number): WeekState {
  const k = periodKey(year, month, week);
  if (!s.periods[k]) s.periods[k] = { year, month, week, excludedStreams: [], armed: false };
  return s.periods[k];
}

export async function toggleExclusion(
  year: number, month: number, week: number, streamId: string, excluded: boolean,
): Promise<StoreReportState> {
  const s = await getStoreReportState();
  const p = ensurePeriod(s, year, month, week);
  const set = new Set(p.excludedStreams);
  if (excluded) set.add(streamId); else set.delete(streamId);
  p.excludedStreams = [...set];
  await save(s);
  return s;
}

export async function armPeriod(
  year: number, month: number, week: number, userId: string,
): Promise<StoreReportState> {
  const s = await getStoreReportState();
  const k = periodKey(year, month, week);
  // Supersede: disarm any other currently-armed period (one week at a time).
  const now = new Date().toISOString();
  for (const [pk, st] of Object.entries(s.periods)) {
    if (pk !== k && st.armed) { st.armed = false; st.disarmedAt = now; }
  }
  const p = ensurePeriod(s, year, month, week);
  p.armed = true;
  p.armedAt = now;
  p.armedBy = userId;
  p.disarmedAt = undefined;
  s.activePeriodKey = k;
  await save(s);
  return s;
}

export async function disarmPeriod(
  year: number, month: number, week: number,
): Promise<StoreReportState> {
  const s = await getStoreReportState();
  const k = periodKey(year, month, week);
  const p = s.periods[k];
  if (p?.armed) { p.armed = false; p.disarmedAt = new Date().toISOString(); }
  if (s.activePeriodKey === k) s.activePeriodKey = null;
  await save(s);
  return s;
}
