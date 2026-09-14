"use client";

/* Portfolio Stock Health — the Account Manager's view of one channel.
 *
 * Reads the latest STORED capture by default, not a live computation, because
 * the comparison columns are made against stored captures: a fresh number
 * beside week-old comparisons would show a delta between two readings taken on
 * different days and call it a week. "Recalculate now" is there for the moment
 * after a DISPO lands, and labels itself.
 *
 * ── Filtering ──────────────────────────────────────────────────
 * Click anything — a province, a site profile, a client, a store, a product —
 * and every other figure on the page narrows to it. Click again to clear.
 * Filters stack across dimensions, so Western Cape + Clippa is two clicks.
 *
 * This happens entirely in the browser, against the cube the API ships
 * (lib/portfolioCube.ts). Filtering server-side would mean re-reading every
 * client's ledger on every click — twenty seconds on Massbuild — and nobody
 * explores a report at twenty seconds a click.
 *
 * Colour rule: every measure here is bad when it goes up, so a fall is green
 * and a rise is red — a fixed judgement, not a relative scale. A ranking scale
 * would colour the least-bad province green even in a week where every number
 * got worse.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { authFetch, usePermissions } from "@/lib/useAuth";
import type { Channel } from "@/lib/types";
import type { KpiCounts, PortfolioHealth } from "@/lib/portfolioHealth";
import type { ComparisonPoint, PortfolioSnapshot } from "@/lib/portfolioSnapshot";
import { KPI_NOTES } from "@/lib/stockFlagNotes";
import {
  aggregateCube,
  cubeLines,
  emptyFilter,
  filterIsEmpty,
  filterLabel,
  flagNames,
  toggleFilter,
  DIMENSION_LABELS,
  type CubeBreakdownRow,
  type CubeDimension,
  type CubeFilter,
  type CubeView,
  type PortfolioCube,
} from "@/lib/portfolioCube";

/** Rows shown per table before "Show 10 more". */
const PAGE_SIZE = 10;
/** Underlying lines shown when a row is expanded, before "Show 25 more". */
const DETAIL_PAGE = 25;

