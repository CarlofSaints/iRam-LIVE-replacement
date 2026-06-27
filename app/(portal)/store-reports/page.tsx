"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch, useAuth, usePermissions } from "@/lib/useAuth";

interface ClientOpt { id: string; name: string; flagged: boolean }
interface StoreOpt { siteCode: string; siteName: string; subChannel: string }
interface SendResult {
  to: string;
  store: string;
  clients: string[];
  counts: Record<string, number>;
  totalActions: number;
  totalProducts: number;
  reportUrl: string;
}

const CARD_LABELS: [string, string][] = [
  ["oos", "Out of Stock"],
  ["lowCover", "Low Stock Cover"],
  ["phantom", "Phantom"],
  ["status", "Status"],
  ["marginRisk", "Margin Risk"],
  ["marginOpp", "Margin Opportunity"],
];

interface SyncSettings { enabled: boolean; channels: string[]; minIntervalSeconds: number; lastRun?: { at: string; ok: boolean; visitsSeen: number; sent: number; skipped: number; failed: number; message?: string } }
interface RunOutcome { siteCode: string; repEmail: string; store: string; status: string; actions?: number; detail?: string }
interface RunResult { ok: boolean; armedPeriod: string | null; visitsSeen: number; sent: number; skipped: number; failed: number; dryRun: boolean; outcomes: RunOutcome[]; message?: string }
interface EngSummary { channel: string; sent: number; opened: number; used: number }
interface EngDetail { store: string; siteCode: string; channel: string; repName: string; repEmail: string; sentAt: string; opened: boolean; used: boolean; cardClicks: number; distinctCards: string[]; test: boolean }
interface EngResult { day: string; summary: EngSummary[]; totalSent: number; detail: EngDetail[] }

