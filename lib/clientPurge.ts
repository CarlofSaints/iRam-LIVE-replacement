/* ──────────────────────────────────────────────────────────────
   Deleting a client, properly.

   deleteClient() only drops the row from clients.json. On its own that
   orphans every ledger, upload and control file the client ever had —
   they keep costing storage forever and show up on the Storage page as
   "(deleted client)", unattributable and unreachable.

   So the purge sweeps by PREFIX (clients/{id}/, sales/{id}/) rather than
   a hardcoded key list: whatever is actually under those prefixes gets
   removed, including per-client blobs added long after this was written.
   Per-upload row blobs live in a shared uploads/ namespace, so those are
   resolved through the upload index instead.

   previewPurge() runs the same enumeration WITHOUT deleting, so the UI can
   show exactly what is about to be destroyed before anyone confirms.
   ────────────────────────────────────────────────────────────── */

import { listBlobs, deleteBlob, type BlobEntry } from "./blob";
import { getClientById, deleteClient } from "./clientData";
import { getUploadIndex, deleteUploadsForClient, uploadMetaKey } from "./uploadData";
import { removeClientExclusions } from "./storeReportState";
import { deleteClientReportCounts } from "./reportCounts";
import type { UploadMeta } from "./types";

export interface PurgeItem {
  label: string;
  blobCount: number;
  bytes: number;
}

export interface PurgePreview {
  clientId: string;
  clientName: string;
  items: PurgeItem[];
  totalBlobs: number;
  totalBytes: number;
  uploadCount: number;
  /** Blob sizes are unavailable when running on the local filesystem fallback. */
  metered: boolean;
}

/** Everything belonging to this client, grouped for display. Deletes nothing. */
export async function previewPurge(clientId: string): Promise<PurgePreview> {
  const client = await getClientById(clientId);
  if (!client) throw new Error("Client not found");

  const [clientBlobs, salesBlobs, uploads] = await Promise.all([
    listBlobs(`clients/${clientId}/`),
    listBlobs(`sales/${clientId}/`),
    getUploadIndex(),
  ]);

  const mine = uploads.filter((u) => u.clientId === clientId);
  const uploadBlobs = await uploadRowBlobs(mine);

  const sum = (bs: BlobEntry[]) => bs.reduce((n, b) => n + b.size, 0);
  const items: PurgeItem[] = [
    { label: "Sales ledgers", blobCount: salesBlobs.length, bytes: sum(salesBlobs) },
    { label: "Control files, product master, mappings, config, logo", blobCount: clientBlobs.length, bytes: sum(clientBlobs) },
    { label: `Uploaded DISPO rows (${mine.length} upload${mine.length === 1 ? "" : "s"})`, blobCount: uploadBlobs.length, bytes: sum(uploadBlobs) },
  ].filter((i) => i.blobCount > 0);

  const all = [...clientBlobs, ...salesBlobs, ...uploadBlobs];
  return {
    clientId,
    clientName: client.name,
    items,
    totalBlobs: all.length,
    totalBytes: sum(all),
    uploadCount: mine.length,
    metered: all.every((b) => b.size >= 0) && all.some((b) => b.size > 0),
  };
}

// Per-upload row blobs sit under the shared uploads/ prefix keyed by upload id,
// so they can only be found via the index — a prefix sweep would hit every
// client's uploads at once.
async function uploadRowBlobs(uploads: UploadMeta[]): Promise<BlobEntry[]> {
  if (uploads.length === 0) return [];
  // Both blobs per upload: the rows and the small meta record the index is
  // rebuilt from. Missing the meta blob here would under-report the purge and,
  // worse, leave the record that makes getUploadIndex() resurrect the upload.
  const wanted = new Set(
    uploads.flatMap((u) => [`uploads/${u.id}.json`, uploadMetaKey(u.id)]),
  );
  const all = await listBlobs("uploads/");
  return all.filter((b) => wanted.has(stripPrefix(b.key)));
}

function stripPrefix(key: string): string {
  return key.startsWith("live/") ? key.slice("live/".length) : key;
}

export interface PurgeResult extends PurgePreview {
  deletedBlobs: number;
  failed: { key: string; error: string }[];
}

/**
 * Irreversibly deletes the client and everything it owns.
 *
 * Order matters: blobs first, then the shared indexes, then the client record
 * LAST. If this dies part-way the client row is still present, so the operation
 * can simply be retried — the opposite order would leave data with no owner and
 * no way to find it again.
 */
export async function purgeClient(clientId: string): Promise<PurgeResult> {
  const preview = await previewPurge(clientId);

  const [clientBlobs, salesBlobs] = await Promise.all([
    listBlobs(`clients/${clientId}/`),
    listBlobs(`sales/${clientId}/`),
  ]);

  const failed: { key: string; error: string }[] = [];
  let deletedBlobs = 0;

  // Sequential on purpose — a burst of deletes against Blob is rate-limit bait,
  // and a partial purge is safe to re-run.
  for (const b of [...clientBlobs, ...salesBlobs]) {
    try {
      // deleteBlob returns false when nothing was actually removed — treat that
      // as a failure, not a success, or a bad key silently reports a clean purge
      // while the data is still sitting there costing storage.
      if (await deleteBlob(stripPrefix(b.key))) deletedBlobs++;
      else failed.push({ key: b.key, error: "not found or delete refused" });
    } catch (err) {
      failed.push({ key: b.key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Shared stores clean up their own keys — this module deliberately does not
  // know where uploads/counters/store-report state live.
  deletedBlobs += await deleteUploadsForClient(clientId);
  await deleteClientReportCounts(clientId);
  await removeClientExclusions(clientId);

  // Client record last: if anything above throws, the client is still listed
  // and the purge can simply be re-run. The reverse order would strand data
  // with no owner and no way to find it.
  await deleteClient(clientId);

  return { ...preview, deletedBlobs, failed };
}
