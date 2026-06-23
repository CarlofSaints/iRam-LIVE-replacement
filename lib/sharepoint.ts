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

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function errText(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 200);
}

// Method 1 — resolve any sharing/folder URL to a driveItem via /shares.
// Works well for "Copy link" share URLs (the /:f:/s/… form).
async function resolveViaShares(
  folderUrl: string,
  token: string
): Promise<{ driveId: string; itemId: string }> {
  const share = encodeShareUrl(toAbsoluteUrl(folderUrl));
  const res = await fetch(
    `${GRAPH}/shares/${share}/driveItem?$select=id,parentReference`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`/shares ${res.status}: ${await errText(res)}`);
  const item = (await res.json()) as { id?: string; parentReference?: { driveId?: string } };
  const driveId = item.parentReference?.driveId;
  if (!item.id || !driveId) throw new Error("/shares did not return a drive item");
  return { driveId, itemId: item.id };
}

// Method 2 — resolve by site + document library + path. Handles browser "view"
// URLs (…/AllItems.aspx?id=%2Fsites%2F…) and plain path URLs that /shares rejects.
async function resolveViaSite(
  folderUrl: string,
  token: string
): Promise<{ driveId: string; itemId: string }> {
  const abs = new URL(toAbsoluteUrl(folderUrl));
  const host = abs.host;
  // The folder's server-relative path: the ?id= param if present (view URLs),
  // otherwise the URL pathname.
  const serverRel = decodeURIComponent(abs.searchParams.get("id") ?? abs.pathname).replace(/\/+$/, "");
  const segs = serverRel.split("/").filter(Boolean);
  const sitePath = segs[0] === "sites" || segs[0] === "teams" ? `/${segs[0]}/${segs[1]}` : "";

  // Site id
  const siteRes = await fetch(`${GRAPH}/sites/${host}${sitePath ? `:${sitePath}` : ""}?$select=id`, {
    headers: authHeaders(token),
  });
  if (!siteRes.ok) throw new Error(`/sites ${siteRes.status}: ${await errText(siteRes)}`);
  const siteId = ((await siteRes.json()) as { id?: string }).id;
  if (!siteId) throw new Error("/sites returned no id");

  // Find the document library (drive) whose webUrl is a prefix of the folder URL
  const drivesRes = await fetch(`${GRAPH}/sites/${siteId}/drives?$select=id,webUrl`, {
    headers: authHeaders(token),
  });
  if (!drivesRes.ok) throw new Error(`/drives ${drivesRes.status}: ${await errText(drivesRes)}`);
  const drives = ((await drivesRes.json()) as { value?: { id: string; webUrl: string }[] }).value ?? [];

  const folderAbs = `https://${host}${serverRel}`.replace(/\/+$/, "");
  let driveId = "";
  let rel = "";
  for (const d of drives) {
    const w = decodeURIComponent(d.webUrl).replace(/\/+$/, "");
    if (folderAbs === w) { driveId = d.id; rel = ""; break; }
    if (folderAbs.startsWith(w + "/")) { driveId = d.id; rel = folderAbs.slice(w.length + 1); break; }
  }
  if (!driveId) throw new Error("no document library matched the folder path");

  // Resolve the folder item (root, or by path within the library)
  const itemUrl = rel
    ? `${GRAPH}/drives/${driveId}/root:/${rel.split("/").map(encodeURIComponent).join("/")}?$select=id`
    : `${GRAPH}/drives/${driveId}/root?$select=id`;
  const itemRes = await fetch(itemUrl, { headers: authHeaders(token) });
  if (!itemRes.ok) throw new Error(`/drives item ${itemRes.status}: ${await errText(itemRes)}`);
  const itemId = ((await itemRes.json()) as { id?: string }).id;
  if (!itemId) throw new Error("folder path returned no item id");
  return { driveId, itemId };
}

async function resolveFolder(
  folderUrl: string,
  token: string
): Promise<{ driveId: string; itemId: string }> {
  try {
    return await resolveViaShares(folderUrl, token);
  } catch (e1) {
    try {
      return await resolveViaSite(folderUrl, token);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(
        `Could not resolve SharePoint folder. Check the folder link and the app's access. [${m1}] [${m2}]`
      );
    }
  }
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
