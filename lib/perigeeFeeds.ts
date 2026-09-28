/* ──────────────────────────────────────────────────────────────
   Per-client Perigee feeds for store reports.

   One entry per client that needs one: the Perigee API token of an app user
   allocated to ONLY that client's customer. Its visits are an extra source for
   the check-in poller, next to the main iRam SQL feed.

   TOKENS ARE ENCRYPTED AT REST (AES-256-GCM). This app's Blob store is PUBLIC:
   any file is readable by whoever has its URL. So the blob holds only
   ciphertext, and the key lives in an env var (PERIGEE_TOKEN_KEY, else
   REPORT_LINK_SECRET) that never touches the store. No key = refuse to save
   or use a token, never a built-in fallback key.

   Not on the client record either: GET /api/clients is readable by client
   accounts. The API route hands out only the last four characters.

   Poll results live in a SEPARATE blob (perigee-feed-runs.json): the poller
   writes them every 3 minutes, and a read-modify-write of the token file that
   often would race an admin's save or remove and could restore a token the
   admin had just deleted.
   ────────────────────────────────────────────────────────────── */

import crypto from "crypto";
import { readJsonStrict, readJson, writeJson } from "./blob";

const KEY = "store-reports/perigee-feeds.json";
const RUNS_KEY = "store-reports/perigee-feed-runs.json";

export interface PerigeeFeedRun {
  at: string;
  ok: boolean;
  visits: number;
  error?: string;
}

interface StoredFeed {
  clientId: string;
  tokenEnc: string;        // v1.<iv>.<tag>.<ciphertext>, base64url
  tokenEnding: string;     // last 4 characters, for display only
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** A feed with its token decrypted: server-side use only. */
export interface PerigeeFeed extends Omit<StoredFeed, "tokenEnc"> {
  token: string;
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

// ── Encryption ──

function key(): Buffer {
  const secret = (process.env.PERIGEE_TOKEN_KEY || process.env.REPORT_LINK_SECRET || "").trim();
  if (!secret) throw new Error("No encryption key for Perigee tokens (set PERIGEE_TOKEN_KEY)");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "iram-live", "perigee-feed-token-v1", 32));
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
}

export function decryptToken(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable stored token");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ── Storage ──

async function readStored(): Promise<StoredFeed[]> {
  const feeds = await readJsonStrict<StoredFeed[]>(KEY, []);
  return Array.isArray(feeds) ? feeds : [];
}

async function readRuns(): Promise<Record<string, PerigeeFeedRun>> {
  return readJson<Record<string, PerigeeFeedRun>>(RUNS_KEY, {});
}

/** For the settings panel: never a token, only its ending + the last poll. */
export async function getPerigeeFeedViews(): Promise<PerigeeFeedView[]> {
  const [feeds, runs] = await Promise.all([readStored(), readRuns()]);
  return feeds.map((f) => ({
    clientId: f.clientId, tokenEnding: f.tokenEnding, enabled: f.enabled,
    updatedAt: f.updatedAt, updatedBy: f.updatedBy, lastRun: runs[f.clientId],
  }));
}

/** For the poller and the Test button. STRICT: throws when the list can't be
 *  read, so the caller can say so rather than silently polling nothing. A feed
 *  whose token can't be decrypted comes back with token "" and is skipped. */
export async function getPerigeeFeedsWithTokens(): Promise<(PerigeeFeed & { decryptError?: string })[]> {
  const feeds = await readStored();
  return feeds.map(({ tokenEnc, ...f }) => {
    try {
      return { ...f, token: decryptToken(tokenEnc) };
    } catch (e) {
      return { ...f, token: "", decryptError: e instanceof Error ? e.message : "could not decrypt" };
    }
  });
}

export async function upsertPerigeeFeed(
  clientId: string,
  change: { token?: string; enabled?: boolean },
  by: string,
): Promise<PerigeeFeedView> {
  const feeds = await readStored();
  const now = new Date().toISOString();
  let feed = feeds.find((f) => f.clientId === clientId);
  if (!feed) {
    if (!change.token) throw new Error("A new feed needs a token");
    feed = { clientId, tokenEnc: "", tokenEnding: "", enabled: true, updatedAt: now, updatedBy: by };
    feeds.push(feed);
  }
  if (change.token) {
    feed.tokenEnc = encryptToken(change.token);
    feed.tokenEnding = change.token.slice(-4);
  }
  if (typeof change.enabled === "boolean") feed.enabled = change.enabled;
  feed.updatedAt = now;
  feed.updatedBy = by;
  await writeJson(KEY, feeds);
  if (change.token) await clearRun(clientId);   // the old token's result says nothing about the new one
  return { clientId, tokenEnding: feed.tokenEnding, enabled: feed.enabled, updatedAt: now, updatedBy: by };
}

export async function removePerigeeFeed(clientId: string): Promise<boolean> {
  const feeds = await readStored();
  const next = feeds.filter((f) => f.clientId !== clientId);
  if (next.length === feeds.length) return false;
  await writeJson(KEY, next);
  await clearRun(clientId);
  return true;
}

async function clearRun(clientId: string): Promise<void> {
  const runs = await readJsonStrict<Record<string, PerigeeFeedRun>>(RUNS_KEY, {});
  if (!(clientId in runs)) return;
  delete runs[clientId];
  await writeJson(RUNS_KEY, runs);
}

/** Stamp each feed's latest poll result: its own file, never the token file. */
export async function recordPerigeeFeedRuns(results: Map<string, PerigeeFeedRun>): Promise<void> {
  if (!results.size) return;
  const runs = await readJsonStrict<Record<string, PerigeeFeedRun>>(RUNS_KEY, {});
  for (const [id, r] of results) runs[id] = r;
  await writeJson(RUNS_KEY, runs);
}
