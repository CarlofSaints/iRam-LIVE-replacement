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

/**
 * @param clientNames clients with a DISPO loaded for this period
 */
export async function checkDispoFiling(
  clientNames: string[],
  period: { year: number; month: number; week: number },
  overrides: Record<string, string> = {},
): Promise<FilingCheckResult> {
  const empty = { checked: 0, filed: 0, problems: [], unmatched: [] };
  if (!isSharePointConfigured()) {
    return { ran: false, error: "SharePoint credentials are not configured for this project.", ...empty };
  }
  const rootUrl = dispoRootUrl();
  if (!rootUrl) {
    return { ran: false, error: "No SharePoint root — set IRAM_SP_HOST or IRAM_DISPO_ROOT_URL.", ...empty };
  }

  let driveId: string, itemId: string, clientDirs: string[];
  try {
    ({ driveId, itemId } = await resolveFolderRef(rootUrl));
    clientDirs = (await listChildren(driveId, itemId)).filter((c) => c.isFolder).map((c) => c.name);
  } catch (e) {
    return { ran: false, error: `Could not open ${rootUrl} — ${e instanceof Error ? e.message : String(e)}`, rootUrl, ...empty };
  }

  // One listing per path, cached: sibling clients never share a path, but a
  // client checked twice (two channels, same period) would otherwise re-fetch.
  // Cache the PROMISE, not the result — clients are walked concurrently, so two
  // workers reaching the same path must share one request rather than both miss.
  const cache = new Map<string, Promise<Entry[] | null>>();
  const list = (relPath: string[]): Promise<Entry[] | null> => {
    const key = relPath.join("/");
    const hit = cache.get(key);
    if (hit) return hit;
    const p = listChildrenAtPath(driveId, itemId, relPath).then((kids) =>
      kids == null ? null : kids.map((k) => ({ name: k.name, isFolder: k.isFolder })),
    );
    cache.set(key, p);
    return p;
  };

  // Each client is 3-5 sequential Graph calls; run a few clients at once so the
  // whole check stays a few seconds rather than half a minute. Kept modest to
  // stay well clear of Graph throttling.
  const names = [...new Set(clientNames)].sort();
  const CONCURRENCY = 6;
  const results: FilingResult[] = new Array(names.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, names.length) }, async () => {
      for (let i = next++; i < names.length; i = next++) {
        const name = names[i];
        try {
          results[i] = await checkClientFiling(name, period, clientDirs, list, overrides);
        } catch (e) {
          // One client failing must not silently drop it from the report.
          results[i] = {
            clientName: name, verdict: "no client folder",
            expectedPath: `(could not be read — ${e instanceof Error ? e.message : String(e)})`,
          };
        }
      }
    }),
  );

  const problems: FilingResult[] = [];
  const unmatched: FilingResult[] = [];
  let filed = 0;
  for (const r of results) {
    if (r.verdict === "filed") filed++;
    else if (r.verdict === "no client folder") unmatched.push(r);
    else problems.push(r);
  }

  return {
    ran: true, rootUrl,
    checked: new Set(clientNames).size,
    filed, problems, unmatched,
  };
}
