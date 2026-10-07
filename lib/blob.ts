import { put, list, del, get } from "@vercel/blob";
import { gzipSync, gunzipSync } from "zlib";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";

const PREFIX = "live/";
const DATA_DIR = join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

/* ── Store access mode ──
   A Blob store is public or private FOR LIFE (chosen at creation), and every
   put() must name the store's own mode. NEXT_PUBLIC_BLOB_ACCESS is the ONE
   switch: "private" for a private store, anything else = public (the original
   store). NEXT_PUBLIC_ so the browser upload() reads the same value as the
   server; two separate settings that must agree would be a trap.

   On a public store every ledger, users.json and audit file is readable by
   anyone who learns the hostname. A private store's URLs grant nothing
   without the store token. */
export const BLOB_ACCESS: "public" | "private" =
  process.env.NEXT_PUBLIC_BLOB_ACCESS === "private" ? "private" : "public";

/** A blob's bytes by URL (or, on a private store, pathname), in whichever
 *  mode the store is. null = the blob is not there; throws when the read
 *  itself failed. */
export async function fetchBlobBytes(urlOrPathname: string): Promise<Buffer | null> {
  if (BLOB_ACCESS === "private") {
    // useCache:false reads from origin, so a read just after a write sees it.
    // (CLAUDE.md's "never use get()" warning predates private stores: a
    // private blob can ONLY be read this way.)
    const r = await get(urlOrPathname, { access: "private", useCache: false });
    if (!r) return null;
    if (r.statusCode !== 200 || !r.stream) throw new Error(`HTTP ${r.statusCode}`);
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  if (!/^https:\/\//.test(urlOrPathname)) throw new Error("A public read needs the blob URL");
  const sep = urlOrPathname.includes("?") ? "&" : "?";
  const res = await fetch(`${urlOrPathname}${sep}t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ── Browser uploads ──
   Large files go browser → Blob, then the browser POSTs the blob URL and the
   server reads it back AND DELETES IT in a finally. Before this, any URL on
   any *.blob.vercel-storage.com host was accepted, so a user with upload
   rights could post the URL of live/users.json and the server would delete
   it. Now: browser uploads may only be written under TEMP_UPLOAD_PREFIX (the
   token routes refuse anything else), and the server only reads or deletes a
   URL that is in THIS store and under that prefix. */
export const TEMP_UPLOAD_PREFIX = "uploads-tmp/";

/** This store's own hostname, or null if it can't be worked out. */
function ownStoreHost(): string | null {
  const fromToken = (process.env.BLOB_READ_WRITE_TOKEN || "").split("_")[3] || "";
  const fromId = (process.env.BLOB_STORE_ID || "").replace(/^store_/, "");
  const id = (fromToken || fromId).trim().toLowerCase();
  return id ? `${id}.${BLOB_ACCESS}.blob.vercel-storage.com` : null;
}

/** True only for a temporary browser upload in THIS store. A route that
 *  fetches or deletes a URL the BROWSER sent must check this first. */
export function isOwnTempUpload(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const host = ownStoreHost();
    if (!host || url.hostname.toLowerCase() !== host) return false;
    return decodeURIComponent(url.pathname).replace(/^\/+/, "").startsWith(TEMP_UPLOAD_PREFIX);
  } catch {
    return false;
  }
}

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

/* ── Transparent gzip ──
   These blobs are repetitive tabular JSON, which compresses ~30x (a 15MB
   ledger stores as 0.5MB). Writes gzip at level 6 — measured at ~44ms for
   15MB, and level 9 buys nothing — and reads DETECT the format from the
   gzip magic bytes rather than the key name.

   Sniffing rather than a ".gz" suffix is what makes this migration-free:
   blobs written before this change are plain UTF-8 and still read fine,
   and each one shrinks the next time it happens to be written. Nothing
   has to be converted, and a rollback can still read anything written
   while it was live... except gzipped blobs, so a revert of this commit
   must also re-save affected data. */
const GZIP_LEVEL = 6;

function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function decodeMaybeGzip(buf: Buffer): string {
  return (isGzip(buf) ? gunzipSync(buf) : buf).toString("utf-8");
}

/* ── Reading ──
   loadJson() is the one real reader. It distinguishes the two cases that a
   plain `catch { return fallback }` fatally conflates:

     found: false  → the blob genuinely is not there (a first-ever write)
     throws        → we could not TELL: list/fetch failed, the body was
                     truncated, the gzip or JSON did not parse

   That distinction matters because almost every caller does a read-modify-
   write. Treating "the read broke" as "there is no data" makes the next write
   save an EMPTY collection over a full one — a transient network blip silently
   becomes data loss. Read-only callers can still opt into the old forgiving
   behaviour via readJson(); anything that writes back must use readJsonStrict()
   so a failed read aborts instead of erasing. */
export class BlobReadError extends Error {
  constructor(key: string, cause: unknown) {
    super(`Blob read failed for "${key}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "BlobReadError";
  }
}

async function loadJson<T>(
  fullKey: string,
  skipCache: boolean,
): Promise<{ found: boolean; value?: T }> {
  if (!useBlob) {
    const p = localPath(fullKey);
    if (!existsSync(p)) return { found: false };
    try {
      // Sniff here too, so a blob copied down from production reads locally.
      return { found: true, value: JSON.parse(decodeMaybeGzip(readFileSync(p))) as T };
    } catch (err) {
      throw new BlobReadError(fullKey, err);
    }
  }

  // Check write cache first (avoids stale CDN reads after recent writes).
  // skipCache is for read-after-write VERIFICATION: the whole point there is to
  // see what the store actually holds, and our own cache would just echo back
  // the copy we hoped we wrote.
  if (!skipCache) {
    const cached = writeCache.get(fullKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      try {
        return { found: true, value: JSON.parse(cached.json) as T };
      } catch {
        writeCache.delete(fullKey);
      }
    }
  }

  // Private store: get() by pathname, no list() round trip needed.
  if (BLOB_ACCESS === "private") {
    let buf: Buffer | null;
    try {
      buf = await fetchBlobBytes(fullKey);
    } catch (err) {
      throw new BlobReadError(fullKey, err);
    }
    if (!buf) return { found: false };
    try {
      return { found: true, value: JSON.parse(decodeMaybeGzip(buf)) as T };
    } catch (err) {
      throw new BlobReadError(fullKey, err);
    }
  }

  // Use list() to find the blob URL, then fetch directly (cache-busted)
  let match;
  try {
    const { blobs } = await list({ prefix: fullKey, limit: 10 });
    match = blobs.find((b) => b.pathname === fullKey);
  } catch (err) {
    throw new BlobReadError(fullKey, err);
  }
  if (!match) return { found: false };

  try {
    const res = await fetch(`${match.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // arrayBuffer, not text(): the stored bytes may be gzip. decodeMaybeGzip
    // handles both, so plain blobs written before gzip landed still read.
    const text = decodeMaybeGzip(Buffer.from(await res.arrayBuffer()));
    // Do NOT warm the cache on reads — a read-warmed entry can mask another
    // container's newer write for up to CACHE_TTL_MS. Only writes warm it.
    return { found: true, value: JSON.parse(text) as T };
  } catch (err) {
    throw new BlobReadError(fullKey, err);
  }
}

/** Forgiving read: any failure returns `fallback`. Read-only callers only. */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  try {
    const r = await loadJson<T>(fullKey, false);
    return r.found ? (r.value as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Strict read: returns `fallback` ONLY when the blob genuinely doesn't exist,
 * and THROWS BlobReadError when the read failed. Use this on every path that
 * writes the result back, so a broken read can never be saved as "empty".
 */
export async function readJsonStrict<T>(
  key: string,
  fallback: T,
  opts?: { skipCache?: boolean },
): Promise<T> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  const r = await loadJson<T>(fullKey, opts?.skipCache ?? false);
  return r.found ? (r.value as T) : fallback;
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
    // Local dev stays PLAIN so the files under data/ remain greppable.
    const p = localPath(fullKey);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, json);
    return;
  }

  await put(fullKey, gzipSync(Buffer.from(json), { level: GZIP_LEVEL }), {
    access: BLOB_ACCESS,
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

/** Raw bytes stored under a key (an image, a file), or null if there are none. */
export async function readBlobBytes(key: string): Promise<Buffer | null> {
  const fullKey = key.startsWith(PREFIX) ? key : PREFIX + key;
  if (!useBlob) {
    const p = localPath(fullKey);
    return existsSync(p) ? readFileSync(p) : null;
  }
  if (BLOB_ACCESS === "private") return fetchBlobBytes(fullKey);
  const { blobs } = await list({ prefix: fullKey, limit: 10 });
  const match = blobs.find((b) => b.pathname === fullKey);
  return match ? fetchBlobBytes(match.url) : null;
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
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
  return blob.url;
}
