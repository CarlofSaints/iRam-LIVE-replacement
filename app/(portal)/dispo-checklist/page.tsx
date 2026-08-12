"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch, usePermissions } from "@/lib/useAuth";

interface Period { year: number; month: number; week: number; key: string; label: string }
type CellState = "loaded" | "excluded" | "outstanding" | "na";
interface Cell { state: CellState; date?: string; count?: number }
interface ChecklistRow {
  clientId: string;
  clientName: string;
  active: boolean;
  channelId: string;
  channelName: string;
  vendorNumber: string;
  streamId: string;
  placeholder: boolean;
  neverLoaded?: boolean;
  cells: Record<string, Cell>;
}
interface PeriodSummary { loaded: number; excluded: number; outstanding: number; armed: boolean; armable: boolean }
interface ChecklistData {
  periods: Period[];
  rows: ChecklistRow[];
  perPeriod: Record<string, PeriodSummary>;
  activePeriodKey: string | null;
}

// Weekday 16:00 status email — keyed on the newest STAMPED period, the same
// basis as the grid above, so the two always agree.
interface LoadStatus {
  windowLabel: string;
  asAtLabel: string;
  periodLabel: string | null;
  clientCount: number;
  vendorCount: number;
  loadedVendors: number;
  outstandingVendors: number;
  excludedVendors: number;
  loadsThisWeek: number;
  currentPeriodLoads: number;
  historicalLoads: number;
  recipients: string[];
  emailed?: number;
  failures?: { email: string; error: string }[];
  subject?: string;
  html?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function DispoChecklistPage() {
  const { can } = usePermissions();
  const canManage = can("manage_store_reports");

  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  // Status-email panel
  const [status, setStatus] = useState<LoadStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [preview, setPreview] = useState<LoadStatus | null>(null);

  async function loadStatus(): Promise<LoadStatus | null> {
    setStatusBusy(true);
    setStatusError("");
    try {
      const res = await authFetch("/api/load-status?preview=html");
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setStatus(d); return d as LoadStatus; }
      setStatusError(d.error || "Failed to compute load status");
    } catch {
      setStatusError("Network error");
    } finally {
      setStatusBusy(false);
    }
    return null;
  }

