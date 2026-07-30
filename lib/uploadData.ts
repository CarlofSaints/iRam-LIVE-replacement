import type { UploadMeta } from "./types";
import { readJson, writeJson, deleteBlob } from "./blob";
import { v4 as uuid } from "uuid";

const INDEX_KEY = "uploads/index.json";

function dataKey(id: string): string {
  return `uploads/${id}.json`;
}

export async function getUploadIndex(): Promise<UploadMeta[]> {
  return readJson<UploadMeta[]>(INDEX_KEY, []);
}

export async function getUploadById(id: string): Promise<UploadMeta | null> {
  const index = await getUploadIndex();
  return index.find((u) => u.id === id) ?? null;
}

export async function getUploadsByClient(clientId: string): Promise<UploadMeta[]> {
  const index = await getUploadIndex();
  return index.filter((u) => u.clientId === clientId);
}

export async function addUpload(
  meta: Omit<UploadMeta, "id">,
  data: Record<string, unknown>[]
): Promise<UploadMeta> {
  const index = await getUploadIndex();
  const upload: UploadMeta = { id: uuid(), ...meta };
  index.unshift(upload); // newest first
  await writeJson(INDEX_KEY, index);
  await writeJson(dataKey(upload.id), data);
  return upload;
}

export async function getUploadData(
  id: string
): Promise<Record<string, unknown>[]> {
  return readJson<Record<string, unknown>[]>(dataKey(id), []);
}

/**
 * Drops every index entry for a client and deletes its row blobs.
 * Used by the client purge — returns how many uploads were removed.
 */
export async function deleteUploadsForClient(clientId: string): Promise<number> {
  const index = await getUploadIndex();
  const mine = index.filter((u) => u.clientId === clientId);
  if (mine.length === 0) return 0;
  await writeJson(INDEX_KEY, index.filter((u) => u.clientId !== clientId));
  let deleted = 0;
  for (const u of mine) if (await deleteBlob(dataKey(u.id))) deleted++;
  return deleted;
}

export async function deleteUpload(id: string): Promise<void> {
  const index = await getUploadIndex();
  const filtered = index.filter((u) => u.id !== id);
  await writeJson(INDEX_KEY, filtered);
  await deleteBlob(dataKey(id));
}
