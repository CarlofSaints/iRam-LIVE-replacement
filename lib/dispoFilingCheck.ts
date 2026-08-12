/* ──────────────────────────────────────────────────────────────
   Weekly DISPO filing check, over SharePoint via Microsoft Graph.

   Answers one question for the period the load-status email reports on:
   every client whose DISPO was LOADED — is it also FILED in SharePoint?

   Deliberately checks SharePoint itself rather than a synced copy: the
   library holds client folders that aren't in any one person's local sync,
   so a desktop check would report false misses.

   Fails LOUDLY. If SharePoint can't be reached the email says the check
   didn't run — it must never report "nobody filed" because Graph was down.
   ────────────────────────────────────────────────────────────── */

import {
  isSharePointConfigured, resolveFolderRef, listChildren, listChildrenAtPath,
} from "./sharepoint";
import { checkClientFiling, type FilingResult, type Entry } from "./dispoFiling";

/** The CLIENTS folder in the "Clients" document library. */
export function dispoRootUrl(): string | null {
  const explicit = process.env.IRAM_DISPO_ROOT_URL;
  if (explicit) return explicit.trim();
  const host = process.env.IRAM_SP_HOST;
  return host ? `https://${host}/Clients/CLIENTS` : null;
}

export interface FilingCheckResult {
  ran: boolean;
  /** Why it didn't run, or what broke — shown in the email instead of results. */
  error?: string;
  rootUrl?: string;
  checked: number;
  filed: number;
  /** Everything that is loaded but not properly filed. */
  problems: FilingResult[];
  /** Clients whose SharePoint folder could not be identified. */
  unmatched: FilingResult[];
}

export interface FilingJob {
  key: string;
  period: { year: number; month: number; week: number };
  /** Clients with a DISPO loaded for that period. */
  clientNames: string[];
  /** client name → how many DISPO files to expect (one per DISPO loaded). */
  expectedFiles?: Record<string, number>;
}

export interface FilingBatchResult {
  ran: boolean;
  error?: string;
  rootUrl?: string;
  /** job key → every client's verdict for that period. */
  byPeriod: Record<string, FilingResult[]>;
}

/**
 * Check several periods in one pass. All of them share one folder-listing
 * cache, which is what makes a multi-period grid affordable: the client and
 * year listings are fetched once no matter how many weeks are checked.
 */
export async function runFilingChecks(
  jobs: FilingJob[],
  overrides: Record<string, string> = {},
): Promise<FilingBatchResult> {
  if (!isSharePointConfigured()) {
    return { ran: false, error: "SharePoint credentials are not configured for this project.", byPeriod: {} };
  }
  const rootUrl = dispoRootUrl();
  if (!rootUrl) {
    return { ran: false, error: "No SharePoint root — set IRAM_SP_HOST or IRAM_DISPO_ROOT_URL.", byPeriod: {} };
  }

  let driveId: string, itemId: string, clientDirs: string[];
  try {
    ({ driveId, itemId } = await resolveFolderRef(rootUrl));
    clientDirs = (await listChildren(driveId, itemId)).filter((c) => c.isFolder).map((c) => c.name);
  } catch (e) {
    return { ran: false, error: `Could not open ${rootUrl} — ${e instanceof Error ? e.message : String(e)}`, rootUrl, byPeriod: {} };
  }

  const list = makeCachedList(driveId, itemId);

  // Flatten to (period, client) units so the whole grid fills concurrently
  // rather than one period at a time.
  const units = jobs.flatMap((j) =>
    [...new Set(j.clientNames)].sort().map((name) => ({ job: j, name })),
  );
  const done: FilingResult[] = new Array(units.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, units.length) }, async () => {
      for (let i = next++; i < units.length; i = next++) {
        const { job, name } = units[i];
        try {
          done[i] = await checkClientFiling(name, job.period, clientDirs, list, overrides, job.expectedFiles?.[name]);
        } catch (e) {
          done[i] = {
            clientName: name, verdict: "no client folder",
            expectedPath: `(could not be read — ${e instanceof Error ? e.message : String(e)})`,
          };
        }
      }
    }),
  );

  const byPeriod: Record<string, FilingResult[]> = {};
  for (const j of jobs) byPeriod[j.key] = [];
  units.forEach((u, i) => byPeriod[u.job.key].push(done[i]));
  return { ran: true, rootUrl, byPeriod };
}

function makeCachedList(driveId: string, itemId: string) {
  // Cache the PROMISE, not the result — clients are walked concurrently, so two
  // workers reaching the same path must share one request rather than both miss.
  const cache = new Map<string, Promise<Entry[] | null>>();
  return (relPath: string[]): Promise<Entry[] | null> => {
    const key = relPath.join("/");
    const hit = cache.get(key);
    if (hit) return hit;
    const p = listChildrenAtPath(driveId, itemId, relPath).then((kids) =>
      kids == null ? null : kids.map((k) => ({ name: k.name, isFolder: k.isFolder })),
    );
    cache.set(key, p);
    return p;
  };
}

/**
 * @param clientNames clients with a DISPO loaded for this period
 */
export async function checkDispoFiling(
  clientNames: string[],
  period: { year: number; month: number; week: number },
  overrides: Record<string, string> = {},
  expectedFiles: Record<string, number> = {},
): Promise<FilingCheckResult> {
  const batch = await runFilingChecks([{ key: 'p', period, clientNames, expectedFiles }], overrides);
  const empty = { checked: 0, filed: 0, problems: [], unmatched: [] };
  if (!batch.ran) return { ran: false, error: batch.error, rootUrl: batch.rootUrl, ...empty };

  const problems: FilingResult[] = [];
  const unmatched: FilingResult[] = [];
  let filed = 0;
  for (const r of batch.byPeriod.p ?? []) {
    if (r.verdict === 'filed') filed++;
    else if (r.verdict === 'no client folder') unmatched.push(r);
    else problems.push(r);
  }
  return {
    ran: true, rootUrl: batch.rootUrl,
    checked: new Set(clientNames).size,
    filed, problems, unmatched,
  };
}
