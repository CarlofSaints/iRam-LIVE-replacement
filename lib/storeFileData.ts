import type { StoreControlFile, StoreRecord } from "./types";
import { readJson, writeJson, deleteBlob } from "./blob";
import { v4 as uuid } from "uuid";

const INDEX_KEY = "store-files/index.json";
const MERGED_KEY = "store-files/merged.json";

function fileDataKey(id: string): string {
  return `store-files/${id}.json`;
}

// ── Index CRUD ──

export async function getStoreFileIndex(): Promise<StoreControlFile[]> {
  return readJson<StoreControlFile[]>(INDEX_KEY, []);
}

export async function addStoreFile(
  meta: Omit<StoreControlFile, "id">,
  records: StoreRecord[]
): Promise<StoreControlFile> {
  const index = await getStoreFileIndex();
  const file: StoreControlFile = { id: uuid(), ...meta };

  // Mark previous files covering any of the same sub-channels as replaced
  // (we keep them in the index for history, but merged.json only uses the latest)
  index.push(file);
  await writeJson(INDEX_KEY, index);

  // Save parsed data
  await writeJson(fileDataKey(file.id), records);

  // Rebuild merged store master
  await rebuildMerged(index);

  return file;
}

export async function deleteStoreFile(id: string): Promise<void> {
  const index = await getStoreFileIndex();
  const filtered = index.filter((f) => f.id !== id);
  await writeJson(INDEX_KEY, filtered);
  await deleteBlob(fileDataKey(id));
  await rebuildMerged(filtered);
}

export async function getStoreFileRecords(id: string): Promise<StoreRecord[]> {
  return readJson<StoreRecord[]>(fileDataKey(id), []);
}

// ── Merged Store Master ──

export async function getMergedStores(): Promise<StoreRecord[]> {
  return readJson<StoreRecord[]>(MERGED_KEY, []);
}

/**
 * Rebuilds the merged store master from the latest file per sub-channel.
 * For each sub-channel, the most recently uploaded file wins.
 */
async function rebuildMerged(index: StoreControlFile[]): Promise<void> {
  // Find the latest file for each sub-channel
  const latestBySubChannel = new Map<string, StoreControlFile>();

  // Sort by uploadedAt ascending so later entries overwrite earlier ones
  const sorted = [...index].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );

  for (const file of sorted) {
    for (const subId of file.subChannelIds) {
      latestBySubChannel.set(subId, file);
    }
  }

  // Collect unique file IDs to load
  const fileIds = new Set<string>();
  for (const file of latestBySubChannel.values()) {
    fileIds.add(file.id);
  }

  // Load and merge records
  const allRecords: StoreRecord[] = [];
  for (const fileId of fileIds) {
    const records = await readJson<StoreRecord[]>(fileDataKey(fileId), []);
    allRecords.push(...records);
  }

  await writeJson(MERGED_KEY, allRecords);
}

// ── Excel Parsing ──

const HEADER_MAP: Record<string, keyof StoreRecord> = {
  "site num": "siteNum",
  "store name": "storeName",
  channel: "channel",
  sub_channel: "subChannel",
  country: "country",
  province: "province",
  "town/city": "townCity",
  address: "address",
  "postal code": "postalCode",
  latitude: "latitude",
  longitude: "longitude",
  status: "status",
  "opened date": "openedDate",
  "top 100": "top100",
  type: "type",
  "cluster code": "clusterCode",
  "cluster name": "clusterName",
  "cluster group": "clusterGroup",
  tags: "tags",
};

export function parseStoreExcel(
  sheetData: Record<string, unknown>[]
): StoreRecord[] {
  const records: StoreRecord[] = [];

  for (const row of sheetData) {
    // Build a normalised key map for this row
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      norm[k.toLowerCase().trim()] = v;
    }

    const siteNum = String(norm["site num"] ?? "").trim();
    const storeName = String(norm["store name"] ?? "").trim();
    if (!siteNum && !storeName) continue; // skip empty rows

    const record: StoreRecord = {
      siteNum,
      storeName,
      channel: String(norm["channel"] ?? "").trim(),
      subChannel: String(norm["sub_channel"] ?? "").trim(),
      status: String(norm["status"] ?? "ACTIVE").trim().toUpperCase(),
    };

    // Optional fields
    if (norm["country"]) record.country = String(norm["country"]).trim();
    if (norm["province"]) record.province = String(norm["province"]).trim();
    if (norm["town/city"]) record.townCity = String(norm["town/city"]).trim();
    if (norm["address"]) record.address = String(norm["address"]).trim();
    if (norm["postal code"]) record.postalCode = String(norm["postal code"]).trim();

    const lat = Number(norm["latitude"]);
    const lng = Number(norm["longitude"]);
    if (!isNaN(lat) && lat !== 0) record.latitude = lat;
    if (!isNaN(lng) && lng !== 0) record.longitude = lng;

    if (norm["opened date"]) record.openedDate = String(norm["opened date"]).trim();

    const top100 = norm["top 100"];
    if (top100 !== undefined && top100 !== null) {
      record.top100 =
        String(top100).toLowerCase() === "true" ||
        String(top100) === "1" ||
        String(top100).toLowerCase() === "yes";
    }

    if (norm["type"]) record.type = String(norm["type"]).trim();
    if (norm["cluster code"]) record.clusterCode = String(norm["cluster code"]).trim();
    if (norm["cluster name"]) record.clusterName = String(norm["cluster name"]).trim();
    if (norm["cluster group"]) record.clusterGroup = String(norm["cluster group"]).trim();
    if (norm["tags"]) record.tags = String(norm["tags"]).trim();

    records.push(record);
  }

  return records;
}
