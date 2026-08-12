/* ──────────────────────────────────────────────────────────────
   DISPO filing protocol — is a loaded DISPO also filed in SharePoint?

   Every DISPO loaded into iRam LIVE is supposed to be saved under

     CLIENTS/<CLIENT>/DISPO's & DATA SOURCES/<YYYY>/<YYYY-MM>/W<n>

   This module is the pure half: matching an app client name to its folder,
   recognising the DISPO and week folders, and turning a folder listing into a
   verdict. It does no I/O, so the weekly check (Microsoft Graph) and the local
   script (the OneDrive-synced copy) share ONE implementation of the rules.

   Both string rules were derived by enumerating the real tree, not guessed —
   see the counts on each.
   ────────────────────────────────────────────────────────────── */

/** One entry in a folder listing. Files matter: a week folder holding only a
 *  file is correctly filed, and one holding nothing is not. */
export interface Entry { name: string; isFolder: boolean }

/** A folder listing, however it was obtained. Null means the path is absent. */
export type ListChildren = (relPath: string[]) => Promise<Entry[] | null>;

const folderNames = (entries: Entry[] | null): string[] =>
  (entries ?? []).filter((e) => e.isFolder).map((e) => e.name);

// Week folder names present in the tree today:
//   W1..W5 (2199) · "Week 1".."Week 5" (348) · W-1..W-4 (74) · WK1/WK4 (4) · Week-01 (1)
export const WEEK_DIR = /^W(?:K|EEK)?[\s._-]*0?([1-9])$/i;

// The DISPO directory is spelled at least eight ways across the client folders
// — "DISPO's & DATA SOURCES", "DISPO'S & DATA SOURCES", "DISPOS & DATA
// SOURCES", "DISPO'S and DATA SOURCE", "DISPO AND DATA", "Dispo & Data
// Sources", "DISPOs", "Dispo" — so key on the one thing they all share.
export const isDispoDir = (name: string) => /^dispo/i.test(name);

/** Does a folder name denote this week number? */
export function weekFolderNumber(name: string): number | null {
  const m = name.match(WEEK_DIR);
  return m ? parseInt(m[1], 10) : null;
}

// Words that carry no identity, so the two sides can drop them independently:
// the app says "ROVIC AND LEERS (PTY) LTD", the folder says "ROVIC LEERS".
const LEGAL =
  /\b(PTY|PROPRIETARY|LTD|LIMITED|CC|INC|SA|AFRICA|GROUP|HOLDINGS|DISTRIBUTORS|INDUSTRIES|TECHNOLOGIES|MARKETING|SALES|RETAIL|URBAN|ORGANICS|PLUS)\b/g;

export const normaliseName = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(LEGAL, " ").replace(/\s+/g, " ").trim();

