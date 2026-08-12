"use client";

import { useEffect, useState } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { authFetch } from "@/lib/useAuth";
import type { Client, Channel, StoreRecord } from "@/lib/types";

interface DashboardClientRow {
  clientId: string;
  clientName: string;
  skuCount: number;
  ytdUnits: number;
  ytdValue: number;
  contributionPct: number;
  dispoCount: number;
  agedStockCount: number;
  vitalSignsRuns: number;
  monthEndRuns: number;
  hasDataGaps: boolean;
  dataGapLines: string[];
}

interface DashboardData {
  clients: Client[];
  channels: Channel[];
  stores: StoreRecord[];
  clientRows: DashboardClientRow[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [clientsRes, channelsRes, storesRes, gridRes] = await Promise.all([
          authFetch("/api/clients"),
          authFetch("/api/channels"),
          authFetch("/api/store-files/merged"),
          authFetch("/api/dashboard/clients"),
        ]);

        const clients = clientsRes.ok ? ((await clientsRes.json()) as Client[]) : [];
        const channels = channelsRes.ok ? ((await channelsRes.json()) as Channel[]) : [];
        const stores = storesRes.ok ? ((await storesRes.json()) as StoreRecord[]) : [];
        const gridJson = gridRes.ok
          ? ((await gridRes.json()) as { clients: DashboardClientRow[] })
          : { clients: [] };

        setData({ clients, channels, stores, clientRows: gridJson.clients });
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Declared above the loading early-return: a hook may not sit after a
  // conditional return, so it reads from `data` rather than `d` below.
  const gridTools = useTableTools<DashboardClientRow>(
    data?.clientRows ?? [],
    {
      clientName: (r) => r.clientName,
      skuCount: (r) => r.skuCount,
      ytdUnits: (r) => r.ytdUnits,
      ytdValue: (r) => r.ytdValue,
      contributionPct: (r) => r.contributionPct,
      dispoCount: (r) => r.dispoCount,
      agedStockCount: (r) => r.agedStockCount,
      vitalSignsRuns: (r) => r.vitalSignsRuns,
      monthEndRuns: (r) => r.monthEndRuns,
    },
    "ytdValue",
    (r) => r.clientName,
    "desc", // biggest clients first, as the grid has always opened
  );

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-sm text-[var(--color-text-muted)]">
          Loading dashboard...
        </div>
      </div>
    );
  }

  const d = data ?? { clients: [], channels: [], stores: [], clientRows: [] };
  const subChannels = d.channels.filter((c) => c.parentId);

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Dashboard
      </h1>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={d.clients.length} color="primary" />
        <StatCard label="Sub-Channels" value={subChannels.length} color="secondary" />
        <StatCard label="Stores" value={d.stores.length} color="accent" />
        <StatCard label="Active Clients" value={d.clients.filter((c) => c.active).length} color="primary" />
      </div>

      {/* Client grid */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Clients
          </h2>
          <TableSearch value={gridTools.query} onChange={gridTools.setQuery}
            count={gridTools.rows.length} total={gridTools.total} placeholder="Search clients…" />
        </div>
        {d.clientRows.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            No clients yet. Create a client to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <SortableTh label="Client" sortKey="clientName" className="px-4"
                    current={gridTools.sortKey} dir={gridTools.sortDir} onSort={gridTools.toggleSort} />
                  {[
                    ["SKUs", "skuCount"], ["YTD Units", "ytdUnits"], ["YTD Value", "ytdValue"],
                    ["Contribution", "contributionPct"], ["DISPOs", "dispoCount"],
                    ["Aged Stock", "agedStockCount"], ["Vital Signs", "vitalSignsRuns"],
                    ["Month-End", "monthEndRuns"],
                  ].map(([label, key]) => (
                    <SortableTh key={key} label={label} sortKey={key} className="px-4" align="right"
                      current={gridTools.sortKey} dir={gridTools.sortDir} onSort={gridTools.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridTools.rows.map((r) => (
                  <tr
                    key={r.clientId}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                      <span className="inline-flex items-center gap-1.5">
                        {r.clientName}
                        {r.hasDataGaps && (
                          <span
                            title={`Data gaps — growth may be overstated:\n\n${r.dataGapLines.join("\n\n")}`}
                            className="inline-flex cursor-help items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-300"
                          >
                            ⚠️ Gaps
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.skuCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.ytdUnits.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {formatRand(r.ytdValue)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--color-text)]">
                      {r.contributionPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.dispoCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.agedStockCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.vitalSignsRuns.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                      {r.monthEndRuns.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRand(value: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "primary" | "secondary" | "accent";
}) {
  const colorMap = {
    primary: "text-[var(--color-primary)]",
    secondary: "text-[var(--color-secondary)]",
    accent: "text-[var(--color-accent)]",
  };
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white px-6 py-5">
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold ${colorMap[color]}`}>
        {value}
      </div>
    </div>
  );
}
