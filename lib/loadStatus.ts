/* ──────────────────────────────────────────────────────────────
   Weekly DISPO load status — "who hasn't loaded yet this week"

   Deliberately measured on the UPLOAD TIMESTAMP, not on the hand-picked
   reportYear/Month/Week stamp the uploader chooses. The window is
   Monday 00:00 SAST → now, so the answer is always "so far this week",
   and a load that was stamped with the wrong week still counts.
   (The DISPO Load Checklist in lib/dispoChecklist.ts is the other view:
   it grids by stamped period, which is what store-report arming needs.)

   Rollup is at VENDOR level: a vendor is only "loaded" once every channel
   it normally loads on has come in this week. A vendor with one channel in
   and another missing is still outstanding, and the missing channel(s) are
   named so the list is actionable.

   Shared by the 16:00 weekday cron and the manual preview / send-now buttons.
   ────────────────────────────────────────────────────────────── */

import type { UploadMeta, Client } from "./types";
import { getUploadIndex } from "./uploadData";
import { getClients } from "./clientData";
import { getUsers } from "./userData";
import { getStoreReportState, periodKey, type StoreReportState } from "./storeReportState";
import { sendLoadStatusEmail } from "./email";

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
  clientCount: number;      // active clients
  vendorCount: number;      // vendor numbers in scope (declared ∪ ever-loaded), active clients only
  loadedVendors: number;    // every expected channel in this week
  outstandingVendors: number;
  excludedVendors: number;  // every expected channel marked Skip on the checklist
  excludedPeriodLabel?: string;
  loadsThisWeek: number;    // DISPO uploads inside the window
  outstanding: OutstandingVendor[];
  recipients: string[];
  emailed: number;          // how many recipients were actually mailed
  failures: { email: string; error: string }[];
}

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

  // Timestamp basis, so an un-stamped (or mis-stamped) load still counts.
  const dispos = uploads.filter((u) => u.fileType === "dispo" && u.status === "processed");

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

  // 3. What actually landed inside the window, per vendor → channelIds.
  const loadedInWindow = new Map<string, Set<string>>();
  let loadsThisWeek = 0;
  const periodTally = new Map<string, number>();
  for (const u of dispos) {
    const t = Date.parse(u.uploadDate);
    if (isNaN(t) || t < startMs || t > nowMs) continue;
    if (!activeById.has(u.clientId)) continue;
    loadsThisWeek++;
    if (u.reportYear != null && u.reportMonth != null && u.reportWeek != null) {
      const pk = periodKey(u.reportYear, u.reportMonth, u.reportWeek);
      periodTally.set(pk, (periodTally.get(pk) ?? 0) + 1);
    }
    const v = (u.vendorNumber || "").trim();
    if (!v) continue;
    const k = vendorKey(u.clientId, v);
    const set = loadedInWindow.get(k) ?? new Set<string>();
    if (u.channelId) set.add(u.channelId);
    loadedInWindow.set(k, set);
  }

  // Honour the checklist's "Skip this vendor this week" marks. Those are keyed by
  // the STAMPED period, which this timestamp window doesn't have — so use the
  // period this week's loads are being stamped with (the most-loaded stamp).
  // No loads yet ⇒ no stamp to infer ⇒ no exclusions applied.
  let excludePeriod: string | null = null;
  let excludedPeriodLabel: string | undefined;
  for (const [pk, n] of periodTally) {
    if (!excludePeriod || n > (periodTally.get(excludePeriod) ?? 0) || (n === periodTally.get(excludePeriod) && pk > excludePeriod)) {
      excludePeriod = pk;
    }
  }
  const excludedStreams = new Set(
    excludePeriod ? state.periods[excludePeriod]?.excludedStreams ?? [] : [],
  );
  if (excludePeriod && excludedStreams.size > 0) {
    const p = state.periods[excludePeriod];
    excludedPeriodLabel = `Wk${p.week} ${MON[p.month] ?? p.month} ${p.year}`;
  }

  // 4. Roll up to vendor level.
  let loadedVendors = 0;
  let excludedVendors = 0;
  const outstanding: OutstandingVendor[] = [];

  for (const e of expected.values()) {
    const done = loadedInWindow.get(vendorKey(e.clientId, e.vendor)) ?? new Set<string>();

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
    clientCount: activeClients.length,
    vendorCount: expected.size,
    loadedVendors,
    outstandingVendors: outstanding.length,
    excludedVendors,
    excludedPeriodLabel,
    loadsThisWeek,
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
}): Promise<LoadStatusResult> {
  const [uploads, clients, state] = await Promise.all([
    getUploadIndex(), getClients(), getStoreReportState(),
  ]);
  const status = computeLoadStatus(uploads, clients, state, opts.now ?? new Date());

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
