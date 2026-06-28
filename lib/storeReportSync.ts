/* ──────────────────────────────────────────────────────────────
   Store-report SYNC settings + visit normalisation.

   Settings (Blob, super-admin editable): whether the poller is enabled, the
   Perigee channel allow-list (only these channels trigger reports), a minimum
   interval throttle, and the last-run record. The Vercel Cron fires every few
   minutes; the handler reads these each run so changes take effect with no
   redeploy.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

const KEY = "store-reports/sync.json";

// Default Perigee channels we act on (Carl's list). Liquor variants included;
// editable in the Sync Settings UI.
export const DEFAULT_CHANNELS = [
  "BEX", "BSS", "BTD", "BWH", "Jumbo", "JUMBO-LIQUORS",
  "Makro", "Makro-Liquor", "Game", "TWH", "WallmartGroup", "Walmart",
];

export interface SyncLastRun {
  at: string;
  ok: boolean;
  visitsSeen: number;
  sent: number;
  skipped: number;
  failed: number;
  message?: string;
}

export interface StoreReportSyncSettings {
  enabled: boolean;
  channels: string[];
  minIntervalSeconds: number;   // throttle: skip a run if last run was more recent
  lastRun?: SyncLastRun;
}

const DEFAULTS: StoreReportSyncSettings = {
  enabled: false,                // off until the SP is reachable + verified
  channels: DEFAULT_CHANNELS,
  minIntervalSeconds: 0,
};

export async function getSyncSettings(): Promise<StoreReportSyncSettings> {
  const s = await readJson<Partial<StoreReportSyncSettings> | null>(KEY, null);
  return {
    enabled: s?.enabled ?? DEFAULTS.enabled,
    channels: s?.channels?.length ? s.channels : DEFAULT_CHANNELS,
    minIntervalSeconds: s?.minIntervalSeconds ?? 0,
    lastRun: s?.lastRun,
  };
}

export async function saveSyncSettings(
  patch: Partial<Pick<StoreReportSyncSettings, "enabled" | "channels" | "minIntervalSeconds">>,
): Promise<StoreReportSyncSettings> {
  const cur = await getSyncSettings();
  const next: StoreReportSyncSettings = {
    enabled: patch.enabled ?? cur.enabled,
    channels: patch.channels ?? cur.channels,
    minIntervalSeconds: patch.minIntervalSeconds ?? cur.minIntervalSeconds,
    lastRun: cur.lastRun,
  };
  await writeJson(KEY, next);
  return next;
}

export async function recordLastRun(run: SyncLastRun): Promise<void> {
  const cur = await getSyncSettings();
  await writeJson(KEY, { ...cur, lastRun: run });
}

// ── Visit normalisation ──────────────────────────────────────────────────────
// The SP's exact column names aren't confirmed yet, so resolve tolerantly:
// strip case / spaces / underscores and match against a set of candidates.
// TODO: once a real `exec gettodayvisitsmassmart` sample is seen, lock these.

export interface NormalisedVisit {
  siteCode: string;
  repEmail: string;
  repName: string;
  visitGuid: string;
  channel: string;
  checkInAt: string;
}

function pick(row: Record<string, unknown>, candidates: string[]): string {
  const norm = (k: string) => k.toLowerCase().replace(/[\s_]+/g, "");
  const want = new Set(candidates.map(norm));
  for (const [k, v] of Object.entries(row)) {
    if (want.has(norm(k))) {
      const s = v == null ? "" : String(v).trim();
      if (s) return s;
    }
  }
  return "";
}

// Confirmed against gettodayvisitsmassmart columns (2026-06-28):
//   storeCode, channelName, StoreName, email, UserName, visitStart, DateAdded, id
export function normaliseVisit(row: Record<string, unknown>): NormalisedVisit {
  return {
    siteCode: pick(row, ["storecode", "sitecode", "site", "siteid", "storeid", "storenumber", "sitenumber"]),
    repEmail: pick(row, ["email", "repemail", "useremail", "agentemail", "merchandiseremail", "useremailaddress", "emailaddress"]),
    repName: pick(row, ["username", "repname", "rep", "agentname", "merchandiser", "name", "fullname", "user"]),
    visitGuid: pick(row, ["id", "visitguid", "visitid", "guid", "visituuid", "uuid", "visitkey"]),
    channel: pick(row, ["channelname", "channel", "storechannel", "retailer"]),
    checkInAt: pick(row, ["visitstart", "checkin", "checkintime", "checkinat", "visitdate", "datetime", "starttime", "dateadded", "createddate"]),
  };
}
