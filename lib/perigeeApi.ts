/* ──────────────────────────────────────────────────────────────
   Perigee /api/visits — the per-CUSTOMER check-in feed.

   The main store-report trigger reads iRam's own Perigee database through the
   SQL proxy (massmart_visits_today). A customer's reps can sit outside what
   that procedure returns, so a client can also be given a Perigee API token
   for an app user allocated to ONLY that customer: that token returns only
   that customer's visits (see lib/perigeeFeeds.ts).

   The page-walking fetch is adapted from Bravo-Team-Tracker lib/perigeeFetch.ts,
   where it is proven against the live API: Perigee wraps rows as
   { visits: { data: [...], ...Laravel paginator } }, and an importer that
   reads only page 1 silently loses the rest.
   ────────────────────────────────────────────────────────────── */

import type { NormalisedVisit } from "./storeReportSync";

export const PERIGEE_VISITS_URL =
  (process.env.PERIGEE_VISITS_URL || "").trim() || "https://live.perigeeportal.co.za/api/visits";

export class PerigeeFetchError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Perigee API returned ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export interface PerigeeFetchResult {
  rows: Record<string, unknown>[];
  pagesFetched: number;
  stoppedReason: string;
  // False when it stopped early (a later page failed, the page cap, or the
  // time budget ran out): some of today's visits were NOT read.
  complete: boolean;
}

const COMPLETE_REASONS = new Set([
  "reached last page", "collected reported total", "no pagination metadata", "no rows returned", "empty page",
]);

function extractData(resp: unknown): Record<string, unknown>[] {
  if (Array.isArray(resp)) return resp as Record<string, unknown>[];
  const r = resp as Record<string, unknown> | null;
  const visits = r?.visits as Record<string, unknown> | undefined;
  if (visits && Array.isArray(visits.data)) return visits.data as Record<string, unknown>[];
  if (Array.isArray(r?.visits)) return r!.visits as Record<string, unknown>[];
  if (Array.isArray(r?.data)) return r!.data as Record<string, unknown>[];
  return [];
}

function extractMeta(resp: unknown): Record<string, unknown> {
  const r = resp as Record<string, unknown> | null;
  if (r && typeof r.visits === "object" && r.visits !== null && !Array.isArray(r.visits)) {
    const { data: _data, ...meta } = r.visits as Record<string, unknown>;
    return meta;
  }
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const { data: _data, visits: _visits, ...meta } = r;
    return meta;
  }
  return {};
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstRowKey(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  return String(row.visitGuid ?? row.guid ?? row.visitId ?? row.id ?? JSON.stringify(row).slice(0, 120));
}

