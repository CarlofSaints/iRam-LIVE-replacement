"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import SearchSelect from "@/components/SearchSelect";
import MultiSelect from "@/components/MultiSelect";
import { analyzeCoverage, formatMonth, type CoverageResult } from "@/lib/dataCoverage";
import type { Client, Channel, SalesLedgerMeta } from "@/lib/types";

interface ReportStats {
  totalDispos: number;
  ytdVolume: number;
  ytdValue: number;
  totalSkus: number;
  totalStores: number;
}

// Sub-channels pre-selected by default on the report (others must be ticked in).
const DEFAULT_SUBCHANNELS = ["MAKRO", "BWH", "BEX", "BTD", "SS"];

const REPORT_SHEETS = [
  { key: "sales", label: "Sales" },
  { key: "oos", label: "OOS" },
  { key: "oosDetail", label: "OOS Detail" },
  { key: "dsc", label: "DSC" },
  { key: "dscDetail", label: "DSC Detail" },
  { key: "status", label: "Status" },
  { key: "statusDetail", label: "Status Detail" },
  { key: "margin", label: "Margin" },
  { key: "phantom", label: "Phantom" },
  { key: "oto", label: "OTO" },
  { key: "otoDetail", label: "OTO Detail" },
  { key: "nd", label: "ND" },
  { key: "ndDetail", label: "ND Detail" },
  { key: "ndFalse", label: "ND False" },
  { key: "data", label: "Data" },
];

