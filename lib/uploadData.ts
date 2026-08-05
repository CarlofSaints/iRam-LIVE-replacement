/* ──────────────────────────────────────────────────────────────
   Upload records

   THE INDEX IS A CACHE, NOT THE RECORD. Every upload also writes its own
   small `uploads/meta/{id}.json` blob, and that per-upload blob is what
   proves the load happened.

   Why: `uploads/index.json` is a single shared list that every upload had to
   read-modify-write. Two DISPOs loaded at the same time — routine at
   month-end, and one request writes one row per channel×vendor group — both
   read the same starting list, both append, and the second write silently
   drops the first upload's entry. The load itself was fine, the ledger merged,
   but the DISPO checklist reads this index, so the tick never appeared. Users
   re-loaded until they happened not to collide, which is exactly the reported
   "I had to load it three times before it ticked".

   Two defences, because either alone still loses rows:
     1. append-and-verify (below) — after writing, re-read past our own cache;
        if a concurrent writer clobbered our entry, merge and go again.
     2. self-heal on read — reconcile the index against the per-upload meta
        blobs, so an entry that lost the race still surfaces on the next read.
   ────────────────────────────────────────────────────────────── */

import type { UploadMeta } from "./types";
import { readJson, readJsonStrict, writeJson, deleteBlob, listBlobs } from "./blob";
import { v4 as uuid } from "uuid";

const INDEX_KEY = "uploads/index.json";
const META_PREFIX = "uploads/meta/";

function dataKey(id: string): string {
  return `uploads/${id}.json`;
}

export function uploadMetaKey(id: string): string {
  return `${META_PREFIX}${id}.json`;
}

const idFromMetaKey = (key: string): string =>
  key.slice(key.lastIndexOf("/") + 1).replace(/\.json$/, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Newest first, de-duplicated by id (first occurrence wins). */
function normalize(list: UploadMeta[]): UploadMeta[] {
  const byId = new Map<string, UploadMeta>();
  for (const u of list) if (u?.id && !byId.has(u.id)) byId.set(u.id, u);
  return [...byId.values()].sort((a, b) => (b.uploadDate ?? "").localeCompare(a.uploadDate ?? ""));
}

/** Run `fn` over `items` with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

/* ── Read ───────────────────────────────────────────────────── */

// How many lost entries to recover, and legacy entries to back-fill, per call.
// Both converge over successive page loads rather than stalling one request.
const REPAIR_LIMIT = 250;
const BACKFILL_LIMIT = 25;

let backfilledThisContainer = false;

export async function getUploadIndex(): Promise<UploadMeta[]> {
  const index = await readJson<UploadMeta[]>(INDEX_KEY, []);

  let metaKeys: string[];
  try {
    metaKeys = (await listBlobs(META_PREFIX)).map((b) => b.key);
  } catch {
    // Reconciliation is a safety net, never a hard dependency.
    return normalize(index);
  }

  const indexIds = new Set(index.map((u) => u.id));
  const metaIds = metaKeys.map(idFromMetaKey).filter(Boolean);

  // Entries whose meta blob exists but which are absent from the index: these
  // are the ones a concurrent write dropped. Only these get fetched — the
  // normal case finds none and costs a single list() call.
  const lost = metaIds.filter((id) => !indexIds.has(id)).slice(0, REPAIR_LIMIT);

  let result = index;
  if (lost.length > 0) {
    const recovered = (
      await mapLimit(lost, 8, (id) => readJson<UploadMeta | null>(uploadMetaKey(id), null))
    ).filter((u): u is UploadMeta => !!u?.id);

    if (recovered.length > 0) {
      result = normalize([...index, ...recovered]);
      // Write the repaired index back so the next reader doesn't pay for this.
      // Best-effort: a failure here just means we repair again next time.
      try {
        await writeJson(INDEX_KEY, result);
      } catch {
        /* ignore */
      }
    }
  }

  // Uploads recorded before per-upload meta blobs existed have nothing to
  // rebuild from. Back-fill a few per container so the index becomes fully
  // reconstructible over time. Fire-and-forget — never delays a page load.
  if (!backfilledThisContainer) {
    backfilledThisContainer = true;
    const known = new Set(metaIds);
    const stale = normalize(result).filter((u) => !known.has(u.id)).slice(0, BACKFILL_LIMIT);
    if (stale.length > 0) {
      void mapLimit(stale, 4, (u) => writeJson(uploadMetaKey(u.id), u).catch(() => {})).catch(
        () => {},
      );
    }
  }

  return normalize(result);
}

export async function getUploadById(id: string): Promise<UploadMeta | null> {
  const index = await getUploadIndex();
  return index.find((u) => u.id === id) ?? null;
}

export async function getUploadsByClient(clientId: string): Promise<UploadMeta[]> {
  const index = await getUploadIndex();
  return index.filter((u) => u.clientId === clientId);
}

/* ── Write ──────────────────────────────────────────────────── */

const APPEND_ATTEMPTS = 4;

/**
 * Add `upload` to the shared index without losing a concurrent writer's entry.
 *
 * There is no compare-and-set on Blob storage, so this reads, merges, writes,
 * then re-reads PAST the write cache to confirm the entry survived. If another
 * container overwrote us in between, our id is missing from that fresh read and
 * we go round again — this time merging on top of their list, so both entries
 * end up present. The delay before verifying is deliberate: list()+fetch is
 * eventually consistent, so an immediate re-read can still show the pre-write
 * copy and trigger a pointless retry.
 *
 * Never throws: the meta blob is already written by the time we get here, so
 * the worst case is a tick that appears on the next read via self-heal.
 */
async function appendToIndex(upload: UploadMeta): Promise<void> {
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    try {
      // Strict: if we can't read the index we must NOT write, or we'd save a
      // one-element list over the entire upload history.
      const current = await readJsonStrict<UploadMeta[]>(INDEX_KEY, []);
      if (current.some((u) => u.id === upload.id)) return;

      await writeJson(INDEX_KEY, normalize([upload, ...current]));

      await sleep(400 + attempt * 400);
      const fresh = await readJsonStrict<UploadMeta[]>(INDEX_KEY, [], { skipCache: true });
      if (fresh.some((u) => u.id === upload.id)) return;
    } catch {
      await sleep(300);
    }
  }
}