/** Every page of visits between two SAST days (YYYY-MM-DD), for one token. */
export async function fetchPerigeeVisits(
  token: string,
  startDate: string,
  endDate: string,
  // deadline = epoch ms by which the WHOLE fetch must be done, all pages
  // together. The poller shares one budget across every client's feed so a
  // slow customer can't push the run past its time limit.
  opts?: { maxPages?: number; endpoint?: string; timeoutMs?: number; deadline?: number },
): Promise<PerigeeFetchResult> {
  const endpoint = opts?.endpoint || PERIGEE_VISITS_URL;
  const maxPages = opts?.maxPages ?? 20;
  const perPageMs = opts?.timeoutMs ?? 20_000;
  const all: Record<string, unknown>[] = [];
  let reportedTotal: number | null = null;
  let reportedLastPage: number | null = null;
  let stoppedReason = "complete";
  let prevFirstKey = "";
  let page = 1;

  for (; page <= maxPages; page++) {
    const url = page === 1 ? endpoint : `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`;
    const left = opts?.deadline ? opts.deadline - Date.now() : perPageMs;
    if (left <= 0) {
      if (page === 1) throw new Error("timed out before Perigee answered");
      stoppedReason = "ran out of time";
      break;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ startDate, endDate, page }),
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(perPageMs, left)),
      });
    } catch (e) {
      if (page === 1) throw e;
      stoppedReason = `page ${page} did not answer`;
      break;
    }

    if (!res.ok) {
      if (page === 1) {
        const detail = await res.text().catch(() => "");
        throw new PerigeeFetchError(res.status, detail.slice(0, 300));
      }
      stoppedReason = `page ${page} returned ${res.status}`;
      break;
    }

    const json = await res.json();
    const data = extractData(json);
    const meta = extractMeta(json);

    reportedTotal = num(meta.total ?? meta.totalRows ?? meta.totalRecords ?? meta.count) ?? reportedTotal;
    reportedLastPage = num(meta.last_page ?? meta.lastPage ?? meta.totalPages ?? meta.pages) ?? reportedLastPage;
    const currentPage = num(meta.current_page ?? meta.currentPage ?? meta.page);
    const perPage = num(meta.per_page ?? meta.perPage ?? meta.pageSize);

    if (data.length === 0) { stoppedReason = page === 1 ? "no rows returned" : "empty page"; break; }

    const fKey = firstRowKey(data[0]);
    if (page > 1 && fKey === prevFirstKey) { stoppedReason = "server returned same page (ignores page param)"; break; }
    prevFirstKey = fKey;
    if (page > 1 && currentPage !== null && currentPage < page) {
      stoppedReason = `server returned page ${currentPage} for requested ${page}`;
      break;
    }

    all.push(...data);

    if (reportedLastPage !== null) {
      if (page >= reportedLastPage) { stoppedReason = "reached last page"; break; }
    } else if (reportedTotal !== null) {
      if (all.length >= reportedTotal) { stoppedReason = "collected reported total"; break; }
    } else if (perPage === null || data.length < perPage) {
      stoppedReason = "no pagination metadata";
      break;
    }
  }
  if (page > maxPages) stoppedReason = `hit max page cap (${maxPages})`;

  return { rows: all, pagesFetched: Math.min(page, maxPages), stoppedReason, complete: COMPLETE_REASONS.has(stoppedReason) };
}

/** A feed failure in words an admin can act on. Deliberately NOT Perigee's
 *  response body: that is stored and shown to every store-report manager, and
 *  an upstream error page can echo request details. */
export function describeFeedError(e: unknown): string {
  if (e instanceof PerigeeFetchError) {
    if (e.status === 401 || e.status === 403) return `Perigee refused the token (${e.status})`;
    if (e.status === 429) return "Perigee rate-limited the request (429)";
    return `Perigee answered ${e.status}`;
  }
  if (e instanceof Error && /timed out|timeout|abort/i.test(`${e.name} ${e.message}`)) return "Perigee did not answer in time";
  return "Could not reach Perigee";
}

function pick(row: Record<string, unknown>, candidates: string[]): string {
  const norm = (k: string) => k.toLowerCase().replace(/[\s_]+/g, "");
  const want = candidates.map(norm);
  // Candidate ORDER wins (unlike storeReportSync's pick): on this API both
  // `email` and `username` can be present, and email must be preferred.
  const byKey = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    const s = v == null ? "" : String(v).trim();
    if (s) byKey.set(norm(k), s);
  }
  for (const c of want) {
    const v = byKey.get(c);
    if (v) return v;
  }
  return "";
}

/** An /api/visits row in the shape the store-report runner reads. Field names
 *  follow Bravo's mapping of the same API. The store may only be given as
 *  "STORE NAME - CODE", in which case the code is the part after the last " - ". */
export function normalisePerigeeApiVisit(row: Record<string, unknown>): NormalisedVisit {
  // Never Perigee's internal placeId: it is not a retailer site code, and a
  // wrong code would email the rep a DIFFERENT store's report. No code means
  // the visit is skipped ("no site code"), which the Test button makes visible.
  let siteCode = pick(row, ["storeCode", "siteCode"]);
  if (!siteCode) {
    const rawStore = pick(row, ["store", "Store Full Name", "storeName", "place"]);
    if (rawStore.includes(" - ")) siteCode = rawStore.substring(rawStore.lastIndexOf(" - ") + 3).trim();
  }
  const email = pick(row, ["email", "username", "representativeEmail", "userEmail", "representativeId"]);
  return {
    siteCode,
    repEmail: email.includes("@") ? email : "",
    repName: pick(row, ["repName", "displayName", "representativeName", "name"]),
    visitGuid: pick(row, ["visitGuid", "guid", "visitId", "id"]),
    channel: pick(row, ["channelName", "channel", "retailer", "storeChannel"]),
    checkInAt: pick(row, ["startDateFull", "visitStart", "checkInDate", "date"]),
  };
}
