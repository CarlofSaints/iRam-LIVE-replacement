"use client";

import { useEffect, useState } from "react";
import { authFetch, useAuth } from "@/lib/useAuth";
import type { Client, Channel, SalesLedgerMeta } from "@/lib/types";
import type { ReportConfig } from "@/lib/reportConfig";

export default function ReportsPage() {
  const { user } = useAuth();
  const isAdmin =
    user?.role === "super_admin" || user?.role === "admin";

  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [clientId, setClientId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [ledgers, setLedgers] = useState<SalesLedgerMeta[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState("");

  // Report settings (admin only)
  const [showSettings, setShowSettings] = useState(false);
  const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null);
  const [oosThreshold, setOosThreshold] = useState(2);
  const [alertThreshold, setAlertThreshold] = useState(300);
  const [spUrl, setSpUrl] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);

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

  // When client changes, load ledgers + report config
  useEffect(() => {
    if (!clientId) {
      setLedgers([]);
      setSelectedClient(null);
      setReportConfig(null);
      return;
    }
    const client = clients.find((c) => c.id === clientId) ?? null;
    setSelectedClient(client);
    setChannelId("");

    (async () => {
      const res = await authFetch(`/api/sales?clientId=${clientId}`);
      if (res.ok) setLedgers(await res.json());
      else setLedgers([]);

      // Load report config
      const cfgRes = await authFetch(
        `/api/reports/config?clientId=${clientId}`
      );
      if (cfgRes.ok) {
        const cfg: ReportConfig = await cfgRes.json();
        setReportConfig(cfg);
        setOosThreshold(cfg.dscBrackets.oosThreshold);
        setAlertThreshold(cfg.dscBrackets.alertThreshold);
        setSpUrl(cfg.spUrls?.vital_signs ?? "");
      }
    })();
  }, [clientId, clients]);

  // Client's main channels
  const clientChannels = selectedClient
    ? channels.filter((ch) => selectedClient.channelIds.includes(ch.id))
    : [];

  // Data requirement checks
  const hasLedger = channelId
    ? ledgers.some((l) => l.channelId === channelId && l.totalRows > 0)
    : false;
  const hasPmf = !!selectedClient?.controlFiles?.pmf;
  const hasLinks = !!selectedClient?.controlFiles?.links;

  const ledgerMeta = channelId
    ? ledgers.find((l) => l.channelId === channelId)
    : null;

  async function downloadVitalSigns() {
    if (!clientId || !channelId) return;
    setDownloading(true);
    try {
      const res = await authFetch(
        `/api/reports/vital-signs?clientId=${clientId}&channelId=${channelId}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
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

  async function saveSettings() {
    if (!clientId) return;
    setSettingsSaving(true);
    const config: ReportConfig = {
      dscBrackets: { oosThreshold, alertThreshold },
      otoMultipliers: reportConfig?.otoMultipliers ?? {},
      spUrls: { ...(reportConfig?.spUrls ?? {}), vital_signs: spUrl },
    };
    const res = await authFetch("/api/reports/config", {
      method: "PUT",
      body: JSON.stringify({ clientId, config }),
    });
    if (res.ok) {
      setReportConfig(config);
      setToast("Settings saved");
    } else {
      setToast("Failed to save settings");
    }
    setTimeout(() => setToast(""), 3000);
    setSettingsSaving(false);
  }

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

      {/* Client + Channel selectors */}
      <div className="mb-6 grid grid-cols-2 gap-4">
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
            Channel
          </label>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={!clientId}
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">Select a channel</option>
            {clientChannels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </div>
      </div>

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
            disabled={downloading || !clientId || !channelId || !hasLedger}
            className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            {downloading ? "Generating..." : "Download Excel"}
          </button>
        </div>

        {/* Data requirements */}
        <div className="flex flex-wrap gap-2">
          <RequirementBadge
            label="Sales Ledger"
            met={hasLedger}
            detail={
              ledgerMeta
                ? `${ledgerMeta.totalRows} rows`
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
        {clientId && !channelId && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Select a channel to continue.
          </p>
        )}
      </div>

      {/* Report Settings (admin only) */}
      {isAdmin && clientId && (
        <div className="mt-6">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${showSettings ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Report Settings
          </button>

          {showSettings && (
            <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-white p-6">
              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                  DSC Brackets
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                      OOS Threshold (below = &quot;Out of Stock&quot;)
                    </label>
                    <input
                      type="number"
                      value={oosThreshold}
                      onChange={(e) =>
                        setOosThreshold(Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                      Alert Threshold (at/above = &quot;ALERT&quot;)
                    </label>
                    <input
                      type="number"
                      value={alertThreshold}
                      onChange={(e) =>
                        setAlertThreshold(Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
                  SharePoint Upload URLs
                </h3>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                    Vital Signs SP Folder URL
                  </label>
                  <input
                    type="text"
                    value={spUrl}
                    onChange={(e) => setSpUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <button
                onClick={saveSettings}
                disabled={settingsSaving}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
              >
                {settingsSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          )}
        </div>
      )}
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
        met
          ? "bg-green-50 text-green-700"
          : "bg-amber-50 text-amber-700"
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
