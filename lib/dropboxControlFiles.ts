/* ──────────────────────────────────────────────────────────────
   The control files as they actually sit in Dropbox, per client.

   Layout, read off the live account:
     <DROPBOX_CONTROL_ROOT>/<CLIENT>/<CLIENT> Product Managment.xlsx   <- PMF
     <DROPBOX_CONTROL_ROOT>/<CLIENT>/<CLIENT> Product Links.xlsx       <- LINKS
     <DROPBOX_CONTROL_ROOT>/<CLIENT>/<CLIENT> Range Management.xlsx    <- Ranging
     <DROPBOX_CONTROL_ROOT>/<CLIENT>/<CLIENT> Custom Store List.xlsx   <- Custom sites

   ⚠️ "Managment" is spelt that way in Dropbox. It is their filename, not a
   typo to fix — matching on the correct spelling finds nothing.

   Files are matched by what the name CONTAINS, not by rebuilding it from the
   client name. A folder whose files are named slightly differently still
   resolves, and a client renamed in the app does not silently stop finding
   its own files.
   ────────────────────────────────────────────────────────────── */

import { listFolder, dropboxPath, dropboxRoot, type DropboxEntry } from "./dropbox";
import type { Client } from "./types";

/* A client flagged Manual Control File Load is not part of the round trip.
   Refused at the API, not just hidden on the tab: the UI gate is a
   convenience and every one of these routes is reachable without it. Returns
   the refusal, or null when the client is fine to proceed. */
