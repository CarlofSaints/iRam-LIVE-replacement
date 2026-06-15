import { readJson, writeJson, deleteBlob } from "./blob";

// Logos are stored as base64 data URLs inside small JSON blobs so they can be
// read server-side (for Excel embedding) and previewed in the UI without a
// public blob store.

export interface LogoData {
  dataUrl: string;      // e.g. "data:image/png;base64,...."
  uploadedAt: string;
  uploadedBy?: string;
}

const clientKey = (clientId: string) => `clients/${clientId}/logo.json`;
const channelKey = (channelId: string) => `channels/${channelId}/logo.json`;

export async function getClientLogo(clientId: string): Promise<LogoData | null> {
  return readJson<LogoData | null>(clientKey(clientId), null);
}

export async function saveClientLogo(clientId: string, logo: LogoData): Promise<void> {
  await writeJson(clientKey(clientId), logo);
}

export async function deleteClientLogo(clientId: string): Promise<void> {
  await deleteBlob(clientKey(clientId));
}

export async function getChannelLogo(channelId: string): Promise<LogoData | null> {
  return readJson<LogoData | null>(channelKey(channelId), null);
}

export async function saveChannelLogo(channelId: string, logo: LogoData): Promise<void> {
  await writeJson(channelKey(channelId), logo);
}

export async function deleteChannelLogo(channelId: string): Promise<void> {
  await deleteBlob(channelKey(channelId));
}

// Validate an incoming data URL: must be an image, within a size cap (~1.5MB).
export function validateLogoDataUrl(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string") return null;
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(dataUrl)) return null;
  // base64 length → bytes ≈ len * 3/4
  const b64 = dataUrl.split(",")[1] ?? "";
  if (b64.length * 0.75 > 1.5 * 1024 * 1024) return null;
  return dataUrl;
}
