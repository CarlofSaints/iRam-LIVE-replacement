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
  cells: Record<string, Cell>;
}
interface PeriodSummary { loaded: number; excluded: number; outstanding: number; armed: boolean; armable: boolean }
interface ChecklistData {
  periods: Period[];
  rows: ChecklistRow[];
  perPeriod: Record<string, PeriodSummary>;
  activePeriodKey: string | null;
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
    return data.rows.map((r, i) => ({
      row: r,
      firstOfClient: i === 0 || data.rows[i - 1].clientId !== r.clientId,
    }));
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
        Which DISPOs are loaded for each client, by vendor, across the most recent 8 weeks. Ticks fill in automatically
        as loads come in. {canManage && "Click an outstanding cell to mark “send without this vendor” for that week, then Arm the week to open store-report sending."}
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

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {toast && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}

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
              {rowsWithGroup.map(({ row, firstOfClient }) => (
                <tr key={`${row.clientId}|${row.channelId}|${row.vendorNumber}`}
                  className={firstOfClient ? "border-t-2 border-[var(--color-border)]" : "border-t border-zinc-100"}>
                  <td className="sticky left-0 z-10 px-4 py-2.5" style={{ background: "white" }}>
                    <div className={`font-medium ${row.active ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                      {firstOfClient ? row.clientName : <span className="text-[var(--color-text-muted)]">↳</span>}
                      {!row.active && firstOfClient && <span className="ml-2 text-xs text-[var(--color-text-muted)]">(inactive)</span>}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {row.placeholder
                        ? "No DISPO loads yet"
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
              ))}
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
        </div>
      )}
    </div>
  );
}