export function refuseIfManualLoad(client: Client): Response | null {
  if (!client.manualControlFileLoad) return null;
  return Response.json(
    {
      error:
        `${client.name} is set to Manual Control File Load, so it is not part of the Dropbox round trip. ` +
        "Load its control files on the Control Files tab instead.",
      manualControlFileLoad: true,
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

export type ControlFileKind = "pmf" | "links" | "ranging" | "custom_sites";

export const CONTROL_FILE_KINDS: {
  kind: ControlFileKind;
  label: string;
  /** Lower-cased fragment the Dropbox filename must contain. */
  match: string;
  /** What it feeds, so the UI can say why it matters. */
  feeds: string;
}[] = [
  { kind: "pmf", label: "Product Management (PMF)", match: "product managment", feeds: "Product master — brands, categories, descriptions" },
  { kind: "links", label: "Product Links", match: "product links", feeds: "Article → Product ID. Gates every DISPO upload" },
  { kind: "ranging", label: "Range Management", match: "range management", feeds: "Ranging — drives Numerical Distribution" },
  { kind: "custom_sites", label: "Custom Store List", match: "custom store list", feeds: "Custom site list" },
];

export interface ControlFileEntry {
  kind: ControlFileKind | null;
  label: string;
  feeds: string;
  name: string;
  path: string;
  rev: string;
  size: number;
  modified: string;
}

/** Folders that are not control files and must never be offered for edit. */
function isNoise(name: string): boolean {
  const n = name.toUpperCase();
  return n.startsWith("_BACKUP") || n === "OLD" || n.startsWith("_OLD");
}

/**
 * Find a client's folder.
 *
 * Tries the SQL name first, then the iRam name, then a case-insensitive scan
 * of the root. Deliberately NOT a fuzzy match: picking the wrong folder would
 * put one client's edit into another client's file, which is unrecoverable in
 * a way that a "folder not found" message is not.
 */
export async function findClientFolder(
  candidates: string[],
): Promise<{ path: string; matched: string } | null> {
  const root = dropboxRoot();
  if (!root) return null;

  const wanted = candidates.map((c) => (c || "").trim()).filter(Boolean);
  if (!wanted.length) return null;

  const folders = (await listFolder(root)).filter((e) => e.isFolder && !isNoise(e.name));

  for (const want of wanted) {
    const hit = folders.find((f) => f.name.toUpperCase() === want.toUpperCase());
    if (hit) return { path: hit.path || dropboxPath(root, hit.name), matched: hit.name };
  }
  return null;
}

/**
 * Resolve a client's Dropbox folder.
 *
 * An explicit `dropboxFolder` on the client WINS and is never second-guessed
 * — that is the entire point of setting it. Only when it is absent does this
 * fall back to matching the SQL name and then the iRam name, which works for
 * the clients whose folder happens to be named the same and fails cleanly for
 * the rest.
 *
 * The explicit path is still LISTED before being returned: a folder that was
 * renamed or deleted in Dropbox has to read as "that folder is gone", not as
 * a confusing failure three calls later inside an upload.
 */
export async function resolveClientFolder(
  client: Client,
): Promise<{ path: string; matched: string; explicit: boolean; error?: string } | null> {
  const explicit = (client.dropboxFolder || "").trim();
  if (explicit) {
    try {
      await listFolder(explicit);
      return { path: explicit, matched: explicit, explicit: true };
    } catch (e) {
      return {
        path: explicit,
        matched: explicit,
        explicit: true,
        error:
          `The Dropbox folder set for ${client.name} could not be opened: ${explicit}. ` +
          `It may have been renamed or moved. ${e instanceof Error ? e.message : ""}`.trim(),
      };
    }
  }
  const hit = await findClientFolder([client.sqlClientName || "", client.name]);
  return hit ? { ...hit, explicit: false } : null;
}

/** The control files in one client folder, classified. */
export async function listControlFiles(
  folderPath: string,
  /* When the client has named its files explicitly, the NAME decides the kind
     — no filename guessing at all. Without this, classification leans on the
     filename containing "product managment", which only ever worked because
     that misspelling happens to be consistent in Dropbox. */
  explicitFiles?: Record<string, string>,
): Promise<ControlFileEntry[]> {
  const entries = await listFolder(folderPath);
  const out: ControlFileEntry[] = [];

  // name (lower-cased) → the kind the client pinned it to
  const pinned = new Map<string, ControlFileKind>();
  for (const [kind, name] of Object.entries(explicitFiles || {})) {
    if (name && CONTROL_FILE_KINDS.some((k) => k.kind === kind)) {
      pinned.set(name.trim().toLowerCase(), kind as ControlFileKind);
    }
  }

  for (const e of entries) {
    if (e.isFolder || isNoise(e.name)) continue;
    if (!/\.xlsx?$/i.test(e.name)) continue;

    const lower = e.name.toLowerCase();
    /* A pinned name wins outright. Falling back to the contains-match only
       when nothing is pinned keeps existing clients working untouched. */
    const pinnedKind = pinned.get(lower);
    const spec = pinnedKind
      ? CONTROL_FILE_KINDS.find((k) => k.kind === pinnedKind)
      : pinned.size > 0
        ? undefined // this client states its files; anything else is not one
        : CONTROL_FILE_KINDS.find((k) => lower.includes(k.match));
    out.push({
      kind: spec?.kind ?? null,
      label: spec?.label ?? e.name.replace(/\.xlsx?$/i, ""),
      feeds: spec?.feeds ?? "Not one of the four known control files",
      name: e.name,
      path: e.path,
      rev: e.rev,
      size: e.size,
      modified: e.modified,
    });
  }

  /* Known kinds first and in a stable order, so the list does not reshuffle
     between visits just because Dropbox returned entries differently. */
  const order = CONTROL_FILE_KINDS.map((k) => k.kind);
  out.sort((a, b) => {
    const ai = a.kind ? order.indexOf(a.kind) : 99;
    const bi = b.kind ? order.indexOf(b.kind) : 99;
    return ai - bi || a.name.localeCompare(b.name);
  });
  return out;
}

/** One entry by path, so an upload can verify what it is about to replace. */
export async function findControlFile(
  folderPath: string,
  filePath: string,
  explicitFiles?: Record<string, string>,
): Promise<ControlFileEntry | null> {
  const files = await listControlFiles(folderPath, explicitFiles);
  return files.find((f) => f.path.toLowerCase() === filePath.toLowerCase()) ?? null;
}

/**
 * Which SQL source carries a given control file, for confirming the sync.
 *
 * Ranging has no stored procedure yet, so an edit to it cannot be confirmed
 * against SQL — the UI has to say so rather than spin forever waiting for a
 * change it has no way to see.
 */
export function sqlSourceForKind(kind: ControlFileKind | null): string | null {
  if (kind === "pmf") return "products";
  if (kind === "links") return "links";
  if (kind === "custom_sites") return "stores";
  return null; // ranging, and anything unrecognised
}

export function describeEntry(e: DropboxEntry): string {
  return `${e.name} (${e.size} bytes, rev ${e.rev})`;
}
