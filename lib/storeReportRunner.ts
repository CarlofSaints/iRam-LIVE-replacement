/* ──────────────────────────────────────────────────────────────
   Store-report poller — the trigger that fires reports on check-in.

   Shared by the Vercel Cron (every few minutes) and the "Run now" button.
   Each run:
     1. respects the enabled flag + interval throttle (unless forced)
     2. requires an ARMED week (else check-ins are ignored)
     3. pulls today's Massmart visits via the SQL proxy, then each client's own
        Perigee feed (lib/perigeeFeeds.ts); feed visits only reach that
        client's set-up reps
     4. filters to the configured channel allow-list
     5. per visit: dedups (visit GUID + store×rep), live-renders the store's
        consolidated report (minus excluded streams), emails the rep, logs the send
     6. records a run summary

   dryRun = do everything except actually send/log — for safe previewing.
   ────────────────────────────────────────────────────────────── */

import { getSyncSettings, recordLastRun, normaliseVisit, normChannel, type SyncLastRun } from "./storeReportSync";
import { getTodayMassmartVisits } from "./sqlProxy";
import { loadDedupSnapshot, addSend } from "./storeReportLog";
import { loadStoreReport, formatGeneratedAt, storeReportLogos, reportBaseUrl } from "./storeReportLoad";
import { signReportLink } from "./reportLink";
import { renderStoreReportEmail } from "./storeReportEmail";
import { sendStoreReportEmail } from "./email";
import { addTrackingSend, trackingDay } from "./storeReportTracking";
import { recordAuditOutcomes } from "./storeReportAudit";
import { getUsersStrict } from "./userData";
import { buildScopeIndex, scopeForEmail, scopeForFeedVisit, type ScopeIndex } from "./storeReportScope";
import { getPerigeeFeedsWithTokens, recordPerigeeFeedRuns, type PerigeeFeedRun } from "./perigeeFeeds";
import { fetchPerigeeVisits, normalisePerigeeApiVisit, describeFeedError } from "./perigeeApi";

// All client feeds together get this long per run. The cron function has 120s
// and the main feed still has to be rendered and emailed after it.
const FEED_BUDGET_MS = 40_000;
import { getClients } from "./clientData";
import type { NormalisedVisit } from "./storeReportSync";
import { v4 as uuid } from "uuid";
import { brand } from "./brand";

const normCh = normChannel;

export interface RunOptions {
  force?: boolean;     // ignore enabled flag + throttle (Run now)
  dryRun?: boolean;    // compute + report what would happen, but don't send/log
  origin: string;      // base URL for the report link + logos
}

export type RunVisitStatus =
  | "sent"
  | "skipped-duplicate"
  | "skipped-no-data"
  | "skipped-no-mapping"
  | "skipped-no-sitecode"
  | "skipped-no-email"
  | "skipped-channel"
  | "skipped-rep-no-clients"
  | "skipped-feed-not-client-rep"
  | "failed"
  | "would-send";

export interface RunVisitOutcome {
  siteCode: string;
  repEmail: string;
  store: string;
  status: RunVisitStatus;
  repName?: string;
  channel?: string;
  actions?: number;
  detail?: string;
  feed?: string;       // "<Client> feed" when the visit came from a per-client Perigee feed
}

// Human-readable reason per outcome status — used for the run summary breakdown
// so the scheduled job explains *why* visits were skipped, not just how many.
export const OUTCOME_LABELS: Record<RunVisitStatus, string> = {
  "sent": "Sent",
  "would-send": "Would send",
  "skipped-duplicate": "Already sent today",
  "skipped-no-data": "No actions to report",
  "skipped-no-mapping": "Site not in loaded data / unmapped",
  "skipped-no-sitecode": "Visit had no site code",
  "skipped-no-email": "Rep has no email",
  "skipped-channel": "Channel switched off (not in allow-list)",
  "skipped-rep-no-clients": "Rep limited to own clients, none usable",
  "skipped-feed-not-client-rep": "Client feed: not that client's rep",
  "failed": "Failed",
};

