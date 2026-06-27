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
import { getStoreReportState } from "./storeReportState";
import { getTodayMassmartVisits } from "./sqlProxy";
import { hasProcessedVisit, hasSent, addSend } from "./storeReportLog";
import { loadStoreReport, formatGeneratedAt, storeReportLogos } from "./storeReportLoad";
import { renderStoreReportEmail } from "./storeReportEmail";
import { sendStoreReportEmail } from "./email";

const normCh = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

export interface RunOptions {
  force?: boolean;     // ignore enabled flag + throttle (Run now)
  dryRun?: boolean;    // compute + report what would happen, but don't send/log
  origin: string;      // base URL for the report link + logos
}

export interface RunVisitOutcome {
  siteCode: string;
  repEmail: string;
  store: string;
  status: "sent" | "skipped-duplicate" | "skipped-no-data" | "skipped-no-email" | "skipped-channel" | "failed" | "would-send";
  actions?: number;
  detail?: string;
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

  // 2. Require an armed week.
  const state = await getStoreReportState();
  const activeKey = state.activePeriodKey;
  base.armedPeriod = activeKey;
  if (!activeKey) {
    const run: SyncLastRun = { at: new Date().toISOString(), ok: true, visitsSeen: 0, sent: 0, skipped: 0, failed: 0, message: "No week armed" };
    if (!opts.dryRun) await recordLastRun(run);
    return { ...base, ok: true, outcomes, message: "No week armed — check-ins ignored" };
  }
  const period = state.periods[activeKey];
  const m = activeKey.match(/^(\d{4})-(\d{2})-(\d+)$/);
  const year = m ? Number(m[1]) : undefined;
  const month = m ? Number(m[2]) : undefined;
  const week = m ? Number(m[3]) : undefined;
  const excludedStreams = period?.excludedStreams ?? [];

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
    if (!v.siteCode) { skipped++; outcomes.push({ siteCode: "", repEmail: v.repEmail, store: "", status: "skipped-no-data", detail: "no site code on visit" }); continue; }

    // Channel allow-list (separator-insensitive). Empty channel = let through.
    if (v.channel && allow.size && !allow.has(normCh(v.channel))) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-channel", detail: v.channel }); continue;
    }

    // Dedup: same visit GUID already processed, or this store×rep already sent.
    if (v.visitGuid && await hasProcessedVisit(activeKey, v.visitGuid)) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "visit already processed" }); continue;
    }
    if (v.repEmail && await hasSent(activeKey, v.siteCode, v.repEmail)) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store: "", status: "skipped-duplicate", detail: "store+rep already sent" }); continue;
    }
    if (!v.repEmail) {
      skipped++; outcomes.push({ siteCode: v.siteCode, repEmail: "", store: "", status: "skipped-no-email", detail: `rep "${v.repName}" has no email` }); continue;
    }

    // Live-render the store's consolidated report (minus excluded streams).
    try {
      const loaded = await loadStoreReport({ siteCode: v.siteCode, year, month, week, excludedStreams });
      const report = loaded.report;
      const store = report.storeName || v.siteCode;

      if (report.totalActions === 0 || report.clients.length === 0) {
        skipped++;
        outcomes.push({ siteCode: v.siteCode, repEmail: v.repEmail, store, status: "skipped-no-data", actions: 0 });
        if (!opts.dryRun) {
          await addSend({
            periodKey: activeKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
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

      const params = new URLSearchParams({ site: v.siteCode, year: String(loaded.year), month: String(loaded.month), week: String(loaded.week) });
      const reportUrl = `${opts.origin}/r?${params.toString()}`;
      const html = renderStoreReportEmail(report, {
        repName: v.repName || "there",
        periodLabel: loaded.periodLabel,
        reportUrl,
        generatedAt: formatGeneratedAt(),
        version: "iRam LIVE",
        ...storeReportLogos(opts.origin, report.subChannel),
      });

      await sendStoreReportEmail({ to: v.repEmail, subject: `Store Report — ${store} — ${loaded.periodLabel}`, html });
      await addSend({
        periodKey: activeKey, siteCode: v.siteCode, storeName: store, repEmail: v.repEmail,
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
    message: opts.dryRun ? "Dry run" : undefined,
  };
  if (!opts.dryRun) await recordLastRun(run);

  return { ...base, ok: failed === 0, sent, skipped: skippedCount, failed, outcomes };
}