export async function addUpload(
  meta: Omit<UploadMeta, "id">,
  data: Record<string, unknown>[]
): Promise<UploadMeta> {
  const upload: UploadMeta = { id: uuid(), ...meta };

  // Durable record first: rows, then the meta blob that proves this load
  // happened. Only then the index, which is derived from these two.
  await writeJson(dataKey(upload.id), data);
  await writeJson(uploadMetaKey(upload.id), upload);
  await appendToIndex(upload);

  return upload;
}

export async function getUploadData(
  id: string
): Promise<Record<string, unknown>[]> {
  return readJson<Record<string, unknown>[]>(dataKey(id), []);
}

/* ── Delete ─────────────────────────────────────────────────── */

/*
 * Deletes drop the meta blob BEFORE the index entry. The reverse order would
 * leave a meta blob with no index entry, which is precisely the shape the
 * self-heal above treats as "lost" — it would resurrect the deleted upload.
 */

/**
 * Drops every index entry for a client and deletes its row blobs.
 * Used by the client purge — returns how many uploads were removed.
 */
export async function deleteUploadsForClient(clientId: string): Promise<number> {
  const index = await getUploadIndex();
  const mine = index.filter((u) => u.clientId === clientId);
  if (mine.length === 0) return 0;

  await mapLimit(mine, 8, (u) => deleteBlob(uploadMetaKey(u.id)));
  await writeJson(INDEX_KEY, index.filter((u) => u.clientId !== clientId));

  let deleted = 0;
  for (const u of mine) if (await deleteBlob(dataKey(u.id))) deleted++;
  return deleted;
}

export async function deleteUpload(id: string): Promise<void> {
  await deleteBlob(uploadMetaKey(id));
  const index = await getUploadIndex();
  await writeJson(INDEX_KEY, index.filter((u) => u.id !== id));
  await deleteBlob(dataKey(id));
}
