"use client";

/* Per-client Perigee feeds for store reports.

   The main feed only returns what iRam's own Perigee user can see. A customer's
   reps can be outside it, so a client can be given the API token of a Perigee
   app user allocated to ONLY that customer. Its check-ins go ONLY to people set
   up under Users as that client's rep ("Only receives their own clients' data"
   ticked, with this client ticked). Everyone else on the feed is skipped. */

import { useCallback, useEffect, useState } from "react";
import { authFetch, useAuth } from "@/lib/useAuth";

interface FeedView {
  clientId: string;
  tokenEnding: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  lastRun?: { at: string; ok: boolean; visits: number; error?: string };
}

interface TestResult {
  ok: boolean;
  error?: string;
  day?: string;
  visits?: number;
  withSiteCode?: number;
  withEmail?: number;
  reps?: string[];
  fieldNames?: string[];
}

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

export default function PerigeeFeedsPanel() {
  const { user } = useAuth();
  const canEdit = user?.role === "super_admin";
  const [feeds, setFeeds] = useState<FeedView[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    const [f, c] = await Promise.all([authFetch("/api/store-reports/perigee-feeds"), authFetch("/api/clients?scope=all")]);
    if (f.ok) { setFeeds((await f.json()).feeds ?? []); setLoadError(""); }
    else setLoadError("Could not load the client feeds.");
    if (c.ok) setClients(await c.json());
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const existing = feeds.find((f) => f.clientId === clientId);

  async function post(payload: Record<string, unknown>) {
    const res = await authFetch("/api/store-reports/perigee-feeds", { method: "POST", body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, data };
  }

  async function save(extra: Record<string, unknown> = {}, forClient = clientId) {
    setBusy("save"); setMessage(null);
    const { ok, data } = await post({ action: "save", clientId: forClient, ...extra });
    setBusy("");
    if (!ok) { setMessage({ tone: "bad", text: data.error || "Could not save." }); return; }
    setToken("");
    setMessage({ tone: "good", text: `Saved for ${nameOf(forClient)}.` });
    load();
  }

  async function runTest(forClient = clientId, withToken = token) {
    setBusy("test"); setTest(null); setMessage(null);
    const { data } = await post({ action: "test", clientId: forClient, token: withToken || undefined });
    setBusy("");
    setTest(data as TestResult);
  }

  async function remove(id: string) {
    if (!confirm(`Remove the Perigee feed for ${nameOf(id)}? Its reps stop getting reports from it on the next run.`)) return;
    setBusy("remove"); setMessage(null);
    const { ok, data } = await post({ action: "remove", clientId: id });
    setBusy("");
    setMessage(ok ? { tone: "good", text: `Removed the feed for ${nameOf(id)}.` } : { tone: "bad", text: data.error || "Could not remove." });
    load();
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-5">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Client Perigee feeds</h2>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">
        Only needed for a client whose own reps don&apos;t show up in the main feed. Paste the Perigee API token of an app
        user allocated to <strong>only that client&apos;s customer</strong>. Its check-ins are sent only to people set up
        under Users with <em>Only receives their own clients&apos; data</em> ticked and this client ticked. Anyone else on
        the feed (iRam&apos;s own reps included) is skipped here and keeps getting their report as before.
      </p>

      {loadError && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}

      {loaded && !loadError && (
        feeds.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">No client has a feed yet. The main feed covers everyone.</p>
        ) : (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Token</th>
                  <th className="py-2 pr-4">On</th>
                  <th className="py-2 pr-4">Last poll</th>
                  <th className="py-2 pr-4">Changed</th>
                  {canEdit && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => (
                  <tr key={f.clientId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-4 font-medium">{nameOf(f.clientId)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">…{f.tokenEnding}</td>
                    <td className="py-2 pr-4">
                      {canEdit ? (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={f.enabled} disabled={!!busy}
                            onChange={(e) => save({ enabled: e.target.checked }, f.clientId)} />
                          {f.enabled ? "On" : "Off"}
                        </label>
                      ) : (f.enabled ? "On" : "Off")}
                    </td>
                    <td className="py-2 pr-4">
                      {!f.lastRun ? <span className="text-[var(--color-text-muted)]">Not polled yet</span>
                        : f.lastRun.ok ? <span>{f.lastRun.visits} visit{f.lastRun.visits === 1 ? "" : "s"} · {when(f.lastRun.at)}</span>
                        : <span className="text-red-700">Failed: {f.lastRun.error} · {when(f.lastRun.at)}</span>}
                    </td>
                    <td className="py-2 pr-4 text-xs text-[var(--color-text-muted)]">{f.updatedBy} · {when(f.updatedAt)}</td>
                    {canEdit && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <button onClick={() => runTest(f.clientId, "")} disabled={!!busy} className="mr-3 text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50">Test</button>
                        <button onClick={() => remove(f.clientId)} disabled={!!busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] sm:items-end">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Client</span>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setTest(null); }}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="">Pick a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              {existing ? `Replace token (current ends …${existing.tokenEnding})` : "Perigee API token"}
            </span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token" className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-sm" />
          </label>
          <button onClick={() => runTest()} disabled={!clientId || (!token && !existing) || !!busy}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy === "test" ? "Testing…" : "Test today's visits"}
          </button>
          <button onClick={() => save({ token, enabled: true })} disabled={!clientId || !token || !!busy}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "save" ? "Saving…" : existing ? "Replace token" : "Save and switch on"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">Only a Super Admin can add or change a feed.</p>
      )}

      {message && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.tone === "good" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      {test && (
        <div className={`mt-3 rounded-lg border px-4 py-3 text-sm ${test.ok ? "border-[var(--color-border)] bg-zinc-50" : "border-red-200 bg-red-50 text-red-700"}`}>
          {!test.ok ? <>Test failed: {test.error}</> : (
            <>
              <div className="font-medium">
                {test.visits} visit{test.visits === 1 ? "" : "s"} today ({test.day})
                {test.visits ? ` · ${test.withSiteCode} with a store code · ${test.withEmail} with a rep email` : ""}
              </div>
              {test.visits === 0 && (
                <p className="mt-1 text-[var(--color-text-muted)]">The token works, but nobody has checked in today. Test again after a check-in.</p>
              )}
              {!!test.reps?.length && (
                <p className="mt-1"><span className="text-[var(--color-text-muted)]">Reps on this feed today:</span> {test.reps.join(", ")}</p>
              )}
              {!!test.visits && (test.withEmail ?? 0) < (test.visits ?? 0) && (
                <p className="mt-1 text-amber-700">
                  Some visits have no rep email, so they can&apos;t be matched to a user. Fields Perigee sent: {test.fieldNames?.join(", ")}
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Check the reps: if this list includes people who don&apos;t work for this client, the token sees more than one
                customer. They still won&apos;t receive this client&apos;s report unless set up as its rep, but ask Riaz for a
                token limited to this customer.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
