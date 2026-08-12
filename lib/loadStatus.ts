/* ──────────────────────────────────────────────────────────────
   Weekly DISPO load status — "who hasn't loaded yet this week"

   Measured on the PERIOD STAMPED ON THE FILE, not on the upload timestamp.
   The current period is simply the newest (year, month, week) anyone has
   stamped — "the new week starts when the first DISPO for that week is
   loaded" — and a vendor counts as loaded once it has a DISPO stamped with
   that period, whenever it happened to be uploaded.

   It used to count anything uploaded since Monday 00:00 regardless of the
   stamp, which sidestepped mis-stamping but broke the moment the team ran a
   back-load: on 12 Aug 2026 the mail reported 50 of 51 vendors loaded while
   the checklist showed 27 streams with no current-week DISPO, because 52 of
   that week's 109 files were historical (Jun 2025, Dec 2025, Jan 2026).
   Crediting a December file as "this week's DISPO" defeats the purpose of
   the mail, so the stamp now decides. Back-loads are still counted and
   reported separately, as context rather than as compliance.

   This is the same basis as the DISPO Load Checklist (lib/dispoChecklist.ts),
   so the mail and the newest column of that grid now always agree — the mail
   is just rolled up from load streams to vendors.

   Rollup is at VENDOR level: a vendor is only "loaded" once every channel
   it normally loads on has come in for the current period. A vendor with one
   channel in and another missing is still outstanding, and the missing
   channel(s) are named so the list is actionable.

   Shared by the 16:00 weekday cron and the manual preview / send-now buttons.
   ────────────────────────────────────────────────────────────── */

import type { UploadMeta, Client } from "./types";
import { getUploadIndex } from "./uploadData";
import { getClients } from "./clientData";
import { getUsers } from "./userData";
import { getStoreReportState, periodKey, type StoreReportState } from "./storeReportState";
import { sendLoadStatusEmail } from "./email";
import { checkDispoFiling, type FilingCheckResult } from "./dispoFilingCheck";

// Africa/Johannesburg is UTC+2 all year (no DST), so a fixed offset is safe.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monday 00:00 SAST of the week containing `now`, returned as the real UTC instant.
// Weeks run Mon→Sun, so a Sunday still belongs to the Monday just gone.
export function weekStart(now: Date = new Date()): Date {
  const sast = new Date(now.getTime() + SAST_OFFSET_MS); // UTC getters now read SAST
  const daysSinceMonday = (sast.getUTCDay() + 6) % 7;    // Mon→0 … Sun→6
  const midnightSast = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate());
  return new Date(midnightSast - daysSinceMonday * 86400000 - SAST_OFFSET_MS);
}

function sastDateLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    timeZone: "Africa/Johannesburg", weekday: "short", day: "2-digit", month: "short",
  });
}