  async function sendStatus() {
    if (!confirm("Send the DISPO load status email now to everyone flagged to receive it?")) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      const res = await authFetch("/api/load-status", { method: "POST", body: JSON.stringify({}) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus(d);
        const failed = d.failures?.length ?? 0;
        setToast(failed > 0
          ? `Sent to ${d.emailed} of ${d.recipients.length} — ${failed} failed`
          : `Status email sent to ${d.emailed} recipient${d.emailed === 1 ? "" : "s"}`);
        setTimeout(() => setToast(""), 4000);
        if (failed > 0) setStatusError(d.failures.map((f: { email: string; error: string }) => `${f.email}: ${f.error}`).join(" · "));
      } else {
        setStatusError(d.error || "Send failed");
      }
    } catch {
      setStatusError("Network error");
    }
    setStatusBusy(false);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/dispo-checklist");
      if (res.ok) setData(await res.json());
      else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to load checklist");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function mutate(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/store-reports", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast(okMsg);
        setTimeout(() => setToast(""), 3000);
        await load();
      } else {
        setError(d.error || "Action failed");
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  const toggleExclude = (row: ChecklistRow, p: Period, exclude: boolean) =>
    mutate(
      { action: "exclude", year: p.year, month: p.month, week: p.week, streamId: row.streamId, excluded: exclude },
      exclude ? "Stream excluded for this week" : "Stream re-included",
    );

  const arm = (p: Period) =>
    mutate({ action: "arm", year: p.year, month: p.month, week: p.week }, `Armed ${p.label}`);
  const disarm = (p: Period) =>
    mutate({ action: "disarm", year: p.year, month: p.month, week: p.week }, `Disarmed ${p.label}`);

  const rowsWithGroup = useMemo(() => {
    if (!data) return [];
    let clientIndex = -1;
    return data.rows.map((r, i) => {
      const firstOfClient = i === 0 || data.rows[i - 1].clientId !== r.clientId;
      if (firstOfClient) clientIndex++;
      const lastOfClient = i === data.rows.length - 1 || data.rows[i + 1].clientId !== r.clientId;
      return { row: r, firstOfClient, lastOfClient, clientIndex };
    });
  }, [data]);

  // How many declared vendors per client have never been loaded (for a header alert).
  const missingByClient = useMemo(() => {
    const m: Record<string, number> = {};
    if (data) for (const r of data.rows) if (r.neverLoaded) m[r.clientId] = (m[r.clientId] ?? 0) + 1;
    return m;
  }, [data]);

  const activeLabel = useMemo(() => {
    if (!data?.activePeriodKey) return null;
    return data.periods.find((p) => p.key === data.activePeriodKey)?.label ?? data.activePeriodKey;
  }, [data]);

  return (
    <div className="p-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">DISPO Load Checklist</h1>
        <button onClick={load} disabled={loading || busy}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Which DISPOs are loaded for each client, by vendor, across the most recent 8 weeks. <strong>Every vendor number on a
        client is listed</strong> — a vendor that has never had a DISPO loaded is flagged in red, so a missing one can&apos;t
        slip by. Ticks fill in automatically as loads come in. {canManage && "Click an outstanding cell to mark “send without this vendor” for that week, then Arm the week to open store-report sending."}
      </p>

      {/* Armed banner */}
      {data && (
        <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${
          activeLabel ? "border-green-300 bg-green-50 text-green-800" : "border-zinc-200 bg-zinc-50 text-[var(--color-text-muted)]"}`}>
          {activeLabel
            ? <><strong>Store reports ARMED</strong> for <strong>{activeLabel}</strong> — Perigee check-ins will send store reports for that week.</>
            : <>No week is armed — store-report check-ins are currently ignored.</>}
        </div>
      )}

      {/* Weekday 16:00 status email */}
      <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Load status email</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Goes out automatically <strong>every weekday at 16:00</strong> to each user ticked
              &ldquo;Receive DISPO load status&rdquo; in Control Centre &rarr; Users. It reports on the
              <strong> newest period stamped on a DISPO</strong> &mdash; the week opens as soon as its
              first DISPO is loaded &mdash; so it matches the last column of the grid below. A vendor
              only counts as loaded once every channel it normally loads on has come in, and a
              back-load for an earlier period does not count.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" disabled={statusBusy}
              onClick={async () => { const s = await loadStatus(); if (s) setPreview(s); }}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
              {statusBusy && !preview ? "Checking…" : "Preview"}
            </button>
            {canManage && (
              <button type="button" disabled={statusBusy} onClick={sendStatus}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
                Send now
              </button>
            )}
          </div>
        </div>

        {status && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
            <span><strong className="text-[var(--color-text)]">{status.periodLabel ?? "No period stamped yet"}</strong></span>
            <span>{status.clientCount} clients · {status.vendorCount} vendors</span>
            <span className="text-green-700">{status.loadedVendors} loaded</span>
            <span className={status.outstandingVendors > 0 ? "font-semibold text-red-600" : "text-zinc-400"}>
              {status.outstandingVendors} outstanding
            </span>
            {status.excludedVendors > 0 && <span className="text-amber-600">{status.excludedVendors} skipped</span>}
            <span>
              {status.loadsThisWeek} file(s) since Monday
              {status.historicalLoads > 0 && ` · ${status.historicalLoads} back-load(s)`}
            </span>
            <span>
              {status.recipients.length > 0
                ? `Recipients: ${status.recipients.join(", ")}`
                : "⚠ No recipients — tick a user in Control Centre → Users"}
            </span>
          </div>
        )}
        {statusError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{statusError}</div>}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {toast && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}

      {/* Preview of the actual email body */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[var(--color-border)] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Email preview</h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Subject: {preview.subject || "—"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Greeting uses each recipient&apos;s own first name — this preview shows yours.
                </p>
              </div>
              <button onClick={() => setPreview(null)} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Close
              </button>
            </div>
            <div className="overflow-y-auto bg-zinc-50 p-4">
              <iframe title="Load status email preview" sandbox="" srcDoc={preview.html || ""}
                className="h-[60vh] w-full rounded-lg border border-[var(--color-border)] bg-white" />
            </div>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : data && data.periods.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-text-muted)]">
          No DISPO loads stamped with a week yet. Once DISPOs are loaded (with a week selected), they&apos;ll appear here.
        </div>
      ) : data ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="sticky left-0 z-10 px-4 py-3 text-left font-semibold text-[var(--color-text)]" style={{ background: "white" }}>
                  Client / Vendor
                </th>
                {data.periods.map((p) => {
                  const armed = data.perPeriod[p.key]?.armed;
                  return (
                    <th key={p.key} className={`min-w-[92px] px-3 py-3 text-center font-semibold ${armed ? "bg-green-50 text-green-800" : "text-[var(--color-text)]"}`}>
                      <div>{`Wk${p.week}`}</div>
                      <div className="text-xs font-normal text-[var(--color-text-muted)]">{p.label.replace(`Wk${p.week} `, "")}</div>
                      {armed && <div className="text-[10px] font-bold uppercase text-green-700">Armed</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowsWithGroup.map(({ row, firstOfClient, lastOfClient, clientIndex }) => {
                const zebra = clientIndex % 2 === 1;
                const rowBg = row.neverLoaded ? "bg-red-50/40" : zebra ? "bg-zinc-50" : "bg-white";
                const stickyBg = row.neverLoaded ? "#fef4f4" : zebra ? "#fafafa" : "white";
                return (
                <tr key={`${row.clientId}|${row.channelId}|${row.vendorNumber}`}
                  className={`${firstOfClient ? "border-t-2 border-zinc-300" : "border-t border-zinc-100"} ${lastOfClient ? "border-b border-zinc-200" : ""} ${rowBg}`}>
                  <td className="sticky left-0 z-10 border-l-4 px-4 py-2.5"
                    style={{ background: stickyBg, borderLeftColor: zebra ? "#cbd5e1" : "#e2e8f0" }}>
                    <div className={`font-medium ${row.active ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                      {firstOfClient
                        ? <span className="font-bold">{row.clientName}</span>
                        : <span className="text-xs font-normal text-[var(--color-text-muted)]">↳ {row.clientName}</span>}
                      {!row.active && firstOfClient && <span className="ml-2 text-xs text-[var(--color-text-muted)]">(inactive)</span>}
                      {firstOfClient && missingByClient[row.clientId] > 0 && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                          {missingByClient[row.clientId]} not loaded
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {row.placeholder
                        ? "No vendors configured"
                        : row.neverLoaded
                          ? <><span className="font-semibold text-red-600">Vendor {row.vendorNumber}</span>{" · "}<span className="text-red-500">never loaded — no DISPO yet</span></>
                          : <><span className="text-[var(--color-text)]">{row.channelName || "—"}</span>{" · "}{row.vendorNumber ? `Vendor ${row.vendorNumber}` : "No vendor #"}</>}
                    </div>
                  </td>
                  {data.periods.map((p) => {
                    const cell = row.cells[p.key];
                    const st = cell?.state ?? "na";
                    return (
                      <td key={p.key} className="px-3 py-2.5 text-center align-middle">
                        {st === "loaded" && (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600" title={`Loaded${cell?.count && cell.count > 1 ? ` (${cell.count} loads)` : ""}`}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(cell?.date)}</span>
                          </div>
                        )}
                        {st === "excluded" && (
                          <button type="button" disabled={!canManage || busy}
                            onClick={() => toggleExclude(row, p, false)}
                            title={canManage ? "Excluded this week — click to re-include" : "Excluded this week"}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 disabled:cursor-default">
                            ⤬ Skip
                          </button>
                        )}
                        {st === "outstanding" && (
                          canManage ? (
                            <button type="button" disabled={busy}
                              onClick={() => toggleExclude(row, p, true)}
                              title="Outstanding — click to exclude (send without this vendor this week)"
                              className="inline-block h-6 w-6 rounded-full border border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50" />
                          ) : (
                            <span className="inline-block h-6 w-6 rounded-full border border-dashed border-zinc-300" title="Outstanding" />
                          )
                        )}
                        {st === "na" && <span className="text-zinc-300">·</span>}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
            {/* Arm controls per period */}
            <tfoot>
              <tr className="border-t-2 border-[var(--color-border)] bg-zinc-50">
                <td className="sticky left-0 z-10 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]" style={{ background: "#fafafa" }}>
                  Arm week
                </td>
                {data.periods.map((p) => {
                  const s = data.perPeriod[p.key];
                  if (!s) return <td key={p.key} />;
                  return (
                    <td key={p.key} className="px-2 py-3 text-center align-top">
                      <div className="mb-1.5 flex items-center justify-center gap-1.5 text-[11px]">
                        <span className="text-green-600" title="Loaded">✓{s.loaded}</span>
                        <span className="text-amber-600" title="Excluded">⤬{s.excluded}</span>
                        <span className={s.outstanding > 0 ? "text-zinc-500" : "text-zinc-300"} title="Outstanding">⬜{s.outstanding}</span>
                      </div>
                      {canManage ? (
                        s.armed ? (
                          <button type="button" disabled={busy} onClick={() => disarm(p)}
                            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            Disarm
                          </button>
                        ) : (
                          <button type="button" disabled={busy || !s.armable} onClick={() => arm(p)}
                            title={s.armable ? "Arm this week for store-report sending" : s.outstanding > 0 ? `${s.outstanding} stream(s) still outstanding — load or exclude them first` : "No DISPOs loaded for this week"}
                            className="rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-40">
                            Arm
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-[var(--color-text-muted)]">{s.armed ? "Armed" : "—"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            Loaded
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">⤬ Skip</span>
            Excluded this week (send without this vendor)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-5 w-5 rounded-full border border-dashed border-zinc-300" />
            Outstanding
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">N not loaded</span>
            Vendor(s) never loaded — listed in red
          </span>
        </div>
      )}
    </div>
  );
}
