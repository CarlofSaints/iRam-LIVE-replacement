"use client";

/* Portfolio Stock Health — the Account Manager's view of one channel.
 *
 * Reads the latest STORED capture by default, not a live computation, because
 * the comparison columns are made against stored captures: a fresh number
 * beside week-old comparisons would show a delta between two readings taken on
 * different days and call it a week. "Recalculate now" is there for the moment
 * after a DISPO lands, and labels itself.
 *
 * Colour rule: every measure here is bad when it goes up, so a fall is green
 * and a rise is red — a fixed judgement, not a relative scale. A ranking scale
 * would colour the least-bad province green even in a week where every number
 * got worse.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { authFetch, usePermissions } from "@/lib/useAuth";
import type { Channel } from "@/lib/types";
import type { BreakdownRow, KpiCounts, PortfolioHealth } from "@/lib/portfolioHealth";
import type { ComparisonPoint, PortfolioSnapshot } from "@/lib/portfolioSnapshot";
import { KPI_NOTES } from "@/lib/stockFlagNotes";

interface ApiResponse {
  snapshot: PortfolioSnapshot;
  comparisons: ComparisonPoint[];
  computedLive: boolean;
  captureCount: number;
  firstCapture: string | null;
}

type KpiKey = keyof KpiCounts;

const KPIS: { key: KpiKey; label: string; hint: string }[] = [
  { key: "oos", label: "Out of stock", hint: "In base, SOH at or below zero — a customer cannot buy it." },
  { key: "lowCover", label: "Low stock cover", hint: "Stock on hand, still selling, 14 days cover or less." },
  { key: "phantom", label: "Phantom", hint: "Stock on the system with no sale AND no receipt for 3 months. A blank date counts as stale." },
  { key: "negSoh", label: "Negative SOH", hint: "Stock below zero — a book-keeping fault. Counted INSIDE out of stock, not beside it." },
  { key: "discontinued", label: "Discontinued with SOH", hint: "Stock left on a SKU whose status code means the retailer has stopped ranging it." },
];

function fmt(n: number): string {
  return n.toLocaleString("en-ZA").replace(/,/g, " ");
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}

/** Lower is better on every measure here, so a fall is good news. */
function Delta({ now, then }: { now: number; then: number | null | undefined }) {
  if (then === null || then === undefined) {
    return <span className="text-[var(--color-text-muted)]">no data</span>;
  }
  const d = now - then;
  if (d === 0) return <span className="text-[var(--color-text-muted)]">{fmt(then)} · no change</span>;
  const worse = d > 0;
  return (
    <span className={worse ? "text-red-600" : "text-emerald-600"}>
      {fmt(then)} {worse ? "▲" : "▼"}{fmt(Math.abs(d))}
    </span>
  );
}