export default function ReportsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [clientId, setClientId] = useState("");
  const [mainChannelId, setMainChannelId] = useState("");
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [ledgers, setLedgers] = useState<SalesLedgerMeta[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingMonthEnd, setDownloadingMonthEnd] = useState(false);
  const [monthEndError, setMonthEndError] = useState("");
  const [toast, setToast] = useState("");

  // Stats
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Period selectors — Vital Signs
  const [reportYear, setReportYear] = useState<number | "">("");
  const [reportMonth, setReportMonth] = useState<number | "">("");
  const [reportWeek, setReportWeek] = useState<number | "">("");

  // Period selectors — Month-End (independent)
  const [meYear, setMeYear] = useState<number | "">("");
  const [meMonth, setMeMonth] = useState<number | "">("");
  const [meWeek, setMeWeek] = useState<number | "">("");

  // Dimension filters — Month-End (Sub-Channel + Category)
  const [dimSubChannels, setDimSubChannels] = useState<string[]>([]);
  const [dimCategories, setDimCategories] = useState<string[]>([]);
  const [meSubChannels, setMeSubChannels] = useState<string[]>([]);
  const [meCategories, setMeCategories] = useState<string[]>([]);

  // Phantom-stock thresholds (months); "" = Any
  const [phLastSold, setPhLastSold] = useState<number | "">(3);
  const [phLastReceived, setPhLastReceived] = useState<number | "">(3);

  // ND rolling window in months (1–24, default 6)
  const [ndMonths, setNdMonths] = useState<number>(6);

  // Which sheets to include in the Month-End workbook (default: all)
  const [selectedSheets, setSelectedSheets] = useState<string[]>(REPORT_SHEETS.map((s) => s.key));

  // Load clients + channels
  useEffect(() => {
    (async () => {
      const [cRes, chRes] = await Promise.all([
        authFetch("/api/clients?scope=all"),
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
      setMeYear("");
      setMeMonth("");
      setMeWeek("");
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
        // Default to the MOST RECENT month/year present in the actual data
        // (the date columns), since uploads don't always stamp a report period.
        // Fall back to the latest stamped period; week comes from metadata.
        const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
        const ymScore = (y: number, m: number) => y * 100 + m;
        let bestY = 0;
        let bestM = 0;
        for (const meta of metas) {
          for (const col of meta.dateColumns ?? []) {
            const mm = /^(\d{2})-(\d{4})$/.exec(col);
            if (mm) {
              const y = Number(mm[2]);
              const mo = Number(mm[1]);
              if (ymScore(y, mo) > ymScore(bestY, bestM)) { bestY = y; bestM = mo; }
            }
          }
          const my = num(meta.reportYear);
          if (my && ymScore(my, num(meta.reportMonth)) > ymScore(bestY, bestM)) {
            bestY = my; bestM = num(meta.reportMonth);
          }
        }
        if (bestY > 0) {
          // Week: latest week stamped on a ledger for the chosen month/year (blank if none)
          let bestW = 0;
          for (const meta of metas) {
            if (num(meta.reportYear) === bestY && num(meta.reportMonth) === bestM) {
              bestW = Math.max(bestW, num(meta.reportWeek));
            }
          }
          const y: number | "" = bestY;
          const mo: number | "" = bestM || "";
          const wk: number | "" = bestW || "";
          setReportYear(y); setReportMonth(mo); setReportWeek(wk);
          setMeYear(y); setMeMonth(mo); setMeWeek(wk);
        } else {
          setReportYear("");
          setReportMonth("");
          setReportWeek("");
          setMeYear("");
          setMeMonth("");
          setMeWeek("");
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

  // Load Month-End filter options (sub-channels + categories) for the selection
  useEffect(() => {
    setMeSubChannels([]);
    setMeCategories([]);
    if (!clientId || effectiveChannelIds.length === 0) {
      setDimSubChannels([]);
      setDimCategories([]);
      return;
    }
    const params = new URLSearchParams({ clientId, channelIds: effectiveChannelIds.join(",") });
    (async () => {
      try {
        const res = await authFetch(`/api/reports/dimensions?${params}`);
        if (res.ok) {
          const d = await res.json();
          const subs: string[] = d.subChannels ?? [];
          setDimSubChannels(subs);
          setDimCategories(d.categories ?? []);
          // Default-select the standard sub-channels that exist (else leave all)
          const def = subs.filter((s) => DEFAULT_SUBCHANNELS.includes(String(s).trim().toUpperCase()));
          setMeSubChannels(def);
        } else {
          setDimSubChannels([]);
          setDimCategories([]);
        }
      } catch {
        setDimSubChannels([]);
        setDimCategories([]);
      }
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

  // Data-coverage check: scope to the selected channels once chosen, else the
  // whole client (so the warning appears the moment a client is picked).
  const coverage = useMemo(() => {
    const src = effectiveChannelIds.length > 0
      ? ledgers.filter((l) => effectiveChannelIds.includes(l.channelId))
      : ledgers;
    const cols = new Set<string>();
    for (const l of src) for (const dc of l.dateColumns ?? []) cols.add(dc);
    return analyzeCoverage([...cols]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgers, effectiveChannelIds.join(",")]);

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

  // Build a toast suffix describing the SharePoint auto-save result (from response headers)
  function spSaveSuffix(res: Response): string {
    const saved = res.headers.get("X-SP-Saved");
    if (!saved) return ""; // no SP folder configured for this report
    if (saved === "ok") return " · saved to SharePoint ✓";
    const err = res.headers.get("X-SP-Error");
    return ` · SharePoint save failed${err ? `: ${decodeURIComponent(err)}` : ""}`;
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

      setToast("Report downloaded" + spSaveSuffix(res));
      setTimeout(() => setToast(""), 5000);
    } catch {
      setToast("Download failed");
      setTimeout(() => setToast(""), 4000);
    }
    setDownloading(false);
  }

  async function downloadMonthEnd() {
    if (!clientId || effectiveChannelIds.length === 0) return;
    setDownloadingMonthEnd(true);
    try {
      const params = new URLSearchParams({
        clientId,
        channelIds: effectiveChannelIds.join(","),
      });
      if (meYear) params.set("year", String(meYear));
      if (meMonth) params.set("month", String(meMonth));
      if (meWeek) params.set("week", String(meWeek));
      if (meSubChannels.length) params.set("subChannels", meSubChannels.join(","));
      if (meCategories.length) params.set("categories", meCategories.join(","));
      if (phLastSold) params.set("phLastSold", String(phLastSold));
      if (phLastReceived) params.set("phLastReceived", String(phLastReceived));
      if (ndMonths) params.set("ndMonths", String(ndMonths));
      if (mainChannelId) params.set("mainChannelId", mainChannelId);
      if (selectedSheets.length) params.set("sheets", selectedSheets.join(","));

      const startedAt = Date.now();
      const res = await authFetch(`/api/reports/month-end?${params}`);
      if (!res.ok) {
        /* A failed report must STAY on screen. This used to be a toast that
           cleared itself after 4 seconds, so the reason was gone before anyone
           could read it and "it just doesn't generate" was all we ever heard. */
        const secs = Math.round((Date.now() - startedAt) / 1000);
        const err = await res.json().catch(() => null);
        if (err?.error) {
          setMonthEndError(err.error);
        } else if (res.status === 504 || res.status === 408 || res.status === 502) {
          setMonthEndError(
            `The report ran for ${secs} seconds and was cut off by the server before it finished (HTTP ${res.status}). ` +
              `It has too much to build in one go. Untick the big detail sheets — Data, OOS Detail, Status Detail, DSC Detail, ND Detail — ` +
              `or narrow the Sub-Channel / Category filters, and run it again.`,
          );
        } else {
          /* No JSON body means the function was killed rather than returning
             an error — the route's catch always responds with JSON. Since the
             workbook is streamed this should no longer happen on size alone,
             so don't claim to know the cause.

             The old wording here told people to untick "the big detail sheets
             (Data, OOS Detail, …)". That was measurably wrong: dropping Data
             alone changed nothing, and only unticking EVERY detail sheet
             helped. Naming a partial list sent people down a dead end. */
          setMonthEndError(
            `The report failed after ${secs} seconds (HTTP ${res.status}) and the server did not say why, ` +
              `which usually means it hit a resource limit. Try again — if it fails a second time, untick ` +
              `every detail sheet (Data, OOS Detail, DSC Detail, Status Detail, OTO Detail, ND Detail, ` +
              `ND False) to confirm it is a size problem, then send this message to Carl. ` +
              `Unticking only some of them will not help.`,
          );
        }
        setDownloadingMonthEnd(false);
        return;
      }
      setMonthEndError("");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fnMatch = disposition.match(/filename="?([^"]+)"?/);
      const fileName = fnMatch ? fnMatch[1] : "Month_End.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setToast("Month-End report downloaded" + spSaveSuffix(res));
      setTimeout(() => setToast(""), 5000);
    } catch {
      setMonthEndError(
        "The connection dropped before the report finished. If it keeps happening, untick the big detail sheets and try again.",
      );
    }
    setDownloadingMonthEnd(false);
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
            <SearchSelect
              value={clientId}
              onChange={setClientId}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              allLabel="Select a client"
              searchLabel="clients"
              widthClass="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Main Channel
            </label>
            <SearchSelect
              value={mainChannelId}
              onChange={setMainChannelId}
              disabled={!clientId}
              options={clientMainChannels.map((ch) => ({ value: ch.id, label: ch.name }))}
              allLabel="Select a main channel"
              searchLabel="channels"
              widthClass="w-full"
            />
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

      {/* Data-coverage warning — surfaces the moment a client is selected */}
      {clientId && ledgers.length > 0 && coverage.hasGaps && (
        <DataGapWarning coverage={coverage} clientName={selectedClient?.name ?? "this client"} />
      )}

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

      {/* Month-End Report Card */}
      <div className="mt-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Month-End Report
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Sales summary (Sub-Channel, Province, Category, Store, Product),
              OOS summary, and OOS detail.
            </p>
          </div>
          <button
            onClick={downloadMonthEnd}
            disabled={
              downloadingMonthEnd ||
              !clientId ||
              effectiveChannelIds.length === 0 ||
              !hasLedger ||
              selectedSheets.length === 0
            }
            className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            {downloadingMonthEnd ? "Generating..." : "Download Excel"}
          </button>
        </div>

        {/* A failed report stays put until it is dismissed — see downloadMonthEnd. */}
        {monthEndError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-red-800">
                  The Month-End report did not generate
                </p>
                <p className="mt-1 text-sm leading-relaxed text-red-800">{monthEndError}</p>
              </div>
              <button
                onClick={() => setMonthEndError("")}
                className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-800 hover:bg-red-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Sheets to include */}
        {clientId && mainChannelId && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Sheets to include
            </label>
            {/* Was a native <details>, which only closes by clicking its own
                summary again — tick a sheet and you were stuck with the panel
                open. Now dismissable by click-away, Escape, Tab or Done. */}
            <MultiSelect
              label="Sheets"
              widthClass="w-56"
              searchable={false}
              options={REPORT_SHEETS.map((s) => ({ value: s.key, label: s.label }))}
              selected={selectedSheets}
              onChange={setSelectedSheets}
              summary={
                selectedSheets.length === REPORT_SHEETS.length
                  ? "All sheets"
                  : `${selectedSheets.length} of ${REPORT_SHEETS.length} sheets`
              }
            />
          </div>
        )}

        {/* Period selectors — Month-End */}
        {clientId && mainChannelId && (
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Year
              </label>
              <select
                value={meYear}
                onChange={(e) => setMeYear(e.target.value ? Number(e.target.value) : "")}
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
                value={meMonth}
                onChange={(e) => setMeMonth(e.target.value ? Number(e.target.value) : "")}
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
                value={meWeek}
                onChange={(e) => setMeWeek(e.target.value ? Number(e.target.value) : "")}
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

        {/* Dimension filters — Sub-Channel + Category (empty = all) */}
        {clientId && mainChannelId && (dimSubChannels.length > 0 || dimCategories.length > 0) && (
          <div className="mb-4 space-y-3 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-[var(--color-text-muted)]">
              Filters — scope every sheet (leave empty for all)
            </p>
            {dimSubChannels.length > 0 && (
              <FilterChips
                title="Sub-Channel"
                options={dimSubChannels}
                selected={meSubChannels}
                onToggle={(v) =>
                  setMeSubChannels((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
                }
                onClear={() => setMeSubChannels([])}
              />
            )}
            {dimCategories.length > 0 && (
              <FilterChips
                title="Category"
                options={dimCategories}
                selected={meCategories}
                onToggle={(v) =>
                  setMeCategories((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
                }
                onClear={() => setMeCategories([])}
              />
            )}
          </div>
        )}

        {/* Phantom-stock thresholds */}
        {clientId && mainChannelId && (
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3">
            <p className="col-span-2 text-xs font-semibold text-[var(--color-text-muted)]">
              Phantom Stock — flag SOH &gt; 0 with no recent sale / receipt
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Last sale older than
              </label>
              <select
                value={phLastSold}
                onChange={(e) => setPhLastSold(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6].map((m) => (
                  <option key={m} value={m}>{m} month{m > 1 ? "s" : ""} ago</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Last received older than
              </label>
              <select
                value={phLastReceived}
                onChange={(e) => setPhLastReceived(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6].map((m) => (
                  <option key={m} value={m}>{m} month{m > 1 ? "s" : ""} ago</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Numerical Distribution rolling window */}
        {clientId && mainChannelId && (
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3">
            <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
              Numerical Distribution — rolling window
            </label>
            <select
              value={ndMonths}
              onChange={(e) => setNdMonths(Number(e.target.value))}
              className="w-56 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>Most recent {m} month{m > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
        )}

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
          <RequirementBadge label="PMF" met={hasPmf} detail={hasPmf ? "Uploaded" : "Not uploaded"} />
          <RequirementBadge label="LINKS" met={hasLinks} detail={hasLinks ? "Uploaded" : "Not uploaded"} />
          <RequirementBadge label="Store Files" met={true} detail="Optional" />
        </div>
      </div>
    </div>
  );
}

function MonthList({ months, max = 14 }: { months: string[]; max?: number }) {
  const shown = months.slice(0, max);
  const extra = months.length - shown.length;
  return (
    <span>
      {shown.map((m, i) => (
        <span key={m}>
          {i > 0 ? ", " : ""}
          <span className="rounded bg-amber-100 px-1 font-medium text-amber-900">{formatMonth(m)}</span>
        </span>
      ))}
      {extra > 0 && <span className="text-amber-700"> +{extra} more</span>}
    </span>
  );
}

function DataGapWarning({ coverage, clientName }: { coverage: CoverageResult; clientName: string }) {
  const { lyComparisonGaps, currentYtdGaps, interiorGaps, hasPriorYearData, priorYear, firstMonth, lastMonth } = coverage;
  // Interior holes not already called out in the YTD windows (avoid repetition).
  const windowSet = new Set([...lyComparisonGaps, ...currentYtdGaps]);
  const otherGaps = interiorGaps.filter((m) => !windowSet.has(m));

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>⚠️</span>
        <div className="text-sm text-amber-900">
          <p className="font-semibold">
            Data gaps detected for {clientName} — growth figures may be overstated
          </p>

          {!hasPriorYearData ? (
            <p className="mt-1 text-amber-800">
              No prior-year ({priorYear}) data is loaded, so year-on-year growth isn&apos;t measured against a
              real base. Treat any YoY / YTD-vs-last-year growth on the reports below as unreliable.
            </p>
          ) : lyComparisonGaps.length > 0 ? (
            <p className="mt-1 text-amber-800">
              Prior-year ({priorYear}) months missing from the comparison base:{" "}
              <MonthList months={lyComparisonGaps} />. Year-on-year growth (YTD and same-month-last-year) will
              read <span className="font-semibold">too high</span> — it&apos;s measured against an incomplete{" "}
              {priorYear} base, and a smaller base inflates the growth&nbsp;%.
            </p>
          ) : null}

          {currentYtdGaps.length > 0 && (
            <p className="mt-1 text-amber-800">
              Current-year months missing (understates the current base): <MonthList months={currentYtdGaps} />.
            </p>
          )}

          {otherGaps.length > 0 && (
            <p className="mt-1 text-amber-800">
              Other gaps in the monthly series: <MonthList months={otherGaps} />.
            </p>
          )}

          {firstMonth && lastMonth && (
            <p className="mt-2 text-xs text-amber-700">
              Data present from {formatMonth(firstMonth)} to {formatMonth(lastMonth)}. To fill a gap, re-upload the
              DISPO that carries that month (each DISPO includes several trailing months plus the same month a year prior).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChips({
  title,
  options,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-xs font-medium text-[var(--color-text)]">{title}</label>
        <span className="text-xs text-[var(--color-text-muted)]">
          {selected.length === 0 ? "All" : `${selected.length} selected`}
        </span>
        {selected.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-[var(--color-primary)] hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-zinc-50"
              }`}
            >
              {opt}
            </button>
          );
        })}
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
