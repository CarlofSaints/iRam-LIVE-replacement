import { readJson } from "./blob";
/* ──────────────────────────────────────────────────────────────
   Dropbox client — the control files (PMF, LINKS, Ranging) live in Dropbox
   and are maintained there. This app reads them and writes them BACK to the
   same file; a process on Mark's side then pushes Dropbox into SQL.

   The point of the whole exercise is that there is ONE copy of each file.
   So nothing here writes a second one: every write REPLACES the file it came
   from, and a write that cannot prove it is replacing the version it read is
   refused rather than allowed to land on top of someone else's edit.

   ⚠️ The Dropbox credentials are shared between people, so every caller is
   the same Dropbox user. Dropbox cannot tell us who did anything — the app's
   own activity log is the only record of that, and it is not optional here.
   ────────────────────────────────────────────────────────────── */

/* Read at CALL time, never captured into a module-level const. A const here
   is evaluated when the module is first imported, which is before anything
   that sets the variable later in the same process — so the config would be
   frozen empty and no amount of setting it afterwards would help. */
const APP_KEY = () => process.env.DROPBOX_APP_KEY || "";
const APP_SECRET = () => process.env.DROPBOX_APP_SECRET || "";

/** Where the connect flow parks the refresh token when there is no env var. */
export const DROPBOX_AUTH_KEY = "dropbox/auth.json";

export interface StoredDropboxAuth {
  refreshToken: string;
  connectedAt: string;
  connectedBy: string;
  account: string;
}

/**
 * Where the control files live.
 *
 * The obvious thing to paste here is the address bar from the Dropbox web UI,
 * so that is accepted and converted rather than rejected. A browser URL is
 * not an API path: it is percent-encoded, and on a team account it carries a
 * "/work/<Team>" prefix that exists only in the web UI. Left as-is it
 * produces a folder that cannot be found, and the error says nothing useful.
 *
 * This is a format conversion of an unambiguous input, not a guess at what
 * someone meant — the probe always reports the path it resolved to, so what
 * it is actually using is visible rather than assumed.
 */
export function dropboxRoot(): string {
  const raw = (process.env.DROPBOX_CONTROL_ROOT || "").trim();
  if (!raw) return "";

  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
      /* Strip only the web UI's own prefix — "/work" or "/home" — and NOTHING
         after it. The segment following /work looks like a team name but is a
         real top-level folder inside the team space, so eating it produces a
         path that resolves to nothing. Verified against the live account:
         "/work/OuterJoin/Projects/…" is the folder "/OuterJoin/Projects/…". */
      path = path.replace(/^\/(work|home)(?=\/|$)/i, "");
    } catch {
      return raw.replace(/\/+$/, "");
    }
  }
  try {
    // "%20" is a URL escape, never part of a Dropbox path.
    path = decodeURIComponent(path);
  } catch {
    /* Leave it alone rather than fail: a stray % is better surfaced by the
       probe than swallowed here. */
  }
  path = path.replace(/\/+$/, "");
  if (!path) return "";
  return path.startsWith("/") ? path : "/" + path;
}

/** The value as configured, for a probe to show beside what it resolved to. */
export function dropboxRootRaw(): string {
  return (process.env.DROPBOX_CONTROL_ROOT || "").trim();
}

/* The APP credentials — the half that identifies this integration to Dropbox.
   These are always env vars; they are not something a user can click. */
export function hasAppCredentials(): boolean {
  return !!APP_KEY() && !!APP_SECRET();
}

export function appKey(): string { return APP_KEY(); }
export function appSecret(): string { return APP_SECRET(); }

/* The REFRESH TOKEN — the half that says which Dropbox account, and the half
   that is genuinely awkward to obtain by hand. It can come from an env var,
   but the Connect flow stores it here instead so nobody has to run an OAuth
   exchange in a terminal and copy a credential between two windows. */
