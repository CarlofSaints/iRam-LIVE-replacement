import { list } from "@vercel/blob";
import { getClients } from "./clientData";
import { getUploadIndex } from "./uploadData";

// All app blobs live under this prefix (see lib/blob.ts).
const PREFIX = "live/";

export interface ClientStorage {
  clientId: string;
  clientName: string;
  bytes: number;
  blobCount: number;
}

export interface StorageReport {
  totalBytes: number;
  totalBlobs: number;
  clients: ClientStorage[]; // sorted largest first
  sharedBytes: number; // blobs not tied to one client (indexes, channel logos, store master…)
  sharedBlobs: number;
  generatedAt: string;
  metered: boolean; // false when running locally without a Blob store
}

/**
 * Walk every blob in the store and attribute its size to a client.
 *
 * Attribution rules (see key patterns in salesData/controlFileData/logoData):
 *  - Client-scoped keys embed the clientId as a path segment
 *    (`sales/{clientId}/…`, `clients/{clientId}/…`) → attributed directly.
 *  - Per-upload row blobs are keyed `uploads/{uploadId}.json` → mapped to their
 *    client via the upload index.
 *  - Everything else (indexes, channel logos, merged store master, store-report
 *    state…) is genuinely shared → counted under "shared".
 */
export async function computeStorageReport(): Promise<StorageReport> {
  const generatedAt = new Date().toISOString();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Local/dev uses the filesystem, not Blob — nothing to meter.
    return {
      totalBytes: 0,
      totalBlobs: 0,
      clients: [],
      sharedBytes: 0,
      sharedBlobs: 0,
      generatedAt,
      metered: false,
    };
  }

  const [clients, uploads] = await Promise.all([getClients(), getUploadIndex()]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const clientIds = new Set(clients.map((c) => c.id));
  const uploadToClient = new Map(uploads.map((u) => [u.id, u.clientId]));

  const bytesByClient = new Map<string, number>();
  const countByClient = new Map<string, number>();
  let totalBytes = 0;
  let totalBlobs = 0;
  let sharedBytes = 0;
  let sharedBlobs = 0;

  let cursor: string | undefined;
  do {
    const res = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const b of res.blobs) {
      const size = b.size ?? 0;
      totalBytes += size;
      totalBlobs++;

      const cid = attributeClient(b.pathname, clientIds, uploadToClient);
      if (cid) {
        bytesByClient.set(cid, (bytesByClient.get(cid) ?? 0) + size);
        countByClient.set(cid, (countByClient.get(cid) ?? 0) + 1);
      } else {
        sharedBytes += size;
        sharedBlobs++;
      }
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);

  const clientsOut: ClientStorage[] = [...bytesByClient.entries()]
    .map(([clientId, bytes]) => ({
      clientId,
      clientName: clientName.get(clientId) ?? "(deleted client)",
      bytes,
      blobCount: countByClient.get(clientId) ?? 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    totalBytes,
    totalBlobs,
    clients: clientsOut,
    sharedBytes,
    sharedBlobs,
    generatedAt,
    metered: true,
  };
}

function attributeClient(
  pathname: string,
  clientIds: Set<string>,
  uploadToClient: Map<string, string>,
): string | null {
  const key = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : pathname;
  const segs = key.split("/");

  // Any segment that is a known clientId (covers sales/{id}/… and clients/{id}/…).
  for (const s of segs) {
    if (clientIds.has(s)) return s;
  }

  // Per-upload row blobs: uploads/{uploadId}.json → resolve via the upload index.
  if (segs[0] === "uploads" && segs[1]) {
    const uploadId = segs[1].replace(/\.json$/, "");
    const cid = uploadToClient.get(uploadId);
    if (cid && clientIds.has(cid)) return cid;
  }

  return null;
}