interface ApiResponse {
  snapshot: PortfolioSnapshot;
  comparisons: ComparisonPoint[];
  computedLive: boolean;
  cube: PortfolioCube | null;
  cubeAvailable: boolean;
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
  const [cube, setCube] = useState<PortfolioCube | null>(null);
  const [cubeLoading, setCubeLoading] = useState(false);
  const [cubeError, setCubeError] = useState("");
  const [filter, setFilter] = useState<CubeFilter>(emptyFilter());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /* An expired session answers 401, and a 401 that is only `return`ed reads on
     screen as "this channel has no data" — an empty picker and empty tiles,
     indistinguishable from a genuinely empty portfolio. Say which it is. */
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/channels");
      if (res.status === 401) { setExpired(true); return; }
      if (!res.ok) { setError("Could not load the channel list."); return; }
      const all: Channel[] = await res.json();
      const mains = all.filter((c) => !c.parentId && c.active !== false);
      setChannels(mains);
      if (mains.length && !channelId) setChannelId(mains[0].id);
      else if (mains.length === 0) setError("No active main channels are set up.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id: string, live: boolean, save = false) => {
    if (!id) return;
    setLoading(true);
    setError("");
    setCubeError("");
    // A filter from the channel you were just looking at means nothing here.
    setFilter(emptyFilter());
    setCube(null);
    try {
      const params = new URLSearchParams({ channelId: id });
      if (live) params.set("live", "1");
      if (save) params.set("save", "1");
      const res = await authFetch(`/api/reports/portfolio-health?${params}`);
      if (res.status === 401) {
        setExpired(true);
        setData(null);
      } else if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Could not load" }));
        setError(e.error ?? "Could not load");
        setData(null);
      } else {
        const body: ApiResponse = await res.json();
        setData(body);
        // A live run already carries its cube; a stored one is fetched below.
        if (body.cube) setCube(body.cube);
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

  /* Fetch the cube AFTER the tiles have painted. It is around a megabyte, and
     the headline numbers should not wait on it — the page is readable without
     it, just not clickable. */
  useEffect(() => {
    if (!data || cube || !data.cubeAvailable || !channelId) return;
    let cancelled = false;
    (async () => {
      setCubeLoading(true);
      try {
        const res = await authFetch(
          `/api/reports/portfolio-health?channelId=${encodeURIComponent(channelId)}&part=cube`,
        );
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json();
          setCube(body.cube ?? null);
        } else {
          const e = await res.json().catch(() => ({ error: "" }));
          setCubeError(e.error || "Filtering is unavailable for this capture.");
        }
      } catch {
        if (!cancelled) setCubeError("Could not load the filter data.");
      }
      if (!cancelled) setCubeLoading(false);
    })();
    return () => { cancelled = true; };
  }, [data, cube, channelId]);

  const health: PortfolioHealth | null = data?.snapshot.health ?? null;

  /* Every figure comes from the cube once it is loaded, filtered or not, so a
     filtered and an unfiltered reading are never produced by two different
     code paths. Until it arrives, the stored aggregates render instead. */
  /* topN 0 = every row. The tables page themselves with "Show 10 more", so the
     engine must not have already thrown the eleventh site away. */
  const view: CubeView | null = useMemo(
    () => (cube ? aggregateCube(cube, filter, 0) : null),
    [cube, filter],
  );

  const filtered = !filterIsEmpty(filter);
  const captureAge = useMemo(() => (data ? daysSince(data.snapshot.capturedAt) : 0), [data]);

  const click = useCallback((dim: CubeDimension, key: string) => {
    setFilter((f) => toggleFilter(f, dim, key));
  }, []);

  const chips = useMemo(() => {
    const out: { dim: CubeDimension; value: string }[] = [];
    (Object.keys(filter) as CubeDimension[]).forEach((dim) => {
      for (const v of filter[dim]) out.push({ dim, value: v });
    });
    return out;
  }, [filter]);

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

  // Tables render from the cube when it is there, else from the stored capture.
  const tables = view
    ? {
        province: view.byProvince,
        profile: view.bySiteProfile,
        client: view.byClient,
        site: view.bySite,
        product: view.byProduct,
      }
    : health
      ? {
          province: health.byProvince as unknown as CubeBreakdownRow[],
          profile: health.bySiteProfile as unknown as CubeBreakdownRow[],
          client: health.byClient.slice(0, 10) as unknown as CubeBreakdownRow[],
          site: health.bySite as unknown as CubeBreakdownRow[],
          product: health.byProduct as unknown as CubeBreakdownRow[],
        }
      : null;

  const totals: KpiCounts | null = view ? view.totals : health?.totals ?? null;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Portfolio Stock Health</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Every client in one channel, rolled up. Lower is better on every measure.
            {cube && " Click any row to filter the rest of the report to it."}
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

      {expired && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Your session has expired.</b>{" "}
          <Link href="/login" className="underline">Sign in again</Link> to load this report. Nothing
          below is missing data — the server refused the request, it did not return an empty
          portfolio.
        </div>
      )}

