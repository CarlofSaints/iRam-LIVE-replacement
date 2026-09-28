/* ──────────────────────────────────────────────────────────────
   Per-client Perigee feeds for store reports.

   One entry per client that needs one: the Perigee API token of an app user
   allocated to ONLY that client's customer. Its visits are an extra source for
   the check-in poller, next to the main iRam SQL feed.

   Kept in its own blob, NOT on the client record: GET /api/clients is readable
   by client-role accounts, and a token must never travel to a browser. The
   API route hands out only the last four characters.
   ────────────────────────────────────────────────────────────── */

import { readJson, readJsonStrict, writeJson } from "./blob";

const KEY = "store-reports/perigee-feeds.json";

export interface PerigeeFeedRun {
  at: string;
  ok: boolean;
  visits: number;
  error?: string;
}

export interface PerigeeFeed {
  clientId: string;
  token: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  lastRun?: PerigeeFeedRun;
}

/** What a browser may see of a feed. */
export interface PerigeeFeedView {
  clientId: string;
  tokenEnding: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  lastRun?: PerigeeFeedRun;
}

export function toView(f: PerigeeFeed): PerigeeFeedView {
  return {
    clientId: f.clientId,
    tokenEnding: f.token ? f.token.slice(-4) : "",
    enabled: f.enabled,
    updatedAt: f.updatedAt,
    updatedBy: f.updatedBy,
    lastRun: f.lastRun,
  };
}

/** Read-only listing (the settings panel). */
export async function getPerigeeFeeds(): Promise<PerigeeFeed[]> {
  return readJson<PerigeeFeed[]>(KEY, []);
}

/** Strict read, for every read-modify-write below: a failed read must not be
 *  saved back as "no feeds" and silently delete every other client's token. */
async function readStrict(): Promise<PerigeeFeed[]> {
  const feeds = await readJsonStrict<PerigeeFeed[]>(KEY, []);
  return Array.isArray(feeds) ? feeds : [];
}

export async function upsertPerigeeFeed(
  clientId: string,
  change: { token?: string; enabled?: boolean },
  by: string,
): Promise<PerigeeFeed> {
  const feeds = await readStrict();
  const now = new Date().toISOString();
  let feed = feeds.find((f) => f.clientId === clientId);
  if (!feed) {
    if (!change.token) throw new Error("A new feed needs a token");
    feed = { clientId, token: "", enabled: true, updatedAt: now, updatedBy: by };
    feeds.push(feed);
  }
  if (change.token) {
    feed.token = change.token;
    delete feed.lastRun;          // results of the old token say nothing about the new one
  }
  if (typeof change.enabled === "boolean") feed.enabled = change.enabled;
  feed.updatedAt = now;
  feed.updatedBy = by;
  await writeJson(KEY, feeds);
  return feed;
}

export async function removePerigeeFeed(clientId: string): Promise<boolean> {
  const feeds = await readStrict();
  const next = feeds.filter((f) => f.clientId !== clientId);
  if (next.length === feeds.length) return false;
  await writeJson(KEY, next);
  return true;
}

/** Stamp each feed's latest poll result. Best-effort, one write per run. */
export async function recordPerigeeFeedRuns(runs: Map<string, PerigeeFeedRun>): Promise<void> {
  if (!runs.size) return;
  const feeds = await readStrict();
  for (const f of feeds) {
    const r = runs.get(f.clientId);
    if (r) f.lastRun = r;
  }
  await writeJson(KEY, feeds);
}