function sastTimeLabel(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export interface OutstandingVendor {
  clientId: string;
  clientName: string;
  vendorNumber: string;
  /** Channel names with no DISPO loaded in the window (empty when nothing is known yet). */
  missingChannels: string[];
  /** No DISPO has EVER been loaded for this vendor — no channel is known for it. */
  neverLoaded: boolean;
  /** Some of this vendor's channels came in this week, others didn't. */
  partial: boolean;
  /** ISO of the most recent DISPO for this vendor, any time (undefined when never loaded). */
  lastLoadedAt?: string;
}

export interface LoadStatusResult {
  weekStartIso: string;
  asAtIso: string;
  /** e.g. "Mon 27 Jul → Thu 30 Jul, 16:00" */
  windowLabel: string;
  /** e.g. "Thu 30 Jul 16:00" */
  asAtLabel: string;
  /** The period being reported on, e.g. "Wk1 Aug 2026". Null when nothing is stamped yet. */
  periodLabel: string | null;
  /** The same period as numbers, for the filing check. */
  currentPeriod: { year: number; month: number; week: number } | null;
  /** Clients with at least one DISPO loaded for the current period. */
  clientsLoadedThisPeriod: string[];
  /** client name → distinct vendor+channel DISPOs loaded, i.e. files to expect. */
  loadsPerClientThisPeriod: Record<string, number>;
  /** When the first DISPO for this period was loaded — the moment the week "opened". */
  periodOpenedLabel?: string;
  clientCount: number;      // active clients
  vendorCount: number;      // vendor numbers in scope (declared ∪ ever-loaded), active clients only
  loadedVendors: number;    // every expected channel in for the current period
  outstandingVendors: number;
  excludedVendors: number;  // every expected channel marked Skip on the checklist
  excludedPeriodLabel?: string;
  loadsThisWeek: number;    // DISPO uploads since Monday 00:00 (all periods)
  /** Of those, the ones stamped for the current period. */
  currentPeriodLoads: number;
  /** Of those, the ones stamped for an OLDER period — back-loads, which no longer count as loaded. */
  historicalLoads: number;
  outstanding: OutstandingVendor[];
  /** SharePoint filing check for this period — undefined when it wasn't run. */
  filing?: FilingCheckResult;
  recipients: string[];
  emailed: number;          // how many recipients were actually mailed
  failures: { email: string; error: string }[];
}

// Orders (year, month, week) chronologically — same scheme as the checklist.
const periodScore = (y: number, m: number, w: number) => y * 10000 + m * 100 + w;
const vendorKey = (clientId: string, vendor: string) => `${clientId}|${vendor}`;
const streamId = (clientId: string, channelId: string, vendor: string) => `${clientId}|${channelId}|${vendor}`;

/** Pure computation — no I/O, so it's unit-testable and safe to reuse. */
export function computeLoadStatus(
  uploads: UploadMeta[],
  clients: Client[],
  state: StoreReportState,
  now: Date = new Date(),
): Omit<LoadStatusResult, "recipients" | "emailed" | "failures"> {
  const start = weekStart(now);
  const startMs = start.getTime();
  const nowMs = now.getTime();

  const activeClients = clients.filter((c) => c.active);
  const activeById = new Map(activeClients.map((c) => [c.id, c]));

  const dispos = uploads.filter((u) => u.fileType === "dispo" && u.status === "processed");

  // The current period is the newest stamp anyone has used — the week opens as
  // soon as its first DISPO lands. Only fully-stamped loads on an active client
  // can define it, so a stray unstamped upload can't move the goalposts.
  const stamped = dispos.filter(
    (u) =>
      activeById.has(u.clientId) &&
      u.reportYear != null && u.reportMonth != null && u.reportWeek != null,
  );
  let current: { year: number; month: number; week: number } | null = null;
  for (const u of stamped) {
    const score = periodScore(u.reportYear!, u.reportMonth!, u.reportWeek!);
    if (!current || score > periodScore(current.year, current.month, current.week)) {
      current = { year: u.reportYear!, month: u.reportMonth!, week: u.reportWeek! };
    }
  }
  const currentKey = current ? periodKey(current.year, current.month, current.week) : null;
  const periodLabel = current ? `Wk${current.week} ${MON[current.month] ?? current.month} ${current.year}` : null;
  const isCurrent = (u: UploadMeta) =>
    currentKey != null &&
    u.reportYear != null && u.reportMonth != null && u.reportWeek != null &&
    periodKey(u.reportYear, u.reportMonth, u.reportWeek) === currentKey;

  // When the week "opened" — the earliest upload carrying the current stamp.
  let openedIso: string | undefined;
  for (const u of stamped) {
    if (isCurrent(u) && (!openedIso || u.uploadDate < openedIso)) openedIso = u.uploadDate;
  }

  // Expected load streams per vendor: every channel that vendor has EVER loaded on.
  // channels stays empty for a declared vendor with no history at all.
  interface Expected {
    clientId: string;
    clientName: string;
    vendor: string;
    channels: Map<string, string>; // channelId → channelName
    lastLoadedAt?: string;
  }
  const expected = new Map<string, Expected>();

  const ensure = (clientId: string, clientName: string, vendor: string): Expected => {
    const k = vendorKey(clientId, vendor);
    let e = expected.get(k);
    if (!e) {
      e = { clientId, clientName, vendor, channels: new Map() };
      expected.set(k, e);
    }
    return e;
  };

  // 1. Every vendor number declared on an active client.
  for (const c of activeClients) {
    for (const raw of c.vendorNumbers ?? []) {
      const v = String(raw).trim();
      if (v) ensure(c.id, c.name, v);
    }
  }

  // 2. Every vendor/channel combination with load history (catches vendors that
  //    load DISPOs but were never added to the client record).
  for (const u of dispos) {
    const client = activeById.get(u.clientId);
    if (!client) continue; // inactive/deleted client — out of scope
    const v = (u.vendorNumber || "").trim();
    if (!v) continue;
    const e = ensure(u.clientId, client.name, v);
    if (u.channelId) e.channels.set(u.channelId, u.channelName || u.channelId);
    if (!e.lastLoadedAt || u.uploadDate > e.lastLoadedAt) e.lastLoadedAt = u.uploadDate;
  }

  // 3. What has come in FOR THE CURRENT PERIOD, per vendor → channelIds.
  //    Upload time is irrelevant here: a file stamped for this week counts
  //    whenever it was loaded, and a file stamped for December does not count
  //    however recently it was loaded.
  const loadedForPeriod = new Map<string, Set<string>>();
  const clientsThisPeriod = new Set<string>();
  // Distinct vendor+channel DISPOs per client = how many files should be filed.
  const streamsPerClient = new Map<string, Set<string>>();
  for (const u of dispos) {
    if (!activeById.has(u.clientId) || !isCurrent(u)) continue;
    // Tracked before the vendor check: a load with no vendor number still
    // means that client filed (or should have filed) a DISPO this week.
    const cname = activeById.get(u.clientId)!.name;
    clientsThisPeriod.add(cname);
    const st = streamsPerClient.get(cname) ?? new Set<string>();
    st.add(`${(u.vendorNumber || '?').trim()}|${u.channelName}`);
    streamsPerClient.set(cname, st);
    const v = (u.vendorNumber || "").trim();
    if (!v) continue;
    const k = vendorKey(u.clientId, v);
    const set = loadedForPeriod.get(k) ?? new Set<string>();
    if (u.channelId) set.add(u.channelId);
    loadedForPeriod.set(k, set);
  }

  // Upload activity since Monday — reported as context only, split so a busy
  // week of back-loading can never read as "everyone is up to date".
  let loadsThisWeek = 0, currentPeriodLoads = 0, historicalLoads = 0;
  for (const u of dispos) {
    const t = Date.parse(u.uploadDate);
    if (isNaN(t) || t < startMs || t > nowMs) continue;
    if (!activeById.has(u.clientId)) continue;
    loadsThisWeek++;
    if (isCurrent(u)) currentPeriodLoads++;
    else historicalLoads++;
  }

  // Honour the checklist's "Skip this vendor this week" marks. Both views are
  // now keyed on the stamped period, so this is simply the current period —
  // no more inferring it from whatever stamp was most common this week.
  const excludedStreams = new Set(
    currentKey ? state.periods[currentKey]?.excludedStreams ?? [] : [],
  );
  const excludedPeriodLabel = excludedStreams.size > 0 ? periodLabel ?? undefined : undefined;

  // 4. Roll up to vendor level.
  let loadedVendors = 0;
  let excludedVendors = 0;
  const outstanding: OutstandingVendor[] = [];

  for (const e of expected.values()) {
    const done = loadedForPeriod.get(vendorKey(e.clientId, e.vendor)) ?? new Set<string>();

    if (e.channels.size === 0) {
      // Declared but never loaded on any channel — can't be satisfied this week.
      outstanding.push({
        clientId: e.clientId, clientName: e.clientName, vendorNumber: e.vendor,
        missingChannels: [], neverLoaded: true, partial: false,
      });
      continue;
    }

    const missing: string[] = [];
    let skipped = 0;
    for (const [channelId, channelName] of e.channels) {
      if (done.has(channelId)) continue;
      if (excludedStreams.has(streamId(e.clientId, channelId, e.vendor))) { skipped++; continue; }
      missing.push(channelName);
    }

    if (missing.length === 0) {
      // Everything expected is either in, or explicitly skipped for this week.
      if (done.size === 0 && skipped > 0) excludedVendors++;
      else loadedVendors++;
      continue;
    }
    outstanding.push({
      clientId: e.clientId, clientName: e.clientName, vendorNumber: e.vendor,
      missingChannels: missing.sort((a, b) => a.localeCompare(b)),
      neverLoaded: false,
      partial: done.size > 0,
      lastLoadedAt: e.lastLoadedAt,
    });
  }

  outstanding.sort(
    (a, b) => a.clientName.localeCompare(b.clientName) || a.vendorNumber.localeCompare(b.vendorNumber),
  );

  return {
    weekStartIso: start.toISOString(),
    asAtIso: now.toISOString(),
    windowLabel: `${sastDateLabel(start)} → ${sastDateLabel(now)}, ${sastTimeLabel(now)}`,
    asAtLabel: `${sastDateLabel(now)} ${sastTimeLabel(now)}`,
    periodLabel,
    currentPeriod: current,
    clientsLoadedThisPeriod: [...clientsThisPeriod].sort(),
    loadsPerClientThisPeriod: Object.fromEntries([...streamsPerClient].map(([k, v]) => [k, v.size])),
    periodOpenedLabel: openedIso ? `${sastDateLabel(new Date(openedIso))} ${sastTimeLabel(new Date(openedIso))}` : undefined,
    clientCount: activeClients.length,
    vendorCount: expected.size,
    loadedVendors,
    outstandingVendors: outstanding.length,
    excludedVendors,
    excludedPeriodLabel,
    loadsThisWeek,
    currentPeriodLoads,
    historicalLoads,
    outstanding,
  };
}

/**
 * Compute the status and (optionally) email it to every active user flagged
 * receiveLoadStatus. One personalised mail per recipient ("Hi Grant") — a
 * failure to one address never blocks the others.
 */
export async function runLoadStatus(opts: {
  send: boolean;
  now?: Date;
  /** Override recipients (manual test send). Bypasses the receiveLoadStatus flag. */
  to?: string[];
  /** Skip the SharePoint filing check (it costs ~2 Graph calls per client). */
  checkFiling?: boolean;
}): Promise<LoadStatusResult> {
  const [uploads, clients, state] = await Promise.all([
    getUploadIndex(), getClients(), getStoreReportState(),
  ]);
  const computed = computeLoadStatus(uploads, clients, state, opts.now ?? new Date());

  // Is what was loaded also filed in SharePoint? Never allowed to break the
  // email — a failure is reported inside it as "the check didn't run".
  let filing: FilingCheckResult | undefined;
  if (opts.checkFiling !== false && computed.currentPeriod) {
    try {
      filing = await checkDispoFiling(
        computed.clientsLoadedThisPeriod, computed.currentPeriod, {},
        computed.loadsPerClientThisPeriod,
      );
    } catch (e) {
      filing = {
        ran: false, error: e instanceof Error ? e.message : String(e),
        checked: 0, filed: 0, problems: [], unmatched: [],
      };
    }
  }
  const status = { ...computed, filing };

  let recipients: { email: string; name: string }[];
  if (opts.to?.length) {
    const users = await getUsers();
    recipients = opts.to.map((email) => ({
      email,
      name: users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name ?? "",
    }));
  } else {
    const users = await getUsers();
    recipients = users
      .filter((u) => u.active && u.receiveLoadStatus && u.email)
      .map((u) => ({ email: u.email, name: u.name }));
  }

  const failures: { email: string; error: string }[] = [];
  let emailed = 0;

  if (opts.send && recipients.length > 0) {
    const results = await Promise.allSettled(
      recipients.map((r) => sendLoadStatusEmail({ to: r.email, name: r.name, status })),
    );
    results.forEach((res, i) => {
      if (res.status === "fulfilled") emailed++;
      else {
        failures.push({
          email: recipients[i].email,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      }
    });
  }

  return { ...status, recipients: recipients.map((r) => r.email), emailed, failures };
}
