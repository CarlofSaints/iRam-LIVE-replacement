/* ──────────────────────────────────────────────────────────────
   Store-report poller — the trigger that fires reports on check-in.

   Shared by the Vercel Cron (every few minutes) and the "Run now" button.
   Each run:
     1. respects the enabled flag + interval throttle (unless forced)
     2. requires an ARMED week (else check-ins are ignored)
     3. pulls today's Massmart visits via the SQL proxy
     4. filters to the configured channel allow-list
     5. per visit: dedups (visit GUID + store×rep), live-renders the store's
        consolidated report (minus excluded streams), emails the rep, logs the send
     6. records a run summary

   dryRun = do everything except actually send/log — for safe previewing.
   ────────────────────────────────────────────────────────────── */

import { getSyncSettings, recordLastRun, normaliseVisit, type SyncLastRun } from "./storeReportSync";
import { getTodayMassmartVisits } from "./sqlProxy";
import { hasProcessedVisit, hasSent, addSend } from "./storeReportLog";
import { loadStoreReport, formatGeneratedAt, storeReportLogos } from "./storeReportLoad";
import { renderStoreReportEmail } from "./storeReportEmail";
import { sendStoreReportEmail } from "./email";
import { addTrackingSend, trackingDay } from "./storeReportTracking";
import { v4 as uuid } from "uuid";

const normCh = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

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
  | "failed"
  | "would-send";

export interface RunVisitOutcome {
  siteCode: string;
  repEmail: string;
  store: string;
  status: RunVisitStatus;
  actions?: number;
  detail?: string;
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
  "skipped-channel": "Channel not in allow-list",
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

  // 3. Pull today's visits.
  let visits: Record<string, unknown>[];
  try {
    visits = await getTodayMassmartVisits();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "visit fetch failed";
    const run: SyncLastRun = { at: new Date().toISOString(), ok: false, visitsSeen: 0, sent: 0, skipped: 0, failed: 0, message: msg };
    if (!opts.dryRun) await recordLastRun(run);
    return { ...base, ok: false, outcomes, message: msg };
  }
  base.visitsSeen = visits.length;

  const allow = new Set(settings.channels.map(normCh));
  let sent = 0, skipped = 0, failed = 0;

  // 4. Per visit.
  for (const raw of visits) {
    const v = normaliseVisit(raw);
    if (!v.siteCode) { skipped++; outcomes.push({ siteCode: "", repEmail: v.repEmail, store: "", status: "skipped-no-sitecode", detail: "no site code on visit" }); continue; }

    // Channel allow-list (separator-insensitive). Empty channel = let through.
    if (v.channel && allow.size && !allow.has(normCh(v.channel))) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-channel", detail: v.channel }); continue;
    }

    // Dedup: same visit GUID already processed today, or this store×rep already sent today.
    if (v.visitGuid && await hasProcessedVisit(dedupKey, v.visitGuid)) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "visit already processed today" }); continue;
    }
    if (v.repEmail && await hasSent(dedupKey, v.siteCode, v.repEmail)) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "store+rep already sent today" }); continue;
    }
    if (!v.repEmail) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: "", store: "", status: "skipped-no-email", detail: `rep "${v.repName}" has no email` }); continue;
    }

    // Live-render the store's consolidated report (each client's latest data).
    try {
      const loaded = await loadStoreReport({ siteCode: v.siteCode });
      const report = loaded.report;
      const store = report.storeName || v.siteCode;

      if (report.totalActions === 0 || report.clients.length === 0) {
        skipped++;
        // No participating client had data for this site → the site code isn't in
        // any loaded DISPO (unmapped / not loaded). If clients matched but there's
        // nothing to action, it's genuinely a clean store this period.
        const noMapping = report.clients.length === 0;
        outcomes.push({
          siteCode: v.siteCode, repEmail: v.repEmail, store,
          status: noMapping ? "skipped-no-mapping" : "skipped-no-data",
          actions: 0,
          detail: noMapping ? "site not in any loaded DISPO (check code mapping / data load)" : "no actions to report this period",
        });
        if (!opts.dryRun) {
          await addSend({
            periodKey: dedupKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
            visitGuid: v.visitGuid, sentAt: new Date().toISOString(), status: "skipped_no_data",
            includedStreams: report.clients.map((c) => ({ clientId: c.clientId, clientName: c.clientName, channel: report.subChannel, vendor: "" })),
          });
        }
        continue;
      }

      if (opts.dryRun) {
        outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store, status: "would-send", actions: report.totalActions });
        continue;
      }

      const token = uuid();
      const day = trackingDay();
      const params = new URLSearchParams({ site: v.siteCode, year: String(loaded.year), month: String(loaded.month), week: String(loaded.week), t: token, d: day });
      const reportUrl = `${opts.origin}/r?${params.toString()}`;
      const trackingPixelUrl = `${opts.origin}/api/store-reports/track?t=${token}&d=${day}&e=open`;
      const html = renderStoreReportEmail(report, {
        repName: v.repName || "there",
        periodLabel: loaded.periodLabel,
        reportUrl,
        generatedAt: formatGeneratedAt(),
        version: "iRam LIVE",
        trackingPixelUrl,
        ...storeReportLogos(opts.origin, report.subChannel),
      });

      await sendStoreReportEmail({ to: v.repEmail, subject: `Store Report — ${store} — ${loaded.periodLabel}`, html });
      await addTrackingSend({
        token, day, periodKey: dedupKey, siteCode: v.siteCode, store,
        channel: report.subChannel, repEmail: v.repEmail, repName: v.repName, sentAt: new Date().toISOString(),
      });
      await addSend({
        periodKey: dedupKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
        visitGuid: v.visitGuid, sentAt: new Date().toISOString(), status: "sent",
        includedStreams: report.clients.map((c) => ({ clientId: c.clientId, clientName: c.clientName, channel: report.subChannel, vendor: "" })),
      });
      sent++;
      outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store, status: "sent", actions: report.totalActions });
    } catch (e) {
      failed++;
      const detail = e instanceof Error ? e.message : "render/send failed";
      outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "failed", detail });
    }
  }

  const skippedCount = outcomes.filter((o) => o.status.startsWith("skipped")).length;

  const run: SyncLastRun = {
    at: new Date().toISOString(), ok: failed === 0,
    visitsSeen: visits.length, sent, skipped: skippedCount, failed,
    reasons: summariseReasons(outcomes),
    message: opts.dryRun ? "Dry run" : undefined,
  };
  if (!opts.dryRun) await recordLastRun(run);

  return { ...base, ok: failed === 0, sent, skipped: skippedCount, failed, outcomes };
}
