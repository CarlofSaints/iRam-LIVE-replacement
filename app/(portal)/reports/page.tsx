"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import type { Client, Channel, SalesLedgerMeta } from "@/lib/types";

interface ReportStats {
  totalDispos: number;
  ytdVolume: number;
  ytdValue: number;
  totalSkus: number;
  totalStores: number;
}

export default function ReportsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [clientId, setClientId] = useState("");
  const [mainChannelId, setMainChannelId] = useState("");
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [ledgers, setLedgers] = useState<SalesLedgerMeta[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState("");

  // Stats
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Period selectors
  const [reportYear, setReportYear] = useState<number | "">("");
  const [reportMonth, setReportMonth] = useState<number | "">("");
  const [reportWeek, setReportWeek] = useState<number | "">("");

  // Load clients + channels
  useEffect(() => {
    (async () => {
      const [cRes, chRes] = await Promise.all([
        authFetch("/api/clients"),
        authFetch("/api/channels"),
      ]);
      if (cRes.ok) {
        const all: Client[] = await cRes.json();
        setClients(all.filter((c) => c.active));
      }
      if (chRes.ok) setChannels(await chRes.json());
    })();
  }, []);

  // When client changes, load ledgers
  useEffect(() => {
    if (!clientId) {
      setLedgers([]);
      setSelectedClient(null);
      setMainChannelId("");
      setSelectedSubIds([]);
      setStats(null);
      setReportYear("");
      setReportMonth("");
      setReportWeek("");
      return;
    }
    const client = clients.find((c) => c.id === clientId) ?? null;
    setSelectedClient(client);
    setMainChannelId("");
    setSelectedSubIds([]);
    setStats(null);

    (async () => {
      const res = await authFetch(`/api/sales?clientId=${clientId}`);
      if (res.ok) {
        const metas: SalesLedgerMeta[] = await res.json();
        setLedgers(metas);
        // Default period from latest ledger meta
        const withPeriod = metas.find((m) => m.reportYear);
        if (withPeriod) {
          setReportYear(withPeriod.reportYear ?? "");
          setReportMonth(withPeriod.reportMonth ?? "");
          setReportWeek(withPeriod.reportWeek ?? "");
        } else {
          setReportYear("");
          setReportMonth("");
          setReportWeek("");
        }
      } else {
        setLedgers([]);
      }
    })();
  }, [clientId, clients]);

  // When main channel changes, reset sub-channel selection
  useEffect(() => {
    setSelectedSubIds([]);
  }, [mainChannelId]);

  // Derive main channels that have at least one sub-channel assigned to the client
  const allSubChannels = channels.filter((c) => !!c.parentId);
  const clientMainChannels = selectedClient
    ? channels.filter(
        (ch) =>
          !ch.parentId &&
          (selectedClient.channelIds.includes(ch.id) ||
            allSubChannels.some(
              (sub) => sub.parentId === ch.id && selectedClient.channelIds.includes(sub.id)
            ))
      )
    : [];

  // Derive sub-channels under the selected main channel
  const subChannels = mainChannelId
    ? channels.filter((ch) => ch.parentId === mainChannelId)
    : [];

  // If a main channel has no sub-channels, the ledger uses the main channel ID directly
  const hasSubChannels = subChannels.length > 0;

  // The effective channel IDs for the report.
  const effectiveChannelIds = mainChannelId
    ? hasSubChannels
      ? [mainChannelId, ...selectedSubIds]
      : [mainChannelId]
    : [];

  // Fetch stats when client or effective channels change
  useEffect(() => {
    if (!clientId) {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    const params = new URLSearchParams({ clientId });
    if (effectiveChannelIds.length > 0) {
      params.set("channelIds", effectiveChannelIds.join(","));
    }
    (async () => {
      try {
        const res = await authFetch(`/api/reports/stats?${params}`);
        if (res.ok) setStats(await res.json());
        else setStats(null);
      } catch {
        setStats(null);
      }
      setStatsLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, mainChannelId, selectedSubIds.join(",")]);

  // Data requirement checks
  const hasLedger =
    effectiveChannelIds.length > 0 &&
    effectiveChannelIds.some((chId) =>
      ledgers.some((l) => l.channelId === chId && l.totalRows > 0)
    );
  const hasPmf = !!selectedClient?.controlFiles?.pmf;
  const hasLinks = !!selectedClient?.controlFiles?.links;

  // Aggregate ledger row count for selected channels
  const selectedLedgerRows = effectiveChannelIds.reduce((sum, chId) => {
    const l = ledgers.find((m) => m.channelId === chId);
    return sum + (l?.totalRows ?? 0);
  }, 0);

  function toggleSubChannel(id: string) {
    setSelectedSubIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectAllSubs() {
    setSelectedSubIds(subChannels.map((ch) => ch.id));
  }

  function clearAllSubs() {
    setSelectedSubIds([]);
  }

  async function downloadVitalSigns() {
    if (!clientId || effectiveChannelIds.length === 0) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams({
        clientId,
        channelIds: effectiveChannelIds.join(","),
      });
      if (reportYear) params.set("year", String(reportYear));
      if (reportMonth) params.set("month", String(reportMonth));
      if (reportWeek) params.set("week", String(reportWeek));

      const res = await authFetch(`/api/reports/vital-signs?${params}`);
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Download failed" }));
        setToast(err.error ?? "Download failed");
        setTimeout(() => setToast(""), 4000);
        setDownloading(false);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fnMatch = disposition.match(/filename="?([^"]+)"?/);
      const fileName = fnMatch ? fnMatch[1] : "Vital_Signs.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setToast("Report downloaded");
      setTimeout(() => setToast(""), 3000);
    } catch {
      setToast("Download failed");
      setTimeout(() => setToast(""), 4000);
    }
    setDownloading(false);
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Reports
      </h1>

      {toast && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          {toast}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 space-y-4">
        {/* Row 1: Client + Main Channel */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="">Select a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Main Channel
            </label>
            <select
              value={mainChannelId}
              onChange={(e) => setMainChannelId(e.target.value)}
              disabled={!clientId}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">Select a main channel</option>
              {clientMainChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Sub Channel checkboxes */}
        {mainChannelId && hasSubChannels && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-[var(--color-text)]">
                Sub Channels
              </label>
              <div className="flex gap-2">
                <button
                  onClick={selectAllSubs}
                  className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                >
                  Select All
                </button>
                <span className="text-xs text-[var(--color-text-muted)]">|</span>
                <button
                  onClick={clearAllSubs}
                  className="text-xs font-medium text-[var(--color-text-muted)] hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {subChannels.map((ch) => {
                const checked = selectedSubIds.includes(ch.id);
                const hasData = ledgers.some(
                  (l) => l.channelId === ch.id && l.totalRows > 0
                );
                return (
                  <label
                    key={ch.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      checked
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSubChannel(ch.id)}
                      className="accent-[var(--color-primary)]"
                    />
                    {ch.name}
                    {hasData && (
                      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      {clientId && stats && (
        <div className="mb-6 grid grid-cols-5 gap-4">
          <StatCard
            label="Total DISPOs"
            value={String(stats.totalDispos)}
            loading={statsLoading}
          />
          <StatCard
            label="YTD Volume"
            value={stats.ytdVolume.toLocaleString()}
            loading={statsLoading}
          />
          <StatCard
            label="YTD Value"
            value={`R ${stats.ytdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            loading={statsLoading}
          />
          <StatCard
            label="Total SKUs"
            value={String(stats.totalSkus)}
            loading={statsLoading}
          />
          <StatCard
            label="Total Stores"
            value={String(stats.totalStores)}
            loading={statsLoading}
          />
        </div>
      )}

      {/* Vital Signs Report Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Vital Signs
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Enriched DISPO report with DSC alerts, month last sold, site
              rankings, and open-to-order calculations.
            </p>
          </div>
          <button
            onClick={downloadVitalSigns}
            disabled={
              downloading ||
              !clientId ||
              effectiveChannelIds.length === 0 ||
              !hasLedger
            }
            className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            {downloading ? "Generating..." : "Download Excel"}
          </button>
        </div>

        {/* Period selectors */}
        {clientId && mainChannelId && (
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Year
              </label>
              <select
                value={reportYear}
                onChange={(e) => setReportYear(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Auto</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Month
              </label>
              <select
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Auto</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1).toLocaleString("en", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Week
              </label>
              <select
                value={reportWeek}
                onChange={(e) => setReportWeek(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Auto</option>
                {Array.from({ length: 5 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>W{w}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Data requirements */}
        <div className="flex flex-wrap gap-2">
          <RequirementBadge
            label="Sales Ledger"
            met={hasLedger}
            detail={
              selectedLedgerRows > 0
                ? `${selectedLedgerRows} rows`
                : "No data"
            }
          />
          <RequirementBadge
            label="PMF"
            met={hasPmf}
            detail={hasPmf ? "Uploaded" : "Not uploaded"}
          />
          <RequirementBadge
            label="LINKS"
            met={hasLinks}
            detail={hasLinks ? "Uploaded" : "Not uploaded"}
          />
          <RequirementBadge
            label="Store Files"
            met={true}
            detail="Optional"
          />
        </div>

        {!clientId && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Select a client and channel to generate the report.
          </p>
        )}
        {clientId && !mainChannelId && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Select a main channel to continue.
          </p>
        )}
        {mainChannelId && hasSubChannels && selectedSubIds.length === 0 && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Select at least one sub channel.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
      <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[var(--color-text)]">
        {loading ? (
          <span className="inline-block h-5 w-16 animate-pulse rounded bg-zinc-100" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function RequirementBadge({
  label,
  met,
  detail,
}: {
  label: string;
  met: boolean;
  detail: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        met ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          met ? "bg-green-500" : "bg-amber-500"
        }`}
      />
      {label}: {detail}
    </span>
  );
}