export async function getRefreshToken(): Promise<string> {
  const fromEnv = (process.env.DROPBOX_REFRESH_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const stored = await readJson<StoredDropboxAuth | null>(DROPBOX_AUTH_KEY, null);
  return stored?.refreshToken?.trim() || "";
}

export async function getStoredAuth(): Promise<StoredDropboxAuth | null> {
  return readJson<StoredDropboxAuth | null>(DROPBOX_AUTH_KEY, null);
}

export async function isDropboxConnected(): Promise<boolean> {
  return hasAppCredentials() && !!(await getRefreshToken());
}

/** Kept sync for callers that only need the app half. */
export function isDropboxConfigured(): boolean {
  return hasAppCredentials();
}

/** Which pieces are missing, by name, without printing any value. */
export async function dropboxConfigGaps(): Promise<string[]> {
  const gaps: string[] = [];
  if (!APP_KEY()) gaps.push("DROPBOX_APP_KEY");
  if (!APP_SECRET()) gaps.push("DROPBOX_APP_SECRET");
  if (!(await getRefreshToken())) gaps.push("a connected Dropbox account (click Connect)");
  if (!dropboxRoot()) gaps.push("DROPBOX_CONTROL_ROOT");
  return gaps;
}

/* Access tokens last 4 hours, so the refresh token is the only durable
   credential — a plain access token in an env var stops working one
   afternoon with no warning. Cached in module scope: a warm lambda reuses
   it, a cold one just fetches again. Refreshed a minute early so a token
   cannot expire between this check and the call that uses it. */
let cachedToken = "";
let cachedUntil = 0;

async function getAccessToken(): Promise<string> {
  const refresh = await getRefreshToken();
  if (!hasAppCredentials() || !refresh) {
    throw new Error(
      `Dropbox is not ready — missing ${(await dropboxConfigGaps()).join(", ")}`,
    );
  }
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
  });
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Basic auth with the app key/secret is how Dropbox wants the refresh.
      Authorization:
        "Basic " + Buffer.from(APP_KEY() + ":" + APP_SECRET()).toString("base64"),
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    /* Dropbox puts the actionable half in the body, not the status — an
       "invalid_grant" here means the refresh token was revoked or was minted
       without token_access_type=offline, and the status alone never says so.
       See the error-code-without-its-description lesson. */
    throw new Error(`Dropbox token refresh failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error(`Dropbox token refresh returned no access_token: ${text}`);
  }
  cachedToken = json.access_token;
  cachedUntil = Date.now() + Math.max((json.expires_in ?? 14400) - 60, 60) * 1000;
  return cachedToken;
}

/** Force the next call to re-fetch a token. For probes and tests. */
export function resetDropboxTokenCache(): void {
  cachedToken = "";
  cachedUntil = 0;
}

/* Dropbox paths must start with "/" and must NOT be percent-encoded — the
   path travels in a JSON header, not in a URL, so encoding it produces a
   path that writes fine and then cannot be read back. */
export function dropboxPath(...parts: string[]): string {
  const joined = parts
    .map((p) => String(p ?? "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return "/" + joined;
}

/* ── Team spaces ───────────────────────────────────────────────────────────
   On a Dropbox Business account the member's HOME namespace (their personal
   folder) is not the same as the team's ROOT namespace, where shared team
   folders actually live. Without saying otherwise, every API call resolves
   paths against the home namespace — so a real team folder simply is not
   found, and listing the root returns an EMPTY list rather than an error.
   That empty list is the tell, and it is easy to misread as "the connection
   is broken" when the connection is fine.

   Sending Dropbox-API-Path-Root pointed at the team root makes paths mean
   what they look like in the web UI. Fetched once and cached; a personal
   account has root == home and gets no header at all. */
let pathRootHeader: string | null = null;
let pathRootChecked = false;

async function getPathRoot(): Promise<string | null> {
  if (pathRootChecked) return pathRootHeader;
  const token = await getAccessToken();
  const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "null",
    cache: "no-store",
  });
  if (res.ok) {
    const acct = (await res.json()) as {
      root_info?: { root_namespace_id?: string; home_namespace_id?: string };
    };
    const root = acct.root_info?.root_namespace_id;
    const home = acct.root_info?.home_namespace_id;
    pathRootHeader =
      root && root !== home ? JSON.stringify({ ".tag": "root", root }) : null;
  }
  pathRootChecked = true;
  return pathRootHeader;
}

export function resetDropboxPathRoot(): void {
  pathRootHeader = null;
  pathRootChecked = false;
}

/** True when this account's files live in a team space. For the probe. */
export async function usesTeamSpace(): Promise<boolean> {
  return (await getPathRoot()) !== null;
}

async function authHeaders(token: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const root = await getPathRoot();
  if (root) headers["Dropbox-API-Path-Root"] = root;
  return headers;
}

async function rpc<T>(endpoint: string, arg: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: {
      ...(endpoint === "users/get_current_account" ? { Authorization: `Bearer ${token}` } : await authHeaders(token)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(arg),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Dropbox ${endpoint} failed (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface DropboxEntry {
  name: string;
  path: string;
  /** Dropbox's version marker. Required to replace the file safely. */
  rev: string;
  size: number;
  modified: string;
  isFolder: boolean;
}

interface RawEntry {
  ".tag": string;
  name: string;
  path_lower?: string;
  path_display?: string;
  rev?: string;
  size?: number;
  server_modified?: string;
}

function toEntry(e: RawEntry): DropboxEntry {
  return {
    name: e.name,
    path: e.path_display || e.path_lower || "",
    rev: e.rev || "",
    size: e.size ?? 0,
    modified: e.server_modified || "",
    isFolder: e[".tag"] === "folder",
  };
}

/** List one folder. Follows cursors, so a folder over 2,000 entries is whole. */
export async function listFolder(path: string): Promise<DropboxEntry[]> {
  const out: DropboxEntry[] = [];
  let r = await rpc<{ entries: RawEntry[]; cursor: string; has_more: boolean }>(
    "files/list_folder",
    // "" is Dropbox's root; any other path must not have a trailing slash.
    { path: path === "/" ? "" : path.replace(/\/+$/, ""), recursive: false },
  );
  out.push(...r.entries.map(toEntry));
  while (r.has_more) {
    r = await rpc("files/list_folder/continue", { cursor: r.cursor });
    out.push(...r.entries.map(toEntry));
  }
  return out;
}

/** Metadata for one file, including the rev a later replace must quote. */
export async function getMetadata(path: string): Promise<DropboxEntry> {
  return toEntry(await rpc<RawEntry>("files/get_metadata", { path }));
}

/** Download a file's bytes, plus the rev they were read at. */
export async function downloadFile(
  path: string,
): Promise<{ buffer: Buffer; entry: DropboxEntry }> {
  const token = await getAccessToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      ...(await authHeaders(token)),
      // The path rides in a header as JSON — Latin-1 only, so a non-ASCII
      // filename must be escaped rather than sent raw.
      "Dropbox-API-Arg": toApiArgHeader({ path }),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Dropbox download failed (${res.status}): ${await res.text()}`);
  }
  const meta = JSON.parse(res.headers.get("dropbox-api-result") || "{}") as RawEntry;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, entry: toEntry(meta) };
}

