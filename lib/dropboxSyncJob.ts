/* ──────────────────────────────────────────────────────────────
   "Has SQL caught up yet?"

   Saving a control file to Dropbox does NOT update SQL. A process on Mark's
   side polls Dropbox every couple of minutes and writes the change into SQL
   when it finds one. Until that has happened, a report exported from this app
   will not contain the edit — and it will look completely normal, which is
   the dangerous part. Someone changes a product description, exports a
   Month-End straight away, and quietly gets the old one.

   So a save is not finished when Dropbox accepts it. It is finished when SQL
   shows the change, and this is what watches for that.

   HOW IT KNOWS: a fingerprint of the client's rows from the relevant stored
   procedure, taken BEFORE the file is replaced. When the fingerprint changes,
   Mark's process has been through. This detects any edit — a changed cell as
   well as an added or removed row — which a row count alone would not.
   ────────────────────────────────────────────────────────────── */

import { createHash } from "crypto";
import { readJson, writeJson } from "./blob";
import { sqlQuery } from "./sqlProxy";
import { getSqlSource } from "./sqlSources";

export type SyncJobState = "waiting" | "synced" | "timeout" | "unverifiable";

export interface DropboxSyncJob {
  id: string;
  clientId: string;
  clientName: string;
  /** The name as it appears in the SQL results, used to scope the rows. */
  sqlClientName: string;
  filePath: string;
  fileName: string;
  /** SQL_SOURCES id, or null when nothing in SQL can confirm this file. */
  sourceId: string | null;
  beforeHash: string | null;
  beforeRows: number | null;
  afterRows: number | null;
  startedAt: string;
  startedBy: string;
  syncedAt: string | null;
  state: SyncJobState;
  note: string;
}

const KEY = (id: string) => `dropbox/sync-jobs/${id}.json`;

/* Ten minutes. Mark's poller runs every two, so anything past this is a real
   problem worth telling someone about rather than a slow cycle. */
export const SYNC_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * A stable fingerprint of one client's rows from a source.
 *
 * Rows are stringified with their keys sorted and then the ROW STRINGS are
 * sorted, so the hash does not move just because SQL returned the same data
 * in a different order — that would show as a phantom "synced" the moment
 * anyone polled.
 */
export async function fingerprint(
  sourceId: string,
  sqlClientName: string,
): Promise<{ hash: string; rows: number }> {
  const source = getSqlSource(sourceId);
  if (!source) throw new Error(`Unknown SQL source '${sourceId}'`);

  const result = await sqlQuery<Record<string, unknown>>(source.query, {});
  const all = result.data ?? [];

  /* These procedures return every IRAM Live client, so narrow to this one.
     Store rows carry no Client column — they are channel-scoped and global —
     so they are fingerprinted whole. */
  const want = sqlClientName.trim().toUpperCase();
  const rows = all.filter((r) => {
    const c = r["Client"];
    if (c === undefined) return true;
    return String(c ?? "").trim().toUpperCase() === want;
  });

  const canonical = rows
    .map((r) =>
      JSON.stringify(
        Object.keys(r).sort().reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = r[k];
          return acc;
        }, {}),
      ),
    )
    .sort()
    .join("\n");

  return {
    hash: createHash("sha256").update(canonical).digest("hex"),
    rows: rows.length,
  };
}

export async function createSyncJob(job: DropboxSyncJob): Promise<void> {
  await writeJson(KEY(job.id), job);
}

export async function getSyncJob(id: string): Promise<DropboxSyncJob | null> {
  return readJson<DropboxSyncJob | null>(KEY(id), null);
}

/**
 * Check once whether SQL has caught up, and persist the answer.
 *
 * Persisting matters: the browser may be closed, reopened, or on another
 * machine, and the person who made the edit is not necessarily the one who
 * needs to know it is safe to export.
 */
export async function checkSyncJob(id: string): Promise<DropboxSyncJob | null> {
  const job = await getSyncJob(id);
  if (!job) return null;
  if (job.state !== "waiting") return job;

  if (!job.sourceId || job.beforeHash === null) {
    job.state = "unverifiable";
    job.note =
      "This file has no stored procedure behind it yet, so the app cannot see when SQL picks it up. " +
      "The save to Dropbox succeeded — allow a few minutes before exporting.";
    await writeJson(KEY(id), job);
    return job;
  }

  try {
    const now = await fingerprint(job.sourceId, job.sqlClientName);
    if (now.hash !== job.beforeHash) {
      job.state = "synced";
      job.syncedAt = new Date().toISOString();
      job.afterRows = now.rows;
      const delta = now.rows - (job.beforeRows ?? now.rows);
      job.note =
        `SQL has the change. ${now.rows} rows` +
        (delta ? ` (${delta > 0 ? "+" : ""}${delta} vs before)` : " (same row count, contents changed)") +
        ". Reports exported from now on will include it.";
      await writeJson(KEY(id), job);
      return job;
    }
  } catch (e) {
    /* A proxy hiccup must not be reported as "not synced yet" forever with no
       explanation — say the check failed, and keep waiting. */
    job.note = `Still waiting. Last check could not reach SQL: ${e instanceof Error ? e.message : String(e)}`;
    await writeJson(KEY(id), job);
    return job;
  }

  if (Date.now() - new Date(job.startedAt).getTime() > SYNC_TIMEOUT_MS) {
    job.state = "timeout";
    job.note =
      "SQL has not changed after 10 minutes. Either the edit did not actually change anything, " +
      "or the Dropbox-to-SQL sync is not running. The file IS saved in Dropbox either way.";
    await writeJson(KEY(id), job);
    return job;
  }

  job.note = "Saved to Dropbox. Waiting for the sync to carry it into SQL.";
  await writeJson(KEY(id), job);
  return job;
}
