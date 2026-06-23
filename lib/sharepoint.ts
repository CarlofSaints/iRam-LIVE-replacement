/* ──────────────────────────────────────────────────────────────
   SharePoint upload (Microsoft Graph, app-only / client credentials)

   Saves generated report files into a client's SharePoint folder.
   Reuses the existing iRam Azure app registration via env vars:
     IRAM_TENANT_ID, IRAM_CLIENT_ID, IRAM_CLIENT_SECRET
   (Graph application permissions Sites.ReadWrite.All / Files.ReadWrite.All.)
   ────────────────────────────────────────────────────────────── */

const GRAPH = "https://graph.microsoft.com/v1.0";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isSharePointConfigured(): boolean {
  return !!(
    process.env.IRAM_TENANT_ID &&
    process.env.IRAM_CLIENT_ID &&
    process.env.IRAM_CLIENT_SECRET
  );
}

// ── Token (cached in-memory until ~1 min before expiry) ───────────
let _token: { value: string; exp: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (_token && Date.now() < _token.exp - 60_000) return _token.value;

  const tenant = process.env.IRAM_TENANT_ID!;
  const body = new URLSearchParams({
    client_id: process.env.IRAM_CLIENT_ID!,
    client_secret: process.env.IRAM_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SharePoint auth failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  _token = {
    value: json.access_token,
    exp: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return _token.value;
}

// ── Resolve a SharePoint folder URL to a drive item ───────────────
// Graph can turn any sharing/folder URL into a driveItem via /shares.

// Accept either a full https URL or a server-relative path (prefixed with the
// tenant host from IRAM_SP_HOST, e.g. "/sites/Reports/Shared Documents/ClientX").
function toAbsoluteUrl(folder: string): string {
  const v = folder.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const host = process.env.IRAM_SP_HOST;
  if (!host) {
    throw new Error(
      "SharePoint folder is a relative path but IRAM_SP_HOST is not set. Paste a full SharePoint link, or set IRAM_SP_HOST."
    );
  }
  return `https://${host}${v.startsWith("/") ? v : `/${v}`}`;
}

function encodeShareUrl(url: string): string {
  const b64 = Buffer.from(url.trim(), "utf8").toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

async function resolveFolder(
  folderUrl: string,
  token: string
): Promise<{ driveId: string; itemId: string }> {
  const share = encodeShareUrl(toAbsoluteUrl(folderUrl));
  const res = await fetch(
    `${GRAPH}/shares/${share}/driveItem?$select=id,name,folder,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Could not resolve SharePoint folder (${res.status}). Check the folder URL and that the app has access. ${txt.slice(0, 200)}`
    );
  }
  const item = (await res.json()) as {
    id?: string;
    folder?: unknown;
    parentReference?: { driveId?: string };
  };
  const driveId = item.parentReference?.driveId;
  if (!item.id || !driveId) {
    throw new Error("SharePoint URL did not resolve to a folder in a document library.");
  }
  return { driveId, itemId: item.id };
}

/**
 * Upload a report file into a client's SharePoint folder, overwriting any
 * existing file of the same name. Returns the uploaded file's webUrl.
 * Suitable for files up to ~250 MB (single PUT); reports are a few MB.
 */
export async function uploadReportToSharePoint(
  folderUrl: string,
  fileName: string,
  data: Uint8Array | ArrayBuffer
): Promise<string> {
  const token = await getGraphToken();
  const { driveId, itemId } = await resolveFolder(folderUrl, token);

  // PUT /drives/{drive}/items/{folder}:/{name}:/content
  const path = encodeURIComponent(fileName);
  const res = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}:/${path}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": XLSX_CONTENT_TYPE,
      },
      body: new Blob([data as BlobPart], { type: XLSX_CONTENT_TYPE }),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SharePoint upload failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const item = (await res.json()) as { webUrl?: string };
  return item.webUrl ?? "";
}

/**
 * Best-effort save used by the report routes. Never throws — returns response
 * headers describing the outcome so the client can show a toast:
 *   (no folder set)        → {}                       (nothing to do)
 *   server not configured  → X-SP-Saved: error + reason
 *   success                → X-SP-Saved: ok
 *   failure                → X-SP-Saved: error + X-SP-Error (URI-encoded)
 */
export async function saveReportToSharePointSafe(
  folderUrl: string | undefined | null,
  fileName: string,
  data: Uint8Array | ArrayBuffer
): Promise<Record<string, string>> {
  const folder = (folderUrl ?? "").trim();
  if (!folder) return {};
  if (!isSharePointConfigured()) {
    return { "X-SP-Saved": "error", "X-SP-Error": "SharePoint%20not%20configured" };
  }
  try {
    await uploadReportToSharePoint(folder, fileName, data);
    return { "X-SP-Saved": "ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return { "X-SP-Saved": "error", "X-SP-Error": encodeURIComponent(msg).slice(0, 400) };
  }
}
