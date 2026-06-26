"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch, usePermissions } from "@/lib/useAuth";

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

export default function StoreReportsTestPage() {
  const { can } = usePermissions();
  const canManage = can("manage_store_reports");

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
    </div>
  );
}
