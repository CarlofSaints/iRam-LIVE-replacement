/* ──────────────────────────────────────────────────────────────
   One upload at a time, app-wide

   An upload is a read-modify-write of several shared blobs — the sales
   ledger, the client's ledger index, the upload index, the activity log.
   Blob storage has no compare-and-set, so two uploads running at once can
   each read the same starting data and the second write silently discards
   the first one's rows. Both requests report success. See the checklist
   fix in lib/uploadData.ts for the version of this that reached users.

   Serialising uploads removes the whole class of problem rather than
   patching each shared blob individually. A DISPO takes well under a
   minute, so the wait is short and, unlike lost sales rows, it is visible.

   This is an ADVISORY lock, not a mutex: acquiring it is itself a blob
   write, so two requests landing in the same instant can both believe they
   won. acquire() therefore writes and then re-reads past the write cache to
   confirm it actually holds the lock. That closes everything except a
   sub-second dead heat, which no amount of blob writing can close.
   ────────────────────────────────────────────────────────────── */

import { readJsonStrict, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "uploads/lock.json";

/* Longer than the upload route's maxDuration (300s), so a request that was
   killed mid-flight can never hold the lock forever — the next upload takes
   it over. Shorter than that and we'd evict a load that is still running. */
const LOCK_TTL_MS = 6 * 60 * 1000;

/* How long to wait before verifying we hold the lock. list()+fetch is
   eventually consistent, so an immediate re-read can still show the previous
   value and make us think we lost a race we won. */
const VERIFY_DELAY_MS = 600;

export interface UploadLock {
  id: string;
  userId: string;
  userName: string;
  clientName: string;
  fileName: string;
  startedAt: string;
}

export type AcquireResult =
  | { ok: true; lock: UploadLock }
  | { ok: false; heldBy: UploadLock | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isExpired = (lock: UploadLock): boolean =>
  Date.now() - new Date(lock.startedAt).getTime() > LOCK_TTL_MS;

/** Whoever currently holds the lock, or null. Expired holders read as null. */
export async function getUploadLock(): Promise<UploadLock | null> {
  const lock = await readJsonStrict<UploadLock | null>(KEY, null, { skipCache: true });
  if (!lock?.id) return null;
  return isExpired(lock) ? null : lock;
}

export async function acquireUploadLock(
  info: Omit<UploadLock, "id" | "startedAt">,
): Promise<AcquireResult> {
  // Deliberately NOT wrapped in a try/catch that proceeds on error. If we
  // cannot read the lock we do not know whether an upload is running, and
  // guessing "no" is exactly the assumption that loses data. Fail closed:
  // the caller turns this into "try again in a minute", which is recoverable.
  const existing = await readJsonStrict<UploadLock | null>(KEY, null, { skipCache: true });
  if (existing?.id && !isExpired(existing)) return { ok: false, heldBy: existing };

  const lock: UploadLock = { ...info, id: uuid(), startedAt: new Date().toISOString() };
  await writeJson(KEY, lock);

  await sleep(VERIFY_DELAY_MS);
  const confirmed = await readJsonStrict<UploadLock | null>(KEY, null, { skipCache: true });
  if (confirmed?.id !== lock.id) {
    // Someone else's write landed on top of ours — they hold it, we back off.
    return { ok: false, heldBy: confirmed?.id ? confirmed : null };
  }
  return { ok: true, lock };
}

/**
 * Release, but only if we still hold it. The check matters: if our request
 * overran the TTL and someone else legitimately took over, clearing the key
 * would hand a third upload a lock the second one thinks it owns.
 */
export async function releaseUploadLock(id: string): Promise<void> {
  try {
    const current = await readJsonStrict<UploadLock | null>(KEY, null, { skipCache: true });
    if (current?.id && current.id !== id) return;
    await writeJson(KEY, null);
  } catch {
    // Never fail an otherwise-successful upload on cleanup. A stranded lock
    // expires on its own after LOCK_TTL_MS.
  }
}

/** Human-readable wait message for the blocked user. */
export function lockMessage(heldBy: UploadLock | null): string {
  if (!heldBy) {
    return "Another DISPO is being processed right now. Please try again in a minute.";
  }
  const started = new Date(heldBy.startedAt);
  const secs = Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
  const ago = secs < 60 ? `${secs} second${secs === 1 ? "" : "s"}` : `${Math.round(secs / 60)} minute${Math.round(secs / 60) === 1 ? "" : "s"}`;
  return `${heldBy.userName} is currently loading ${heldBy.clientName} (${heldBy.fileName}), started ${ago} ago. Uploads run one at a time so they can't overwrite each other's data. Please try again in a minute.`;
}
