import { readJson, writeJson } from "./blob";

/**
 * Durable per-client report-run counters.
 *
 * The activity log is free-text and capped at 500 entries, so it can't be
 * relied on for lifetime counts. This store keeps an incrementing tally per
 * client per report type, surfaced on the dashboard client grid.
 */

const KEY = "report-counts.json";

export type ReportKind = "vitalSigns" | "monthEnd";

export interface ReportCounts {
  vitalSigns: number;
  monthEnd: number;
}

type CountsStore = Record<string, ReportCounts>; // keyed by clientId

function emptyCounts(): ReportCounts {
  return { vitalSigns: 0, monthEnd: 0 };
}

export async function getReportCounts(): Promise<CountsStore> {
  return readJson<CountsStore>(KEY, {});
}

export async function getClientReportCounts(
  clientId: string
): Promise<ReportCounts> {
  const store = await getReportCounts();
  return store[clientId] ?? emptyCounts();
}

/** Forget a client's counters entirely (client purge). */
export async function deleteClientReportCounts(clientId: string): Promise<void> {
  const store = await getReportCounts();
  if (store[clientId] === undefined) return;
  delete store[clientId];
  await writeJson(KEY, store);
}

/** Increment a client's report counter. Never throws — logging must not break a download. */
export async function incrementReportCount(
  clientId: string,
  kind: ReportKind
): Promise<void> {
  try {
    const store = await getReportCounts();
    const cur = store[clientId] ?? emptyCounts();
    cur[kind] = (cur[kind] ?? 0) + 1;
    store[clientId] = cur;
    await writeJson(KEY, store);
  } catch {
    /* never throw on counter failure */
  }
}