export default function StoreReportsTestPage() {
  const { can } = usePermissions();
  const { user } = useAuth();
  const canManage = can("manage_store_reports");
  const isSuperAdmin = user?.role === "super_admin";

  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [siteCode, setSiteCode] = useState<string>("");
  const [loadingStores, setLoadingStores] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);

  // Load clients + stores (scoped to the selected client).
  async function loadStores(forClient: string) {
    setLoadingStores(true);
    setError("");
    try {
      const qs = forClient ? `?clientId=${encodeURIComponent(forClient)}` : "";
      const res = await authFetch(`/api/store-reports/stores${qs}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setClients(d.clients || []);
        setStores(d.stores || []);
        if (d.stores?.length && !d.stores.some((s: StoreOpt) => s.siteCode === siteCode)) {
          setSiteCode(d.stores[0].siteCode);
        }
      } else {
        setError(d.error || "Failed to load stores");
      }
    } catch {
      setError("Network error");
    }
    setLoadingStores(false);
  }

  useEffect(() => { loadStores(""); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (clients.length) loadStores(clientId); /* eslint-disable-next-line */ }, [clientId]);

  const previewUrl = useMemo(() => {
    if (!siteCode) return "";
    const p = new URLSearchParams({ site: siteCode });
    if (clientId) p.set("clientId", clientId);
    return `/r?${p.toString()}`;
  }, [siteCode, clientId]);

  async function sendTest() {
    if (!siteCode) return;
    setSending(true);
    setError("");
    setResult(null);
    try {
      const res = await authFetch("/api/store-reports/test", {
        method: "POST",
        body: JSON.stringify({ siteCode, clientId: clientId || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setResult(d as SendResult);
      else setError(d.error || "Send failed");
    } catch {
      setError("Network error");
    }
    setSending(false);
  }

  // ── Sync settings (super-admin) ──
  const [sync, setSync] = useState<SyncSettings | null>(null);
  const [channelsText, setChannelsText] = useState("");
  const [proxyOk, setProxyOk] = useState<boolean | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function loadSync() {
    try {
      const res = await authFetch("/api/store-reports/sync");
      if (res.ok) {
        const d = await res.json();
        setSync(d.settings);
        setChannelsText((d.settings.channels || []).join("\n"));
        setProxyOk(!!d.proxyConfigured);
      }
    } catch { /* ignore */ }
  }
  useEffect(() => { if (isSuperAdmin) loadSync(); /* eslint-disable-next-line */ }, [isSuperAdmin]);

  async function saveSync(next: Partial<SyncSettings>) {
    setSyncBusy(true); setSyncMsg(""); setRunResult(null);
    try {
      const res = await authFetch("/api/store-reports/sync", {
        method: "POST",
        body: JSON.stringify({
          action: "save",
          enabled: next.enabled ?? sync?.enabled,
          channels: channelsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          minIntervalSeconds: next.minIntervalSeconds ?? sync?.minIntervalSeconds ?? 0,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setSync(d.settings); setSyncMsg("Saved"); setTimeout(() => setSyncMsg(""), 2500); }
      else setSyncMsg(d.error || "Save failed");
    } catch { setSyncMsg("Network error"); }
    setSyncBusy(false);
  }

  async function runSync(dry: boolean) {
    setSyncBusy(true); setSyncMsg(""); setRunResult(null);
    try {
      const res = await authFetch("/api/store-reports/sync", {
        method: "POST",
        body: JSON.stringify({ action: dry ? "dryrun" : "run" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setRunResult(d as RunResult); loadSync(); }
      else setSyncMsg(d.error || "Run failed");
    } catch { setSyncMsg("Network error"); }
    setSyncBusy(false);
  }

  // ── Engagement / detail log ──
  const todayStr = new Date().toLocaleDateString("en-CA");
  const [engDay, setEngDay] = useState(todayStr);
  const [eng, setEng] = useState<EngResult | null>(null);
  const [engBusy, setEngBusy] = useState(false);
  const [engMsg, setEngMsg] = useState("");

  async function loadEng(day: string) {
    setEngBusy(true);
    try {
      const res = await authFetch(`/api/store-reports/engagement?day=${encodeURIComponent(day)}`);
      if (res.ok) setEng(await res.json());
    } catch { /* ignore */ }
    setEngBusy(false);
  }
  useEffect(() => { if (canManage) loadEng(engDay); /* eslint-disable-next-line */ }, [engDay, canManage]);

  async function sendDigest(send: boolean) {
    setEngBusy(true); setEngMsg("");
    try {
      const res = await authFetch("/api/store-reports/engagement", {
        method: "POST", body: JSON.stringify({ day: engDay, send }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setEngMsg(send ? `Digest sent to ${d.recipients?.length ?? 0} manager(s)` : `Preview: ${d.totalSent} sent, ${d.recipients?.length ?? 0} manager recipient(s)`);
      else setEngMsg(d.error || "Failed");
    } catch { setEngMsg("Network error"); }
    setEngBusy(false);
    setTimeout(() => setEngMsg(""), 4000);
  }

  if (!canManage) {
    return <div className="p-8 text-sm text-[var(--color-text-muted)]">You don&apos;t have access to store reports.</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-[var(--color-text)]">Store Reports — Test</h1>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Pick a client and store, then preview the live action-list page or email the summary to yourself
        (uses the most recently loaded week). Sends to your own address only.
      </p>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm">
              <option value="">All flagged clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.flagged ? "  ✓" : ""}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Store {loadingStores && <span className="font-normal normal-case">(loading…)</span>}
            </span>
            <select
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value)}
              disabled={loadingStores || stores.length === 0}
              className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm disabled:opacity-50">
              {stores.length === 0 && <option value="">No stores with data</option>}
              {stores.map((s) => (
                <option key={s.siteCode} value={s.siteCode}>
                  {s.siteName ? `${s.siteName} — ${s.siteCode}` : s.siteCode}{s.subChannel ? ` (${s.subChannel})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={previewUrl || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!siteCode}
            onClick={(e) => { if (!siteCode) e.preventDefault(); }}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              siteCode
                ? "border-[var(--color-border)] text-[var(--color-text)] hover:border-zinc-400"
                : "border-zinc-200 text-zinc-300 cursor-not-allowed"}`}>
            Preview report ↗
          </a>
          <button
            onClick={sendTest}
            disabled={!siteCode || sending}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
            {sending ? "Sending…" : "Send test to me"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-semibold text-green-800">
            ✓ Sent to {result.to} — {result.store}
          </p>
          <p className="mt-1 text-xs text-green-700">
            {result.totalActions} items to action · {result.totalProducts} products · clients: {result.clients.join(", ") || "—"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CARD_LABELS.map(([k, label]) => (
              <span key={k} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-text)] border border-green-200">
                {label}: <b>{result.counts?.[k] ?? 0}</b>
              </span>
            ))}
          </div>
          <a href={result.reportUrl} target="_blank" rel="noreferrer"
            className="mt-3 inline-block text-xs font-semibold text-[var(--color-primary)] underline">
            Open the hosted report ↗
          </a>
        </div>
      )}

      {/* ── Sync (auto-trigger) — super admin only ── */}
      {isSuperAdmin && (
        <div className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-[var(--color-text)]">Auto-send (check-in trigger)</h2>
          <p className="mb-4 max-w-2xl text-sm text-[var(--color-text-muted)]">
            A scheduled job runs every 3 minutes: it reads today&apos;s Massmart check-ins and emails each store&apos;s
            consolidated report to the rep — using each client&apos;s latest loaded data, once per store + rep per day.
            No arming needed; this toggle is the only on/off.
          </p>

          {proxyOk === false && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              SQL proxy not configured (SQL_PROXY_URL / SQL_PROXY_API_KEY). The trigger can&apos;t read check-ins until that&apos;s set.
            </div>
          )}
          {syncMsg && <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-[var(--color-text)]">{syncMsg}</div>}

          {sync && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">Auto-send enabled</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Master switch for the scheduled job.</div>
                </div>
                <button
                  onClick={() => saveSync({ enabled: !sync.enabled })}
                  disabled={syncBusy}
                  className={`relative h-7 w-12 rounded-full transition-colors ${sync.enabled ? "bg-[var(--color-primary)]" : "bg-zinc-300"} disabled:opacity-50`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${sync.enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>

              <label className="mt-6 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Channel allow-list (one per line)</span>
                <textarea
                  value={channelsText}
                  onChange={(e) => setChannelsText(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-mono"
                  placeholder="Makro&#10;BWH&#10;..." />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Only check-ins on these Perigee channels trigger a report (matched ignoring case / spaces / dashes).</span>
              </label>

              <label className="mt-4 block max-w-xs">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Min seconds between runs (throttle)</span>
                <input
                  type="number" min={0}
                  value={sync.minIntervalSeconds}
                  onChange={(e) => setSync({ ...sync, minIntervalSeconds: Number(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">0 = run every time the cron fires (every 3 min).</span>
              </label>

              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => saveSync({})} disabled={syncBusy}
                  className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
                  {syncBusy ? "Saving…" : "Save settings"}
                </button>
                <button onClick={() => runSync(true)} disabled={syncBusy}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
                  Dry run (preview)
                </button>
                <button onClick={() => runSync(false)} disabled={syncBusy}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  Run now (sends!)
                </button>
              </div>

              {sync.lastRun && (
                <div className="mt-4 text-xs text-[var(--color-text-muted)]">
                  Last run {new Date(sync.lastRun.at).toLocaleString("en-GB")} — {sync.lastRun.ok ? "OK" : "error"} ·
                  {" "}{sync.lastRun.visitsSeen} visits · {sync.lastRun.sent} sent · {sync.lastRun.skipped} skipped · {sync.lastRun.failed} failed
                  {sync.lastRun.message ? ` · ${sync.lastRun.message}` : ""}
                </div>
              )}
            </div>
          )}

          {runResult && (
            <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-white p-5">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {runResult.dryRun ? "Dry run" : "Run"} — day: {runResult.armedPeriod || "none"} · {runResult.visitsSeen} visits ·
                {" "}{runResult.sent} sent · {runResult.skipped} skipped · {runResult.failed} failed
                {runResult.message ? ` · ${runResult.message}` : ""}
              </p>
              {runResult.outcomes.length > 0 && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 text-[var(--color-text-muted)]">
                      <tr><th className="px-3 py-2 text-left">Store</th><th className="px-3 py-2 text-left">Rep</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
                    </thead>
                    <tbody>
                      {runResult.outcomes.map((o, i) => (
                        <tr key={i} className="border-t border-zinc-100">
                          <td className="px-3 py-1.5">{o.store || o.siteCode}</td>
                          <td className="px-3 py-1.5">{o.repEmail || "—"}</td>
                          <td className="px-3 py-1.5">{o.status}{o.detail ? ` (${o.detail})` : ""}</td>
                          <td className="px-3 py-1.5 text-right">{o.actions ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Engagement / detail log ── */}
      <div className="mt-10">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--color-text)]">Engagement</h2>
          <div className="flex items-center gap-2">
            <input type="date" value={engDay} onChange={(e) => setEngDay(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm" />
            <button onClick={() => loadEng(engDay)} disabled={engBusy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50">
              {engBusy ? "…" : "Refresh"}
            </button>
            {isSuperAdmin && (
              <>
                <button onClick={() => sendDigest(false)} disabled={engBusy}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
                  Preview digest
                </button>
                <button onClick={() => sendDigest(true)} disabled={engBusy}
                  className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
                  Send digest now
                </button>
              </>
            )}
          </div>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Who&apos;s actually using the reports. <b>Opened</b> = email opened or page viewed; <b>Used</b> = clicked more than one KPI card.
        </p>
        {engMsg && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{engMsg}</div>}

        {eng && (
          <>
            {/* Per-channel summary */}
            <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Channel</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Sent</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Opened</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {eng.summary.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--color-text-muted)]">No reports sent on this day.</td></tr>
                  ) : eng.summary.map((s) => (
                    <tr key={s.channel} className="border-t border-zinc-100">
                      <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{s.channel}</td>
                      <td className="px-4 py-2.5 text-center">{s.sent}</td>
                      <td className="px-4 py-2.5 text-center">{s.opened} <span className="text-[var(--color-text-muted)]">({s.sent ? Math.round((s.opened / s.sent) * 100) : 0}%)</span></td>
                      <td className="px-4 py-2.5 text-center">{s.used} <span className="text-[var(--color-text-muted)]">({s.sent ? Math.round((s.used / s.sent) * 100) : 0}%)</span></td>
                    </tr>
                  ))}
                </tbody>
                {eng.summary.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[var(--color-border)] bg-zinc-50 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-center">{eng.totalSent}</td>
                      <td className="px-4 py-2.5 text-center">{eng.summary.reduce((a, s) => a + s.opened, 0)}</td>
                      <td className="px-4 py-2.5 text-center">{eng.summary.reduce((a, s) => a + s.used, 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Detail log */}
            {eng.detail.length > 0 && (
              <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Store</th>
                      <th className="px-3 py-2 text-left font-semibold">Channel</th>
                      <th className="px-3 py-2 text-left font-semibold">Rep</th>
                      <th className="px-3 py-2 text-center font-semibold">Opened</th>
                      <th className="px-3 py-2 text-center font-semibold">Used</th>
                      <th className="px-3 py-2 text-center font-semibold">Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eng.detail.map((d, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        <td className="px-3 py-1.5">{d.store}{d.test && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">test</span>}</td>
                        <td className="px-3 py-1.5">{d.channel}</td>
                        <td className="px-3 py-1.5">{d.repName || d.repEmail}</td>
                        <td className="px-3 py-1.5 text-center">{d.opened ? "✓" : "—"}</td>
                        <td className="px-3 py-1.5 text-center">{d.used ? <span className="font-semibold text-green-600">✓</span> : "—"}</td>
                        <td className="px-3 py-1.5 text-center">{d.distinctCards.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