      {error && !expired && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          Reading every client&apos;s ledger for this channel. This takes a moment.
        </div>
      )}

      {data && health && totals && tables && (
        <>
          {/* Where the numbers came from, and how old they are. */}
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="font-semibold text-[var(--color-text)]">{data.snapshot.channelName}</span>
              <span className="text-[var(--color-text-muted)]">Period {data.snapshot.periodLabel}</span>
              <span className="text-[var(--color-text-muted)]">
                {view
                  ? `${fmt(view.sites)} sites with issues · ${fmt(view.clients)} clients · ${fmt(view.products)} products · ${fmt(view.lines)} flagged lines`
                  : `${fmt(health.sites)} sites · ${fmt(health.clients)} clients · ${fmt(health.productsFlagged)} products flagged · ${fmt(health.activeLines)} active lines`}
              </span>
              {!filtered && cube && (
                <span className="text-[var(--color-text-muted)]">
                  {fmt(cube.activeLines)} active lines in base
                </span>
              )}
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
              {cubeLoading && " · loading filter data…"}
              {cubeError && <b className="text-amber-700"> · {cubeError}</b>}
            </p>
          </div>

          {/* Active filters */}
          {filtered && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-blue-50/40 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Filtered to
              </span>
              {chips.map((c) => (
                <button
                  key={`${c.dim}|${c.value}`}
                  onClick={() => click(c.dim, c.value)}
                  title="Remove this filter"
                  className="rounded-full border border-[var(--color-primary)] bg-white px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)]"
                >
                  {DIMENSION_LABELS[c.dim]}: {filterLabel(c.dim, c.value, cube)} ×
                </button>
              ))}
              <button
                onClick={() => setFilter(emptyFilter())}
                className="text-xs font-medium text-[var(--color-text-muted)] underline"
              >
                Clear all
              </button>
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
                        {fmt(totals[kpi.key])}
                      </p>
                      {filtered ? (
                        /* The comparison columns come from OLDER captures, which
                           are stored as totals only — there is no stored cube for
                           them to filter. Showing the portfolio-wide previous week
                           beside a filtered headline would invite a subtraction
                           that means nothing, so the columns stand down. */
                        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                          Week-on-week comparison is portfolio-wide only. Clear the filter to see it.
                        </p>
                      ) : (
                        <dl className="mt-3 space-y-1 text-xs">
                          {data.comparisons.map((c) => (
                            <div key={c.label} className="flex items-baseline justify-between gap-2">
                              <dt className="text-[var(--color-text-muted)]">
                                {c.label}
                                {c.date && <span className="ml-1 opacity-70">{shortDate(c.date)}</span>}
                              </dt>
                              <dd className="font-medium">
                                <Delta now={totals[kpi.key]} then={c.counts?.[kpi.key] ?? null} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-muted)]">{kpi.hint}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mb-6 text-xs text-[var(--color-text-muted)]">{KPI_NOTES}</p>

          {data.captureCount <= 1 && !filtered && (
            <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4 text-xs text-[var(--color-text-muted)]">
              <b className="text-[var(--color-text)]">Comparison columns are empty because there is
              nothing to compare to yet.</b>{" "}
              iRam keeps no stock history — a newer DISPO overwrites the old SOH rather than adding
              to a series — so the weeks have to be remembered as they happen. The capture runs every
              Thursday, and the first arrow appears the week after the second capture. Nothing can be
              backfilled, because the older numbers no longer exist anywhere.
            </div>
          )}

          <Table title="Most affected provinces" rows={tables.province} dim="provinces"
                 filter={filter} onClick={click} cube={cube} />
          <Table title="Most affected site profiles" rows={tables.profile} dim="profiles"
                 filter={filter} onClick={click} cube={cube} />
          <Table title="Most affected clients" rows={tables.client} dim="clients"
                 filter={filter} onClick={click} cube={cube}
                 prior={!filtered ? data.comparisons.find((c) => c.label === "4 weeks ago" && c.byClient) ?? null : null} />
          <Table title="Most affected sites" rows={tables.site} dim="sites"
                 filter={filter} onClick={click} cube={cube}
                 extraCols={[
                   { head: "Store", get: (r) => r.extra?.storeName ?? "" },
                   { head: "Province", get: (r) => r.extra?.province ?? "" },
                 ]} />
          <Table title="Most affected products" rows={tables.product} dim="articles"
                 filter={filter} onClick={click} cube={cube}
                 extraCols={[{ head: "Description", get: (r) => r.extra?.description ?? "" }]} />
        </>
      )}
    </div>
  );
}

function Table({
  title,
  rows,
  dim,
  filter,
  onClick,
  cube,
  extraCols = [],
  prior = null,
}: {
  title: string;
  rows: CubeBreakdownRow[];
  dim: CubeDimension;
  filter: CubeFilter;
  onClick: (dim: CubeDimension, key: string) => void;
  cube: PortfolioCube | null;
  extraCols?: { head: string; get: (r: CubeBreakdownRow) => string }[];
  prior?: ComparisonPoint | null;
}) {
  /* Paging and expansion are per table. `visible` is how many rows are shown;
     `openKey` is the one row whose underlying lines are unrolled beneath it —
     one at a time on purpose, since two expanded thousand-line tables make the
     page unreadable and nobody compares two detail lists by scrolling. */
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [detailShown, setDetailShown] = useState(DETAIL_PAGE);

  // A new filter or channel changes what these rows mean; start from the top.
  useEffect(() => {
    setVisible(PAGE_SIZE);
    setOpenKey(null);
    setDetailShown(DETAIL_PAGE);
  }, [filter, rows.length]);

  const clickable = !!cube;
  const shown = rows.slice(0, visible);
  const more = rows.length - shown.length;

  const detail = useMemo(() => {
    if (!cube || !openKey) return null;
    return cubeLines(cube, filter, { dim, value: openKey }, detailShown);
  }, [cube, openKey, filter, dim, detailShown]);

  if (rows.length === 0) return null;
  const selected = new Set(filter[dim]);
  const colSpan = 7 + extraCols.length + (clickable ? 1 : 0);

  return (
    <div className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
        {title}
        <span className="ml-2 font-normal text-[var(--color-text-muted)]">
          {fmt(rows.length)} in total
        </span>
      </h2>
      {prior?.date && (
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Out-of-stock colour compares with {shortDate(prior.date)}. Green is fewer, red is more.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {clickable && <th className="w-8 px-2 py-2" />}
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
            {shown.map((r) => {
              /* Only the client table can be compared row by row: clients are
                 stored in full on every capture, while sites and products are
                 stored top-N, so a row missing from an older capture means "not
                 in that week's top ten", not "zero". */
              const was = prior?.byClient?.[r.key]?.oos;
              const tone =
                was === undefined ? "" :
                r.counts.oos < was ? "text-emerald-600" :
                r.counts.oos > was ? "text-red-600" : "";
              const isOn = selected.has(r.key);
              const isOpen = openKey === r.key;
              return (
                <Fragment key={r.key}>
                  <tr
                    className={
                      "border-b border-[var(--color-border)] " +
                      (isOn ? "bg-blue-50/60 " : "") +
                      (isOpen ? "bg-zinc-50 " : "")
                    }
                  >
                    {/* The arrow drills IN; clicking the row filters. Two
                        different intentions, so two different targets — one
                        control doing both would make every filter click also
                        unroll a detail table nobody asked for. */}
                    {clickable && (
                      <td className="px-2 py-2 align-top">
                        <button
                          onClick={() => {
                            setDetailShown(DETAIL_PAGE);
                            setOpenKey(isOpen ? null : r.key);
                          }}
                          title={isOpen ? "Hide the underlying lines" : `Show the lines behind ${r.label}`}
                          aria-expanded={isOpen}
                          className="rounded px-1 text-xs text-[var(--color-text-muted)] hover:bg-zinc-200 hover:text-[var(--color-text)]"
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                    )}
                    <td
                      onClick={clickable ? () => onClick(dim, r.key) : undefined}
                      title={clickable ? (isOn ? "Click to remove this filter" : `Filter the report to ${r.label}`) : undefined}
                      className={
                        "px-4 py-2 font-medium text-[var(--color-text)] " +
                        (clickable ? "cursor-pointer hover:underline" : "")
                      }
                    >
                      {isOn && <span className="mr-1 text-[var(--color-primary)]">✓</span>}
                      {r.label}
                    </td>
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

                  {isOpen && detail && (
                    <tr className="border-b border-[var(--color-border)] bg-zinc-50/60">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">
                          {r.label} — showing {fmt(detail.lines.length)} of {fmt(detail.total)} flagged lines
                        </p>
                        <div className="overflow-x-auto rounded border border-[var(--color-border)] bg-white">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                                <th className="px-3 py-1.5">Site</th>
                                <th className="px-3 py-1.5">Store</th>
                                <th className="px-3 py-1.5">Client</th>
                                <th className="px-3 py-1.5">Article</th>
                                <th className="px-3 py-1.5">Description</th>
                                <th className="px-3 py-1.5">Flagged as</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines.map((l, i) => (
                                <tr key={`${l.siteCode}|${l.clientId}|${l.article}|${i}`}
                                    className="border-b border-[var(--color-border)] last:border-0">
                                  <td className="px-3 py-1.5 font-mono">{l.siteCode}</td>
                                  <td className="px-3 py-1.5 text-[var(--color-text-muted)]">{l.storeName}</td>
                                  <td className="px-3 py-1.5 text-[var(--color-text-muted)]">{l.clientName}</td>
                                  <td className="px-3 py-1.5 font-mono">{l.article}</td>
                                  <td className="px-3 py-1.5 text-[var(--color-text-muted)]">
                                    {l.description || <span className="italic">no description</span>}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span className="flex flex-wrap gap-1">
                                      {flagNames(l.flags).map((f) => (
                                        <span key={f} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                                          {f}
                                        </span>
                                      ))}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {detail.total > detail.lines.length && (
                          <button
                            onClick={() => setDetailShown((n) => n + DETAIL_PAGE)}
                            className="mt-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
                          >
                            Show {Math.min(DETAIL_PAGE, detail.total - detail.lines.length)} more lines
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {more > 0 && (
        <button
          onClick={() => setVisible((n) => n + PAGE_SIZE)}
          className="mt-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium"
        >
          Show {Math.min(PAGE_SIZE, more)} more ({fmt(more)} not shown)
        </button>
      )}
    </div>
  );
}
