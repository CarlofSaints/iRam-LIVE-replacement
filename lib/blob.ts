import { put, list, del } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";

const PREFIX = "live/";
const DATA_DIR = join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

function localPath(key: string): string {
  return join(DATA_DIR, key.replace(PREFIX, ""));
}

/* ── In-memory write-through cache ──
   Bridges the brief window between a put() and the new content being readable,
   so the container that JUST wrote sees its own write immediately.
   IMPORTANT: only WRITES populate this cache — never reads. Warming it on reads
   made a container serve a stale copy that masked another container's write
   (e.g. a new client created on container A looked missing on container B, so
   admins created it twice). Entries expire after 30s as a safety net. */
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
    // Do NOT warm the cache on reads — a read-warmed entry can mask another
    // container's newer write for up to CACHE_TTL_MS. Only writes warm it.
    return parsed;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  // Compact, NOT pretty-printed. These blobs are machine-read only, and the big
  // ones (sales ledgers, raw upload rows, PMF/LINKS) are tens of thousands of
  // wide row objects — 2-space indentation was costing ~25% of the stored bytes
  // for nothing. JSON.parse reads either form, so existing pretty blobs stay
  // readable and shrink the next time they're written.
  const json = JSON.stringify(data);

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
    // Mutable data store: never let the Blob CDN cache it. With a 60s TTL, a
    // read landing on a cold container after a write (e.g. creating a client)
    // served the stale cached blob — the new record looked like it "didn't
    // stick", so admins created it twice (risking a lost write/duplicate).
    cacheControlMaxAge: 0,
  });

  // Cache the written data so subsequent reads in the same instance get fresh data
  writeCache.set(fullKey, { json, ts: Date.now() });
}

/**
 * Deletes a blob. Returns TRUE only if something was actually removed —
 * a missing key returns false rather than throwing, so callers that are
 * cleaning up opportunistically can ignore it, while the client purge can
 * report a truthful count instead of assuming every call did something.
 */
export async function deleteBlob(key: string): Promise<boolean> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;

  // Clear cache for this key
  writeCache.delete(fullKey);

  if (!useBlob) {
    try {
      const p = localPath(fullKey);
      if (!existsSync(p)) return false;
      unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { blobs } = await list({ prefix: fullKey, limit: 1 });
    const match = blobs.find((b) => b.pathname === fullKey);
    if (!match) return false;
    await del(match.url);
    return true;
  } catch {
    return false;
  }
}

export interface BlobEntry { key: string; size: number }

/**
 * Every blob under a key prefix, with sizes. Used by the client purge so it
 * deletes whatever is actually there rather than a hardcoded key list that
 * would silently go stale the next time someone adds a per-client blob.
 * Prefix is relative to the store root ("clients/{id}/", "sales/{id}/").
 */
export async function listBlobs(prefix: string): Promise<BlobEntry[]> {
  const fullPrefix = prefix.startsWith(PREFIX) ? prefix : PREFIX + prefix;

  if (!useBlob) {
    const dir = localPath(fullPrefix);
    const out: BlobEntry[] = [];
    const walk = (p: string) => {
      if (!existsSync(p)) return;
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const child = join(p, entry.name);
        if (entry.isDirectory()) walk(child);
        // relative() rather than slicing by length: join() PRESERVES a trailing
        // separator, so a fixed offset ate the first character of every name.
        else out.push({
          key: fullPrefix.replace(/\/?$/, "/") + relative(dir, child).replace(/\\/g, "/"),
          size: statSync(child).size,
        });
      }
    };
    walk(dir);
    return out;
  }

  const out: BlobEntry[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: fullPrefix, limit: 1000, cursor });
    for (const b of res.blobs) out.push({ key: b.pathname, size: b.size ?? 0 });
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return out;
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
