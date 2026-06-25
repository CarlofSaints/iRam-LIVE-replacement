"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/useAuth";

interface Period { year: number; month: number; week: number; key: string; label: string }
interface Cell { loaded: boolean; date?: string; count?: number }
interface ChecklistRow {
  clientId: string;
  clientName: string;
  active: boolean;
  vendorNumber: string;
  cells: Record<string, Cell>;
}
interface ChecklistData {
  periods: Period[];
  rows: ChecklistRow[];
  outstanding: Record<string, number>;
  totalRows: number;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function DispoChecklistPage() {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/dispo-checklist");
      if (res.ok) {
        setData(await res.json());
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to load checklist");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Mark the first row of each client so we can draw a divider between clients.
  const rowsWithGroup = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({
      row: r,
      firstOfClient: i === 0 || data.rows[i - 1].clientId !== r.clientId,
    }));
  }, [data]);

  return (
    <div className="p-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">DISPO Load Checklist</h1>
        <button onClick={load} disabled={loading}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Which DISPOs have been loaded for each client, by vendor number, across the most recent 8 weeks.
        Ticks fill in automatically as loads come in — no manual ticking. A column appears once the first
        load for that week arrives.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
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
                <th className="sticky left-0 z-10 bg-[var(--color-bg,white)] px-4 py-3 text-left font-semibold text-[var(--color-text)]"
                  style={{ background: "white" }}>
                  Client / Vendor
                </th>
                {data.periods.map((p) => (
                  <th key={p.key} className="min-w-[88px] px-3 py-3 text-center font-semibold text-[var(--color-text)]">
                    <div>{`Wk${p.week}`}</div>
                    <div className="text-xs font-normal text-[var(--color-text-muted)]">
                      {p.label.replace(`Wk${p.week} `, "")}
                    </div>
                  </th>
                ))}
              </tr>
              {/* Outstanding summary strip */}
              <tr className="border-b border-[var(--color-border)] bg-zinc-50">
                <th className="sticky left-0 z-10 px-4 py-1.5 text-left text-xs font-medium text-[var(--color-text-muted)]"
                  style={{ background: "#fafafa" }}>
                  Outstanding
                </th>
                {data.periods.map((p) => {
                  const n = data.outstanding[p.key] ?? 0;
                  return (
                    <td key={p.key} className="px-3 py-1.5 text-center text-xs">
                      <span className={n === 0 ? "font-medium text-green-600" : "font-medium text-amber-600"}>
                        {n === 0 ? "All in" : `${n} left`}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowsWithGroup.map(({ row, firstOfClient }) => (
                <tr key={`${row.clientId}|${row.vendorNumber}`}
                  className={`${firstOfClient ? "border-t-2 border-[var(--color-border)]" : "border-t border-zinc-100"}`}>
                  <td className="sticky left-0 z-10 px-4 py-2.5" style={{ background: "white" }}>
                    <div className={`font-medium ${row.active ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                      {firstOfClient ? row.clientName : <span className="text-[var(--color-text-muted)]">↳</span>}
                      {!row.active && firstOfClient && <span className="ml-2 text-xs text-[var(--color-text-muted)]">(inactive)</span>}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {row.vendorNumber ? `Vendor ${row.vendorNumber}` : "No vendor #"}
                    </div>
                  </td>
                  {data.periods.map((p) => {
                    const cell = row.cells[p.key];
                    return (
                      <td key={p.key} className="px-3 py-2.5 text-center align-middle">
                        {cell?.loaded ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600" title={`Loaded${cell.count && cell.count > 1 ? ` (${cell.count} loads)` : ""}`}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(cell.date)}</span>
                          </div>
                        ) : (
                          <span className="inline-block h-6 w-6 rounded-full border border-dashed border-zinc-300" title="Outstanding" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            Loaded (date = when it was loaded)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-5 w-5 rounded-full border border-dashed border-zinc-300" />
            Outstanding
          </span>
          <span>{data.totalRows} client/vendor rows</span>
        </div>
      )}
    </div>
  );
}
