import { put, list, del } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";

const PREFIX = "live/";
const DATA_DIR = join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

function localPath(key: string): string {
  return join(DATA_DIR, key.replace(PREFIX, ""));
}

/* ── In-memory write-through cache ──
   Prevents stale CDN reads after a write within the same warm instance.
   Entries expire after 30 seconds so we don't serve permanently stale data. */
const writeCache = new Map<string, { json: string; ts: number }>();
const CACHE_TTL_MS = 30_000;

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  if (!useBlob) {
    try {
      const p = localPath(fullKey);
      if (!existsSync(p)) return fallback;
      return JSON.parse(readFileSync(p, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }

  // Check write cache first (avoids stale CDN reads after recent writes)
  const cached = writeCache.get(fullKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    try {
      return JSON.parse(cached.json) as T;
    } catch {
      writeCache.delete(fullKey);
    }
  }

  // Use list() to find the blob URL, then fetch directly (cache-busted)
  try {
    const { blobs } = await list({ prefix: fullKey, limit: 10 });
    const match = blobs.find((b) => b.pathname === fullKey);
    if (!match) return fallback;
    const res = await fetch(`${match.url}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const text = await res.text();
    const parsed = JSON.parse(text) as T;
    // Warm the cache with what we just read
    writeCache.set(fullKey, { json: text, ts: Date.now() });
    return parsed;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  const json = JSON.stringify(data, null, 2);

  if (!useBlob) {
    const p = localPath(fullKey);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, json);
    return;
  }

  await put(fullKey, json, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });

  // Cache the written data so subsequent reads in the same instance get fresh data
  writeCache.set(fullKey, { json, ts: Date.now() });
}

export async function deleteBlob(key: string): Promise<void> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;

  // Clear cache for this key
  writeCache.delete(fullKey);

  if (!useBlob) {
    try {
      const p = localPath(fullKey);
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const { blobs } = await list({ prefix: fullKey, limit: 1 });
    const match = blobs.find((b) => b.pathname === fullKey);
    if (match) await del(match.url);
  } catch {
    /* ignore */
  }
}

export async function writeBlob(
  key: string,
  data: Buffer | string,
  contentType: string
): Promise<string> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  if (!useBlob) {
    const p = localPath(fullKey);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return `/data/${fullKey.replace(PREFIX, "")}`;
  }
  const blob = await put(fullKey, data, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
  return blob.url;
}
