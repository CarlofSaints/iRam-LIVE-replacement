"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import type { Client, Channel } from "@/lib/types";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, LabelList,
} from "recharts";

interface DimSeries { months: string[]; series: { name: string; values: number[] }[]; }
interface ChartsResponse {
  cards: {
    unitSalesMonth: number; unitSalesYtd: number;
    valueSalesMonth: number; valueSalesYtd: number;
    growthYtdPct: number | null; growthSameMonthLyPct: number | null;
  };
  opportunity: { oto: number; nd: number; oos: number; phantom: number; total: number };
  risk: { marginSupport: number };
  cyLabel: string; pyLabel: string;
  monthlyBars: { month: string; cyValue: number; pyValue: number; cyVolume: number; pyVolume: number }[];
  subChannelSeries: DimSeries;
  categorySeries: DimSeries;
  meta: { clientName: string; channelLabel: string; periodLabel: string; rowCount: number };
}

const LINE_COLORS = ["#1F4E79", "#2E75B6", "#C00000", "#548235", "#BF9000", "#7030A0", "#0070C0", "#843C0C", "#385723", "#D6604D"];
const TOP_SERIES = 10;

function rand(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `R ${(v / 1_000_000).toFixed(2)}m`;
  if (a >= 1_000) return `R ${(v / 1_000).toFixed(1)}k`;
  return `R ${v.toFixed(0)}`;
}
function randFull(v: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(v);
}
function num(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}m`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString();
}
function pct(v: number | null): string {
  return v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function ChartsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [clientId, setClientId] = useState("");
  const [mainChannelId, setMainChannelId] = useState("");
  const [data, setData] = useState<ChartsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [cRes, chRes] = await Promise.all([authFetch("/api/clients"), authFetch("/api/channels")]);
      if (cRes.ok) {
        const all: Client[] = await cRes.json();
        const active = all.filter((c) => c.active);
        setClients(active);
        if (active.length === 1) setClientId(active[0].id); // client users see only theirs
      }
      if (chRes.ok) setChannels(await chRes.json());
    })();
  }, []);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const allSubs = channels.filter((c) => !!c.parentId);
  const clientMainChannels = selectedClient
    ? channels.filter((ch) => !ch.parentId &&
        (selectedClient.channelIds.includes(ch.id) ||
          allSubs.some((s) => s.parentId === ch.id && selectedClient.channelIds.includes(s.id))))
    : [];

  // Effective channels = the chosen main channel + all its sub-channels
  const effectiveChannelIds = useMemo(() => {
    if (!mainChannelId) return [];
    const subs = channels.filter((ch) => ch.parentId === mainChannelId).map((s) => s.id);
    return [mainChannelId, ...subs];
  }, [mainChannelId, channels]);

  // Reset main channel when client changes
  useEffect(() => { setMainChannelId(""); setData(null); }, [clientId]);

  useEffect(() => {
    if (!clientId || effectiveChannelIds.length === 0) { setData(null); return; }
    setLoading(true); setError("");
    (async () => {
      try {
        const params = new URLSearchParams({ clientId, channelIds: effectiveChannelIds.join(",") });
        const res = await authFetch(`/api/reports/charts?${params.toString()}`);
        if (res.ok) { setData(await res.json()); }
        else { const j = await res.json().catch(() => ({})); setError(j.error || "Failed to load charts"); setData(null); }
      } catch { setError("Failed to load charts"); setData(null); }
      finally { setLoading(false); }
    })();
  }, [clientId, effectiveChannelIds]);

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">Charts</h1>

      {/* Selectors */}
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="select">
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Channel">
          <select value={mainChannelId} onChange={(e) => setMainChannelId(e.target.value)} className="select" disabled={!clientId}>
            <option value="">Select a channel…</option>
            {clientMainChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
        </Field>
        {data?.meta && (
          <div className="pb-2 text-sm text-[var(--color-text-muted)]">
            {data.meta.clientName} · {data.meta.channelLabel} · {data.meta.periodLabel}
          </div>
        )}
      </div>

      {loading && <div className="text-sm text-[var(--color-text-muted)]">Loading charts…</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!loading && !error && !data && clientId && mainChannelId && (
        <div className="text-sm text-[var(--color-text-muted)]">No data.</div>
      )}
      {!clientId || !mainChannelId ? (
        !loading && <div className="text-sm text-[var(--color-text-muted)]">Select a client and channel to view charts.</div>
      ) : null}

      {data && !loading && (
        <div className="space-y-8">
          {/* Sales cards */}
          <Section title="Sales">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Unit Sales — Month" value={num(data.cards.unitSalesMonth)} />
              <Card label="Unit Sales — YTD" value={num(data.cards.unitSalesYtd)} />
              <Card label="Value Sales — Month" value={rand(data.cards.valueSalesMonth)} />
              <Card label="Value Sales — YTD" value={rand(data.cards.valueSalesYtd)} />
              <Card label="Growth YTD" value={pct(data.cards.growthYtdPct)} tone={toneOf(data.cards.growthYtdPct)} />
              <Card label="Growth vs Same Mo LY" value={pct(data.cards.growthSameMonthLyPct)} tone={toneOf(data.cards.growthSameMonthLyPct)} />
            </div>
          </Section>

          {/* Opportunity + risk cards */}
          <Section title="Opportunity & Risk">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Total OTO Available" value={rand(data.opportunity.oto)} tone="green" />
              <Card label="ND Opportunity" value={rand(data.opportunity.nd)} tone="green" />
              <Card label="OOS Opportunity" value={rand(data.opportunity.oos)} tone="green" />
              <Card label="Phantom Opportunity" value={rand(data.opportunity.phantom)} tone="green" />
              <Card label="Total Opportunity" value={rand(data.opportunity.total)} tone="green" emphasis />
              <Card label="Risk — Margin Support" value={rand(data.risk.marginSupport)} tone="red" emphasis />
            </div>
          </Section>

          {/* 1. Sub-channel line (rolling 24 months) */}
          <Section title="Sub-Channel — Value by Month (rolling 24 months)">
            <LineSeriesChart dim={data.subChannelSeries} />
          </Section>

          {/* 2. Bars — current vs previous year, value + volume */}
          <Section title={`Monthly — ${data.cyLabel} vs ${data.pyLabel}`}>
            <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
              <MonthlyBars bars={data.monthlyBars} cyLabel={data.cyLabel} pyLabel={data.pyLabel} metric="value" />
              <MonthlyBars bars={data.monthlyBars} cyLabel={data.cyLabel} pyLabel={data.pyLabel} metric="volume" />
            </div>
          </Section>

          {/* 3. Category line (rolling 24 months) */}
          <Section title="Category — Value by Month (rolling 24 months)">
            <LineSeriesChart dim={data.categorySeries} />
          </Section>
        </div>
      )}

      <style jsx>{`
        :global(.select) {
          border: 1px solid var(--color-border);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          background: white;
          min-width: 12rem;
        }
      `}</style>
    </div>
  );
}

function toneOf(v: number | null): "green" | "red" | undefined {
  if (v === null || v === undefined) return undefined;
  return v >= 0 ? "green" : "red";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {children}
    </div>
  );
}

function Card({ label, value, tone, emphasis }: { label: string; value: string; tone?: "green" | "red"; emphasis?: boolean }) {
  const toneClass = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : "text-[var(--color-text)]";
  return (
    <div className={`rounded-xl border bg-white px-4 py-4 ${emphasis ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20" : "border-[var(--color-border)]"}`}>
      <div className="text-[0.7rem] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div>
      <div className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function MonthlyBars({ bars, cyLabel, pyLabel, metric }: { bars: ChartsResponse["monthlyBars"]; cyLabel: string; pyLabel: string; metric: "value" | "volume" }) {
  const cyKey = metric === "value" ? "cyValue" : "cyVolume";
  const pyKey = metric === "value" ? "pyValue" : "pyVolume";
  const fmt = metric === "value" ? rand : num;
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">{metric === "value" ? "Value (R)" : "Volume (units)"}</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={bars} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} width={70} />
          <Tooltip formatter={(v) => (metric === "value" ? randFull(Number(v)) : Number(v).toLocaleString())} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={pyKey} name={pyLabel} fill="#9DC3E6" />
          <Bar dataKey={cyKey} name={cyLabel} fill="#1F4E79" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LineSeriesChart({ dim }: { dim: DimSeries }) {
  const top = dim.series.slice(0, TOP_SERIES);
  const rows = dim.months.map((m, i) => {
    const row: Record<string, string | number> = { month: m };
    for (const s of top) row[s.name] = s.values[i];
    return row;
  });
  if (top.length === 0) return <div className="text-sm text-[var(--color-text-muted)]">No series data.</div>;
  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={rows} margin={{ top: 20, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => rand(Number(v))} width={70} />
          <Tooltip formatter={(v) => randFull(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {top.map((s, i) => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false}>
              <LabelList dataKey={s.name} position="top" formatter={(v) => { const n = Number(v); return n ? rand(n) : ""; }} style={{ fontSize: 9, fill: LINE_COLORS[i % LINE_COLORS.length] }} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
      {dim.series.length > TOP_SERIES && (
        <div className="mt-1 text-xs text-[var(--color-text-muted)]">Showing top {TOP_SERIES} of {dim.series.length} by total value.</div>
      )}
    </div>
  );
}
