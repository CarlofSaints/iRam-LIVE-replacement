"use client";

/* Which parser wrote the numbers in each ledger.

   On 25 Aug 2026 six clients were reloaded to repair a thousandfold
   understatement — between 10:43 and 11:44, while the fix went live at 11:51.
   Every one re-wrote the same wrong numbers and ticked the DISPO Checklist.
   Nothing in the data distinguished a repaired row from an unrepaired one.

   Now it does. Full write-up in lib/parserVersion.ts.

   Declared at module level on purpose — a component defined inside another
   component is a new type every render and remounts, which would blow away the
   scan result on every keystroke. */

import { useState } from "react";
import { authFetch } from "@/lib/useAuth";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { PARSER_HISTORY } from "@/lib/parserVersion";

interface LedgerVersionRow {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  totalRows: number;
  current: number;
  behind: number;
  unstamped: number;
  byVersion: Record<string, number>;
  staleAsOf: string;
}
interface Report {
  generatedAt: string;
  currentVersion: number;
  metered: boolean;
  stale: LedgerVersionRow[];
  clean: LedgerVersionRow[];
  totals: { rows: number; current: number; behind: number; unstamped: number };
}

export default function ParserVersionAudit() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function scan() {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const res = await authFetch("/api/diagnostics/parser-versions");
      if (res.ok) setReport(await res.json());
      else setError((await res.json()).error || "Scan failed");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  const tools = useTableTools<LedgerVersionRow>(
    report?.stale ?? [],
    {
      clientName: (l) => l.clientName,
      channelName: (l) => l.channelName,
      stale: (l) => l.behind + l.unstamped,
      staleAsOf: (l) => l.staleAsOf,
    },
    "stale",
    (l) => [l.clientName, l.channelName].join(" "),
    "desc",
  );

  const pct = (n: number, of: number) => (of === 0 ? "0" : ((n / of) * 100).toFixed(1));

  return (
    <div className="mt-12">
      <h2 className="mb-2 text-xl font-bold text-[var(--color-text)]">Which parser wrote each ledger</h2>
      <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Every DISPO load stamps its rows with the version of the read path that wrote them, so
        &ldquo;has this stream actually been repaired?&rdquo; is a question you can ask of the data.
        Before this existed the only way to tell was to compare load times against a deployment
        clock — which is how six clients were reloaded by the <em>old</em> parser on 25 Aug 2026,
        re-wrote the same wrong numbers, and ticked the DISPO Checklist as done.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Anything listed below needs its <strong>latest DISPO re-uploaded</strong> in Data Load.
        <strong> Unstamped</strong> means the row was written before 25 Aug 2026 — that is age, not
        proof of a problem, but it is equally unproven, so treat it the same way.
      </p>

      <button
        onClick={scan}
        disabled={loading}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
      >
        {loading ? "Scanning ledgers…" : "Scan ledgers"}
      </button>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {report && !report.metered && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          No Blob store detected (running on local filesystem) — nothing to scan.
        </div>
      )}

      {report && report.metered && (
        <div className="mt-6">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">On the current parser</div>
              <div className="mt-1 text-2xl font-bold text-green-700">{pct(report.totals.current, report.totals.rows)}%</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                {report.totals.current.toLocaleString()} of {report.totals.rows.toLocaleString()} rows · v{report.currentVersion}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Behind</div>
              <div className="mt-1 text-2xl font-bold text-red-600">{report.totals.behind.toLocaleString()}</div>
              <div className="text-xs text-[var(--color-text-muted)]">written by an older stamped parser</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Unstamped</div>
              <div className="mt-1 text-2xl font-bold text-amber-600">{report.totals.unstamped.toLocaleString()}</div>
              <div className="text-xs text-[var(--color-text-muted)]">written before 25 Aug 2026</div>
            </div>
          </div>

          {report.stale.length === 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
              ✓ Every ledger is on parser v{report.currentVersion}.
            </div>
          ) : (
            <>
              <div className="mb-3">
                <TableSearch value={tools.query} onChange={tools.setQuery}
                  count={tools.rows.length} total={tools.total} placeholder="Search clients, channels…" />
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                      {[["Client", "clientName"], ["Channel", "channelName"]].map(([label, key]) => (
                        <SortableTh key={key} label={label} sortKey={key} className="px-4 py-2.5"
                          current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      ))}
                      <SortableTh label="Needs reload / Total" sortKey="stale" className="px-4 py-2.5" align="right"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      <th className="px-4 py-2.5 text-left font-semibold">By version</th>
                      <SortableTh label="Last stale load" sortKey="staleAsOf" className="px-4 py-2.5"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {tools.rows.map((l) => (
                      <tr key={`${l.clientId}-${l.channelId}`} className="align-top hover:bg-zinc-50/50">
                        <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{l.clientName}</td>
                        <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{l.channelName}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <span className="font-semibold text-red-600">{(l.behind + l.unstamped).toLocaleString()}</span>
                          <span className="text-[var(--color-text-muted)]"> / {l.totalRows.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {Object.entries(l.byVersion)
                            .sort((a, b) => b[1] - a[1])
                            .map(([v, n]) => `${v}: ${n.toLocaleString()}`)
                            .join(" · ")}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                          {l.staleAsOf ? new Date(l.staleAsOf).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <details className="mt-4 rounded-xl border border-[var(--color-border)] bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text)]">
              What each parser version changed
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {PARSER_HISTORY.map((r) => (
                <li key={r.version} className="flex gap-3">
                  <span className={`shrink-0 font-mono font-semibold ${r.version === report.currentVersion ? "text-green-700" : "text-[var(--color-text-muted)]"}`}>
                    v{r.version}
                  </span>
                  <span className="text-[var(--color-text-muted)]">
                    <span className="text-[var(--color-text)]">{r.date}</span>
                    {r.commit !== "—" && <span className="font-mono text-xs"> {r.commit}</span>} — {r.summary}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Scanned {new Date(report.generatedAt).toLocaleString()}. Re-run after reloading to confirm they clear.
          </p>
        </div>
      )}
    </div>
  );
}