/* HTTP headers are Latin-1. A client name with an accent or a non-breaking
   space in it would otherwise throw at fetch() time, so escape anything
   outside ASCII the way Dropbox documents. */
function toApiArgHeader(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-\uffff]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export class DropboxConflictError extends Error {
  constructor(public path: string, public expectedRev: string) {
    super(
      `"${path}" changed in Dropbox since it was downloaded, so it was NOT overwritten. ` +
      `Download it again, redo the edit on the current version, and upload that.`,
    );
    this.name = "DropboxConflictError";
  }
}

/**
 * REPLACE a file in place.
 *
 * `rev` is the version the editor started from. Dropbox refuses the write if
 * the file has moved on since, which is the whole safety property: the
 * credentials are shared, so two people are indistinguishable to Dropbox and
 * a blind overwrite would silently destroy a colleague's edit with no trace
 * of who did it. A conflict is surfaced, never resolved automatically.
 */
export async function replaceFile(
  path: string,
  contents: Buffer,
  rev: string,
): Promise<DropboxEntry> {
  if (!rev) {
    throw new Error(
      "Refusing to write without the rev the file was read at — that would overwrite " +
      "whatever is there now, which is the exact failure this integration exists to prevent.",
    );
  }
  const token = await getAccessToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      ...(await authHeaders(token)),
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": toApiArgHeader({
        path,
        // "update" + rev means "replace, but only if it is still this version".
        mode: { ".tag": "update", update: rev },
        // Never let Dropbox invent "file (1).xlsx" — a second copy is the silo.
        autorename: false,
        mute: false,
      }),
    },
    body: new Uint8Array(contents),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    if (text.includes("conflict")) throw new DropboxConflictError(path, rev);
    throw new Error(`Dropbox upload failed (${res.status}): ${text}`);
  }
  const entry = toEntry(JSON.parse(text) as RawEntry);
  /* autorename:false means a conflict comes back as an error, but a changed
     NAME would mean Dropbox wrote a copy anyway — check rather than assume. */
  if (entry.path && path && entry.path.toLowerCase() !== path.toLowerCase()) {
    throw new Error(
      `Dropbox wrote "${entry.path}" instead of replacing "${path}" — a second copy was created.`,
    );
  }
  return entry;
}

/** Cheap round trip proving the credentials work, for a probe endpoint. */
export async function probeDropbox(): Promise<{
  ok: boolean;
  account?: string;
  root?: string;
  rootEntries?: number;
  error?: string;
  gaps: string[];
}> {
  const gaps = await dropboxConfigGaps();
  if (gaps.length) return { ok: false, gaps, error: `Missing ${gaps.join(", ")}` };
  try {
    const acct = await rpc<{ name?: { display_name?: string }; email?: string }>(
      "users/get_current_account",
      null,
    );
    const out: Awaited<ReturnType<typeof probeDropbox>> = {
      ok: true,
      account: acct.email || acct.name?.display_name || "unknown",
      gaps,
    };
    if (dropboxRoot()) {
      out.root = dropboxRoot();
      out.rootEntries = (await listFolder(dropboxRoot())).length;
    }
    return out;
  } catch (e) {
    return { ok: false, gaps, error: e instanceof Error ? e.message : String(e) };
  }
}