// Tally outcomes by their human label (skipped + failed only), for the summary.
export function summariseReasons(outcomes: RunVisitOutcome[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.status === "sent" || o.status === "would-send") continue;
    const label = OUTCOME_LABELS[o.status] ?? o.status;
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

export interface RunResult {
  ok: boolean;
  enabled: boolean;
  armedPeriod: string | null;
  visitsSeen: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  outcomes: RunVisitOutcome[];
  message?: string;
}

export async function runStoreReportSync(opts: RunOptions): Promise<RunResult> {
  const settings = await getSyncSettings();
  const outcomes: RunVisitOutcome[] = [];
  const base: Omit<RunResult, "ok" | "outcomes"> = {
    enabled: settings.enabled, armedPeriod: null, visitsSeen: 0,
    sent: 0, skipped: 0, failed: 0, dryRun: !!opts.dryRun,
  };

  // 1. Enabled + throttle (skipped when forced).
  if (!opts.force) {
    if (!settings.enabled) {
      return { ...base, ok: true, outcomes, message: "Sync disabled" };
    }
    const last = settings.lastRun?.at ? Date.parse(settings.lastRun.at) : 0;
    if (settings.minIntervalSeconds > 0 && last && Date.now() - last < settings.minIntervalSeconds * 1000) {
      return { ...base, ok: true, outcomes, message: "Throttled (ran recently)" };
    }
  }

  // 2. No arming — every allowed check-in sends the store's latest data, deduped
  //    once per store+rep per DAY (and per exact Perigee visit GUID). The day key
  //    is the SAST calendar day; a revisit on a later day gets a fresh report.
  const dedupKey = trackingDay();
  base.armedPeriod = dedupKey;

  // 3. Pull today's visits. A main-feed failure no longer ends the run: the
  //    client feeds below don't depend on the SQL proxy, and their reps should
  //    still get reports while it is down. The failure is named in the run.
  let visits: Record<string, unknown>[] = [];
  const runProblems: string[] = [];
  // Only iRam's deployment has the main feed (iRam's own Perigee DB). On the
  // others every report comes from a client feed, which only ever reaches a
  // user limited to that client: there is no all-client report to send.
  if (brand.features.iramVisitFeed) try {
    visits = await getTodayMassmartVisits();
  } catch (e) {
    runProblems.push(`Main feed failed: ${e instanceof Error ? e.message : "visit fetch failed"}`);
  }
  base.visitsSeen = visits.length;

  // Who is limited to their own clients. Read STRICTLY: a failed read must stop
  // the run, not come back empty and send a customer's rep every client's data.
  let scopes: ScopeIndex;
  try {
    scopes = buildScopeIndex(await getUsersStrict());
  } catch (e) {
    const msg = `Could not read users, nothing sent: ${e instanceof Error ? e.message : "read failed"}`;
    const run: SyncLastRun = { at: new Date().toISOString(), ok: false, visitsSeen: visits.length, sent: 0, skipped: 0, failed: 0, message: msg };
    if (!opts.dryRun) await recordLastRun(run);
    return { ...base, ok: false, outcomes, message: msg };
  }

  // 3b. Per-client Perigee feeds (a customer's own reps). The main feed goes
  //     FIRST, so an iRam rep who also appears on a customer's feed is handled
  //     by the main feed as before; the store×rep dedup then skips the repeat.
  //     A feed that fails is recorded on the feed and never stops the run.
  const queue: { v: NormalisedVisit; feedClientId?: string; feedLabel?: string }[] =
    visits.map((raw) => ({ v: normaliseVisit(raw) }));
  const feedRuns = new Map<string, PerigeeFeedRun>();
  let allFeeds: Awaited<ReturnType<typeof getPerigeeFeedsWithTokens>> = [];
  try {
    allFeeds = (await getPerigeeFeedsWithTokens()).filter((f) => f.enabled);
  } catch {
    runProblems.push("Could not read the client feeds list: no client feed polled this run");
  }
  if (allFeeds.length) {
    const names = new Map((await getClients()).map((c) => [c.id, c.name]));
    const labelOf = (id: string) => `${names.get(id) ?? id} feed`;
    for (const f of allFeeds.filter((f) => !f.token)) {
      const error = `Stored token unreadable (${f.decryptError ?? "no token"}): paste it again`;
      feedRuns.set(f.clientId, { at: new Date().toISOString(), ok: false, visits: 0, error });
      runProblems.push(`${labelOf(f.clientId)}: ${error}`);
    }
    const feeds = allFeeds.filter((f) => f.token);
    // ONE time budget for every feed together, fetched in parallel, so a slow
    // customer can't push the run past the function's limit and stop the
    // main feed's reports from going out.
    const deadline = Date.now() + FEED_BUDGET_MS;
    const results = await Promise.allSettled(feeds.map((f) => fetchPerigeeVisits(f.token, dedupKey, dedupKey, { deadline })));
    results.forEach((res, i) => {
      const f = feeds[i];
      const label = labelOf(f.clientId);
      if (res.status === "rejected") {
        const error = describeFeedError(res.reason);
        feedRuns.set(f.clientId, { at: new Date().toISOString(), ok: false, visits: 0, error });
        runProblems.push(`${label} failed: ${error}`);
        return;
      }
      // A partial read still processes what came back, but is NOT reported as
      // healthy: reps on the unread pages got nothing.
      const partial = res.value.complete ? undefined : `only part of today's visits read (${res.value.stoppedReason})`;
      feedRuns.set(f.clientId, { at: new Date().toISOString(), ok: !partial, visits: res.value.rows.length, error: partial });
      if (partial) runProblems.push(`${label}: ${partial}`);
      for (const raw of res.value.rows) {
        const v = normalisePerigeeApiVisit(raw);
        // Its own id space: never let a feed GUID collide with a main-feed one.
        if (v.visitGuid) v.visitGuid = `feed:${f.clientId}:${v.visitGuid}`;
        queue.push({ v, feedClientId: f.clientId, feedLabel: label });
      }
    });
  }
  base.visitsSeen = queue.length;

  const allow = new Set(settings.channels.map(normCh));
  let sent = 0, skipped = 0, failed = 0;
  // The day's send ledger, read once for the whole run (not twice per visit).
  const ledger = await loadDedupSnapshot(dedupKey);
  const logSend = async (rec: Parameters<typeof addSend>[0]) => { await addSend(rec); ledger.note(rec); };

  // 4. Per visit.
  for (const { v, feedClientId, feedLabel } of queue) {
    // Default identity fields on every outcome so the audit ledger always knows
    // WHO (rep) and WHERE (store/channel) a drop happened, not just why.
    const who = { repName: v.repName, channel: v.channel, feed: feedLabel };
    if (!v.siteCode) { skipped++; outcomes.push({ ...who, siteCode: "", repEmail: v.repEmail, store: "", status: "skipped-no-sitecode", detail: "no site code on visit" }); continue; }

    // Channel allow-list (separator-insensitive). Empty channel = let through.
    if (v.channel && allow.size && !allow.has(normCh(v.channel))) {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-channel", detail: v.channel }); continue;
    }

    // Dedup: same visit GUID already processed today, or this store×rep already sent today.
    if (v.visitGuid && ledger.hasProcessedVisit(v.visitGuid)) {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "visit already processed today" }); continue;
    }
    if (v.repEmail && ledger.hasSent(v.siteCode, v.repEmail)) {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "store+rep already sent today" }); continue;
    }
    if (!v.repEmail) {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: "", store: "", status: "skipped-no-email", detail: `rep "${v.repName}" has no email` }); continue;
    }

    // Limited to their own clients? Blocked sends NOTHING and is kept out of the
    // dedup ledger, so ticking their clients later in the day still lets it send.
    // A visit from a client's own feed goes ONLY to someone set up as that
    // client's rep, never "all" (see scopeForFeedVisit).
    const scope = feedClientId
      ? scopeForFeedVisit(scopes, v.repEmail, feedClientId)
      : scopeForEmail(scopes, v.repEmail);
    if (scope.kind === "blocked") {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-rep-no-clients", detail: scope.reason }); continue;
    }
    if (scope.kind === "not-client-rep") {
      skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-feed-not-client-rep", detail: scope.reason }); continue;
    }
    const clientIds = scope.kind === "clients" ? scope.clientIds : undefined;
    if (feedClientId && !clientIds) {
      // Unreachable by construction; if it ever happens, send nothing.
      failed++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "failed", detail: "feed visit had no client list" }); continue;
    }

    // Live-render the store's report: consolidated (every opted-in client), or
    // only this rep's clients.
    try {
      const loaded = await loadStoreReport({ siteCode: v.siteCode, clientIds, onlyOptedIn: true });
      const report = loaded.report;
      const store = report.storeName || v.siteCode;

      // A feed row may carry no channel, which would slip past the allow-list
      // above. Judge it by the store's own channel instead, so switching a
      // channel off still holds for a customer's reps.
      if (feedClientId && !v.channel && allow.size && report.subChannel && !allow.has(normCh(report.subChannel))) {
        skipped++; outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store, status: "skipped-channel", detail: report.subChannel }); continue;
      }

      if (report.totalActions === 0 || report.clients.length === 0) {
        skipped++;
        // No participating client had data for this site → the site code isn't in
        // any loaded DISPO (unmapped / not loaded). If clients matched but there's
        // nothing to action, it's genuinely a clean store this period. For a
        // limited rep, "no client" usually just means theirs isn't in this store.
        const noMapping = report.clients.length === 0;
        outcomes.push({
          ...who, siteCode: v.siteCode, repEmail: v.repEmail, store,
          status: noMapping && !clientIds ? "skipped-no-mapping" : "skipped-no-data",
          actions: 0,
          detail: noMapping
            ? (clientIds ? "none of this rep's clients have data at this store" : "site not in any loaded DISPO (check code mapping / data load)")
            : "no actions to report this period",
        });
        // A limited rep whose clients have no data here stays OUT of the dedup
        // ledger: if an admin ticked the wrong client, fixing it later today
        // must still let this visit send. Costs one re-render per poll.
        // Not for a per-client FEED visit: a customer's reps also visit stores
        // we hold no data for (other retailers), and re-rendering each of those
        // every 3 minutes all day is waste. The feed's client can't be mis-ticked.
        if (!opts.dryRun && !(noMapping && clientIds && !feedClientId)) {
          await logSend({
            periodKey: dedupKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
            visitGuid: v.visitGuid, sentAt: new Date().toISOString(), status: "skipped_no_data",
            includedStreams: report.clients.map((c) => ({ clientId: c.clientId, clientName: c.clientName, channel: report.subChannel, vendor: "" })),
          });
        }
        continue;
      }

      if (opts.dryRun) {
        outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store, status: "would-send", actions: report.totalActions });
        continue;
      }

      const token = uuid();
      const day = trackingDay();
      const base = reportBaseUrl(opts.origin);  // clean prod domain if configured
      // Signed, self-expiring token replaces the guessable site/period params.
      // The client list is signed INTO the link, so the page, the count sheet and
      // its email all stay limited to the same clients as this email.
      const r = signReportLink({ site: v.siteCode, clientIds, year: loaded.year, month: loaded.month, week: loaded.week });
      const params = new URLSearchParams({ r, t: token, d: day });
      const reportUrl = `${base}/r?${params.toString()}`;
      const trackingPixelUrl = `${base}/api/store-reports/track?t=${token}&d=${day}&e=open`;
      const html = renderStoreReportEmail(report, {
        repName: v.repName || "there",
        periodLabel: loaded.periodLabel,
        reportUrl,
        generatedAt: formatGeneratedAt(),
        version: brand.product,
        trackingPixelUrl,
        ...storeReportLogos(base, report.subChannel),
      });

      await sendStoreReportEmail({ to: v.repEmail, subject: `Store Report — ${store} — ${loaded.periodLabel}`, html });
      await addTrackingSend({
        token, day, periodKey: dedupKey, siteCode: v.siteCode, store,
        channel: report.subChannel, repEmail: v.repEmail, repName: v.repName, sentAt: new Date().toISOString(),
        year: loaded.year, month: loaded.month, week: loaded.week,
        clientIds,
      });
      await logSend({
        periodKey: dedupKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
        visitGuid: v.visitGuid, sentAt: new Date().toISOString(), status: "sent",
        includedStreams: report.clients.map((c) => ({ clientId: c.clientId, clientName: c.clientName, channel: report.subChannel, vendor: "" })),
      });
      sent++;
      outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store, status: "sent", actions: report.totalActions });
    } catch (e) {
      failed++;
      const detail = e instanceof Error ? e.message : "render/send failed";
      outcomes.push({ ...who, siteCode: v.siteCode, repEmail: v.repEmail, store: v.siteCode, status: "failed", detail });
    }
  }

  const skippedCount = outcomes.filter((o) => o.status.startsWith("skipped")).length;

  const run: SyncLastRun = {
    at: new Date().toISOString(), ok: failed === 0 && runProblems.length === 0,
    visitsSeen: queue.length, sent, skipped: skippedCount, failed,
    reasons: summariseReasons(outcomes),
    // A failing feed is invisible in the counts (just fewer visits), so every
    // feed problem is named here, by client name.
    message: [opts.dryRun ? "Dry run" : "", ...runProblems].filter(Boolean).join(" · ") || undefined,
  };
  if (!opts.dryRun) {
    await recordLastRun(run);
    await recordPerigeeFeedRuns(feedRuns).catch(() => {});
    // Durable per-rep audit of every outcome (incl. all skip reasons + failures),
    // so "why didn't rep X get their report?" is answerable after the fact.
    // Best-effort: an audit-write failure must never fail the run itself.
    await recordAuditOutcomes(dedupKey, outcomes).catch(() => {});
  }

  return { ...base, ok: run.ok, sent, skipped: skippedCount, failed, outcomes, message: run.message };
}
