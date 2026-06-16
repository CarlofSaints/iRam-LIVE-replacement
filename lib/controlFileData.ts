import type { ControlFileType, ControlFileMeta } from "./types";
import { readJson, writeJson, deleteBlob } from "./blob";
import { setControlFileMeta } from "./clientData";

function blobKey(clientId: string, fileType: ControlFileType): string {
  const fileNames: Record<ControlFileType, string> = {
    pmf: "pmf.json",
    links: "links.json",
    ranging: "ranging.json",
    custom_sites: "custom-sites.json",
    promotions: "promotions.json",
  };
  return `clients/${clientId}/${fileNames[fileType]}`;
}

export const CONTROL_FILE_LABELS: Record<ControlFileType, string> = {
  pmf: "PMF (Product Management File)",
  links: "Links",
  ranging: "Ranging",
  custom_sites: "Custom Sites",
  promotions: "Promotions",
};

export async function getControlFileData<T>(
  clientId: string,
  fileType: ControlFileType
): Promise<T[]> {
  return readJson<T[]>(blobKey(clientId, fileType), []);
}

/** Read raw (unparsed) PMF rows — preserves all original columns for header detection. */
export async function getRawPmfData(
  clientId: string
): Promise<Record<string, unknown>[]> {
  return readJson<Record<string, unknown>[]>(`clients/${clientId}/pmf-raw.json`, []);
}

/** Save raw (unparsed) PMF rows alongside the parsed data. */
export async function saveRawPmfData(
  clientId: string,
  rawRows: Record<string, unknown>[]
): Promise<void> {
  await writeJson(`clients/${clientId}/pmf-raw.json`, rawRows);
}

/** Read raw (unparsed) LINKS rows — preserves all original columns for header detection. */
export async function getRawLinksData(
  clientId: string
): Promise<Record<string, unknown>[]> {
  return readJson<Record<string, unknown>[]>(`clients/${clientId}/links-raw.json`, []);
}

/** Save raw (unparsed) LINKS rows alongside the parsed data. */
export async function saveRawLinksData(
  clientId: string,
  rawRows: Record<string, unknown>[]
): Promise<void> {
  await writeJson(`clients/${clientId}/links-raw.json`, rawRows);
}

export async function saveControlFileData<T>(
  clientId: string,
  fileType: ControlFileType,
  data: T[],
  meta: ControlFileMeta
): Promise<void> {
  await writeJson(blobKey(clientId, fileType), data);
  await setControlFileMeta(clientId, fileType, meta);
}

export async function deleteControlFile(
  clientId: string,
  fileType: ControlFileType
): Promise<void> {
  await deleteBlob(blobKey(clientId, fileType));
  // Also clean up raw data when PMF or LINKS is deleted
  if (fileType === "pmf") {
    await deleteBlob(`clients/${clientId}/pmf-raw.json`);
  }
  if (fileType === "links") {
    await deleteBlob(`clients/${clientId}/links-raw.json`);
  }
  await setControlFileMeta(clientId, fileType, null);
}

// ── Parsers for each control file type ──

export function parsePmfSheet(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows
    .filter((r) => {
      const id = String(r["CLIENT PRODUCT ID"] ?? r["Client Product Id"] ?? "").trim();
      return id.length > 0;
    })
    .map((r) => normalizeKeys(r));
}

export function parseLinksSheet(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows
    .filter((r) => {
      const article = String(r["Article"] ?? r["article"] ?? "").trim();
      return article.length > 0;
    })
    .map((r) => normalizeKeys(r));
}

export function parseRangingSheet(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows
    .filter((r) => {
      // Ranging headers carry Helper/Mandatory prefixes (e.g. "HelperProductID"),
      // so resolve ProductID tolerantly — see rangingField() in lib/monthEndReport.ts.
      const prodId = resolveRangingField(r, ["productid"]);
      return prodId.length > 0;
    })
    .map((r) => normalizeKeys(r));
}

/** Resolve a ranging-file field, tolerating Helper/Mandatory prefixes + spacing/underscores. */
function resolveRangingField(
  row: Record<string, unknown>,
  targets: string[]
): string {
  for (const [k, v] of Object.entries(row)) {
    const nk = k
      .trim()
      .toLowerCase()
      .replace(/^helper/, "")
      .replace(/^mandatory/, "")
      .replace(/[\s_]+/g, "");
    if (targets.includes(nk)) return v == null ? "" : String(v).trim();
  }
  return "";
}

export function parseCustomSitesSheet(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows
    .filter((r) => {
      const siteId = String(r["SiteID"] ?? r["siteid"] ?? "").trim();
      return siteId.length > 0;
    })
    .map((r) => normalizeKeys(r));
}

export function parsePromotionsSheet(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows
    .filter((r) => {
      const article = String(r["Article"] ?? r["article"] ?? "").trim();
      return article.length > 0;
    })
    .map((r) => normalizeKeys(r));
}

function normalizeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.trim()] = v;
  }
  return out;
}