export default function PortfolioHealthPage() {
  const { can, loaded: permsLoaded } = usePermissions();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/channels");
      if (!res.ok) return;
      const all: Channel[] = await res.json();
      const mains = all.filter((c) => !c.parentId && c.active !== false);
      setChannels(mains);
      if (mains.length && !channelId) setChannelId(mains[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id: string, live: boolean, save = false) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ channelId: id });
      if (live) params.set("live", "1");
      if (save) params.set("save", "1");
      const res = await authFetch(`/api/reports/portfolio-health?${params}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Could not load" }));
        setError(e.error ?? "Could not load");
        setData(null);
      } else {
        setData(await res.json());
      }
    } catch {
      setError("Could not reach the server.");
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (channelId) load(channelId, false);
  }, [channelId, load]);

  const health: PortfolioHealth | null = data?.snapshot.health ?? null;

  const captureAge = useMemo(
    () => (data ? daysSince(data.snapshot.capturedAt) : 0),
    [data],
  );

  /* Bookmarked-URL guard. `permsLoaded` is checked first so the page does not
     flash "no permission" at someone who does have it while the session is
     still loading. */
  if (permsLoaded && !can("view_dashboard")) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Portfolio Stock Health</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Portfolio Stock Health</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Every client in one channel, rolled up. Lower is better on every measure.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => load(channelId, true)}
            disabled={loading || !channelId}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Working…" : "Recalculate now"}
          </button>
          {/* Writes this week's capture by hand. The Thursday cron is the
              normal path; this exists so the history can be STARTED without
              waiting a week, and so a week whose DISPOs landed late can still
              be recorded. Saving to a date that already has a capture
              overwrites it rather than adding a second one. */}
          {can("manage_clients") && (
            <button
              onClick={() => {
                if (!confirm("Store today's numbers as this week's capture? Later weeks will compare against it.")) return;
                load(channelId, true, true);
              }}
              disabled={loading || !channelId}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Capture now
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          Reading every client&apos;s ledger for this channel. This takes a moment.
        </div>
      )}

      {data && health && (
        <>
          {/* Where the numbers came from, and how old they are. */}
          <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="font-semibold text-[var(--color-text)]">{data.snapshot.channelName}</span>
              <span className="text-[var(--color-text-muted)]">Period {data.snapshot.periodLabel}</span>
              <span className="text-[var(--color-text-muted)]">
                {fmt(health.sites)} sites · {fmt(health.clients)} clients ·{" "}
                {fmt(health.productsFlagged)} products flagged · {fmt(health.activeLines)} active lines
              </span>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {data.computedLive ? (
                <>
                  <b className="text-amber-700">Calculated just now</b> and not stored. The comparison
                  columns below are measured against stored captures, so they compare this live
                  reading against older weeks.
                </>
              ) : (
                <>
                  Captured {shortDate(data.snapshot.capturedAt)}
                  {captureAge > 10 && (
                    <b className="text-amber-700">
                      {" "}— {captureAge} days ago. The weekly capture may have stopped running.
                    </b>
                  )}
                </>
              )}
            </p>
          </div>

          {/* Stale vendors — excluded, and said so. */}
          {health.excluded.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">
                Not in these figures: {health.excluded.length} vendor
                {health.excluded.length === 1 ? "" : "s"} with no data for 14 days or more
              </p>
              <ul className="mt-2 space-y-0.5 text-amber-800">
                {health.excluded.map((e) => (
                  <li key={`${e.clientId}|${e.vendor}`}>
                    <b>{e.clientName}</b> — vendor {e.vendor || "(none)"}, last data{" "}
                    {shortDate(e.lastData)} ({fmt(e.linesRemoved)} lines)
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                Their lines are removed from every figure and every comparison period above and
                below, not just noted here. Last-known stock from a supplier who has gone quiet
                reads as real and would otherwise keep counting as out of stock forever.
              </p>
            </div>
          )}

          {/* KPI tiles */}
          <div className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {KPIS.map((kpi) => {
              const unconfigured = kpi.key === "discontinued" && !health.discontinuedConfigured;
              return (
                <div key={kpi.key} className="rounded-lg border border-[var(--color-border)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {kpi.label}
                  </p>
                  {unconfigured ? (
                    <>
                      <p className="mt-1 text-lg font-semibold text-amber-700">Not configured</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        No status code on this channel is marked as meaning discontinued, so this
                        cannot be counted. Mark them on{" "}
                        <Link href="/status-reference" className="underline">Status Reference</Link>.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-3xl font-bold text-[var(--color-text)]">
                        {fmt(health.totals[kpi.key])}
                      </p>
                      <dl className="mt-3 space-y-1 text-xs">
                        {data.comparisons.map((c) => (
                          <div key={c.label} className="flex items-baseline justify-between gap-2">
                            <dt className="text-[var(--color-text-muted)]">
                              {c.label}
                              {c.date && <span className="ml-1 opacity-70">{shortDate(c.date)}</span>}
                            </dt>
                            <dd className="font-medium">
                              <Delta now={health.totals[kpi.key]} then={c.counts?.[kpi.key] ?? null} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-muted)]">{kpi.hint}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mb-6 text-xs text-[var(--color-text-muted)]">{KPI_NOTES}</p>

          {data.captureCount <= 1 && (
            <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4 text-xs text-[var(--color-text-muted)]">
              <b className="text-[var(--color-text)]">Comparison columns are empty because there is
              nothing to compare to yet.</b>{" "}
              iRam keeps no stock history — a newer DISPO overwrites the old SOH rather than adding
              to a series — so the weeks have to be remembered as they happen. The capture runs every
              Thursday, and the first arrow appears the week after the second capture. Nothing can be
              backfilled, because the older numbers no longer exist anywhere.
            </div>
          )}

          <Table title="Most affected provinces" rows={health.byProvince} data={data} />
          <Table title="Most affected site profiles" rows={health.bySiteProfile} data={data} />
          <Table title="Most affected clients" rows={health.byClient.slice(0, 10)} data={data} compareByKey />
          <Table
            title="Most affected sites"
            rows={health.bySite}
            data={data}
            extraCols={[
              { head: "Store", get: (r) => r.extra?.storeName ?? "" },
              { head: "Province", get: (r) => r.extra?.province ?? "" },
            ]}
          />
          <Table
            title="Most affected products"
            rows={health.byProduct}
            data={data}
            extraCols={[{ head: "Description", get: (r) => r.extra?.description ?? "" }]}
          />
        </>
      )}
    </div>
  );
}

function Table({
  title,
  rows,
  data,
  extraCols = [],
  compareByKey = false,
}: {
  title: string;
  rows: BreakdownRow[];
  data: ApiResponse;
  extraCols?: { head: string; get: (r: BreakdownRow) => string }[];
  compareByKey?: boolean;
}) {
  /* Only the client table can be compared row by row: clients are stored in
     full on every capture, while sites and products are stored top-N, so a row
     missing from an older capture means "not in that week's top ten", not
     "zero". Colouring it would be a guess dressed as a fact. */
  const prior = compareByKey
    ? data.comparisons.find((c) => c.label === "4 weeks ago" && c.byClient) ?? null
    : null;

  if (rows.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {prior?.date && (
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Out-of-stock colour compares with {shortDate(prior.date)}. Green is fewer, red is more.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              <th className="px-4 py-2">Name</th>
              {extraCols.map((c) => <th key={c.head} className="px-4 py-2">{c.head}</th>)}
              <th className="px-4 py-2 text-right">Sites</th>
              <th className="px-4 py-2 text-right">OOS</th>
              <th className="px-4 py-2 text-right">Low</th>
              <th className="px-4 py-2 text-right">Phantom</th>
              <th className="px-4 py-2 text-right">Neg</th>
              <th className="px-4 py-2 text-right">Disc</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const was = prior?.byClient?.[r.key]?.oos;
              const tone =
                was === undefined ? "" :
                r.counts.oos < was ? "text-emerald-600" :
                r.counts.oos > was ? "text-red-600" : "";
              return (
                <tr key={r.key} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 font-medium text-[var(--color-text)]">{r.label}</td>
                  {extraCols.map((c) => (
                    <td key={c.head} className="px-4 py-2 text-[var(--color-text-muted)]">{c.get(r)}</td>
                  ))}
                  <td className="px-4 py-2 text-right text-[var(--color-text-muted)]">{fmt(r.sites)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${tone}`}>{fmt(r.counts.oos)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.counts.lowCover)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.counts.phantom)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.counts.negSoh)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.counts.discontinued)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