/**
 * Do two name words refer to the same thing? Allows one trailing character of
 * drift, which covers the real spelling differences ("HELLERMANN" in the app vs
 * "HELLERMAN" on the folder) without letting a word match a longer one it
 * merely prefixes — "TOP" must NOT match "TOPLINE", or SAFE TOP would be filed
 * into Topline's folder.
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(a.length, b.length) - 1 && i >= 3;
}

/** Similarity 0..1 between two names, as the F1 of their matching words. */
export function affinity(a: string, b: string): number {
  const x = a.split(" ").filter(Boolean), y = b.split(" ").filter(Boolean);
  if (x.length === 0 || y.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const wa of x) {
    const j = y.findIndex((wb, k) => !used.has(k) && wordsMatch(wa, wb));
    if (j >= 0) { used.add(j); matched++; }
  }
  if (matched === 0) return 0;
  const precision = matched / y.length, recall = matched / x.length;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Match an app client name ("HELLERMANN TYTON (PTY) LTD") to its folder
 * ("HELLERMAN TYTON"). Returns no folder rather than a wrong one — an
 * unmatched client is reported, never silently skipped, because filing a
 * client into the wrong folder is worse than admitting we don't know.
 */
export function resolveClientFolder(
  clientName: string,
  clientDirs: string[],
  overrides: Record<string, string> = {},
): { folder?: string; score: number; near: string } {
  if (overrides[clientName]) return { folder: overrides[clientName], score: 1, near: "(override)" };
  const target = normaliseName(clientName);
  let best = "", bestScore = 0, second = "", secondScore = 0;
  // De-duplicate first: a repeated folder name would tie with itself and trip
  // the "no clear winner" guard below, turning a perfect match into "unknown".
  for (const d of [...new Set(clientDirs)]) {
    const s = affinity(target, normaliseName(d));
    if (s > bestScore) { second = best; secondScore = bestScore; bestScore = s; best = d; }
    else if (s > secondScore) { second = d; secondScore = s; }
  }
  // 0.65 admits the real one-sided names ("QUALICHEM GENKEM" → "GENKEM",
  // "LUMOSS MOULDINGS" → "Lumoss"); a clear winner is required so a genuine
  // toss-up is reported for a human rather than guessed at.
  const decisive = bestScore >= 0.65 && (bestScore === 1 || bestScore - secondScore >= 0.1);
  return decisive
    ? { folder: best, score: bestScore, near: second }
    : { folder: undefined, score: bestScore, near: best };
}

export type FilingVerdict =
  | "filed"
  | "empty week folder"
  | "no week folder"
  | "no month folder"
  | "no year folder"
  | "no DISPO folder"
  | "no client folder";

export interface FilingResult {
  clientName: string;
  folder?: string;
  verdict: FilingVerdict;
  /** Where it should have been, for the report. */
  expectedPath: string;
  /** Folder names present at the deepest level reached — helps spot a typo'd week folder. */
  found?: string[];
}

export const monthFolderName = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

/**
 * Check one client's filing for one period. `list` is called with a path
 * relative to the CLIENTS root and returns the child folder names, or null if
 * that path does not exist.
 */
export async function checkClientFiling(
  clientName: string,
  period: { year: number; month: number; week: number },
  clientDirs: string[],
  list: ListChildren,
  overrides: Record<string, string> = {},
): Promise<FilingResult> {
  const { folder, near } = resolveClientFolder(clientName, clientDirs, overrides);
  if (!folder) {
    return {
      clientName, verdict: "no client folder",
      expectedPath: `CLIENTS/${clientName}`,
      found: near ? [near] : [],
    };
  }

  const monthName = monthFolderName(period.year, period.month);
  const base = `CLIENTS/${folder}`;

  const clientKids = await list([folder]);
  const dispoDir = folderNames(clientKids).find(isDispoDir);
  if (!dispoDir) {
    return { clientName, folder, verdict: "no DISPO folder", expectedPath: `${base}/DISPO's & DATA SOURCES`, found: folderNames(clientKids) };
  }

  const yearKids = await list([folder, dispoDir, String(period.year)]);
  if (yearKids == null) {
    return { clientName, folder, verdict: "no year folder", expectedPath: `${base}/${dispoDir}/${period.year}` };
  }

  const monthKids = await list([folder, dispoDir, String(period.year), monthName]);
  if (monthKids == null) {
    return {
      clientName, folder, verdict: "no month folder",
      expectedPath: `${base}/${dispoDir}/${period.year}/${monthName}`,
      found: folderNames(yearKids),
    };
  }

  const weekDir = folderNames(monthKids).find((d) => weekFolderNumber(d) === period.week);
  if (!weekDir) {
    return {
      clientName, folder, verdict: "no week folder",
      expectedPath: `${base}/${dispoDir}/${period.year}/${monthName}/W${period.week}`,
      found: folderNames(monthKids),
    };
  }

  // A week folder with nothing in it is the same failure as no folder: the
  // DISPO was loaded into the app but never saved where the team can find it.
  const weekKids = await list([folder, dispoDir, String(period.year), monthName, weekDir]);
  const path = `${base}/${dispoDir}/${period.year}/${monthName}/${weekDir}`;
  return (weekKids ?? []).length === 0
    ? { clientName, folder, verdict: "empty week folder", expectedPath: path }
    : { clientName, folder, verdict: "filed", expectedPath: path };
}
