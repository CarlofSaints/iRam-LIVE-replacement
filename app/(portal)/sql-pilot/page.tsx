"use client";

import { useEffect, useState } from "react";
import { authFetch, usePermissions } from "@/lib/useAuth";

/* SQL Direct (pilot) — super-admin-only workbench for reading DISPO, store and
   product data straight from SQL Server instead of the manual uploads.

   Read-only. Nothing on this page writes to the ledger, the store master,
   control files or the upload index — the existing manual load path is
   completely unaffected while the two are compared. */

interface SourceInfo {
  id: string; label: string; replaces: string; query: string; proc: string;
  channel: string | null; notes: string | null; availableOnProxy: boolean | null;
}
interface ClientMatch { iramName: string; iramId: string; exactMatch: boolean }
interface Status {
  configured: boolean; error?: string;
  health?: { ok?: boolean; status?: number; error?: string } & Record<string, unknown>;
  proxyQueryCount?: number;
  sources?: SourceInfo[];
  sqlClientCount?: number;
  sqlClientNames?: string[];
  clientMatching?: ClientMatch[];
  matchedCount?: number;
}
interface ColumnFill { column: string; filledPct: number; sample: string }
interface ProbeResult {
  source: { label: string; proc: string; replaces: string };
  client: string; yearMonth: string | null;
  rowCount: number; columnCount: number;
  columns: ColumnFill[];
  sample: Record<string, unknown>[];
  elapsedMs: number;
}

export default function SqlPilotPage() {
  // `loaded` matters here: without it the page flashes "no permission" for a
  // moment while the role→permission matrix is still in flight.
  const { can, loaded: permsLoaded } = usePermissions();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceId, setSourceId] = useState("");
  const [client, setClient] = useState("");
  const [yearMonth, setYearMonth] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState("");
  const [showClients, setShowClients] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/sql-pilot/status");
      if (res.ok) setStatus(await res.json());
      else setStatus({ configured: false, error: `Status check failed (${res.status})` });
      setLoading(false);
    })();
  }, []);

  async function runProbe() {
    if (!sourceId || !client) return;
    setProbing(true); setProbeError(""); setProbe(null);
    const params = new URLSearchParams({ source: sourceId, client });
    if (yearMonth) params.set("yearMonth", yearMonth);
    const res = await authFetch(`/api/sql-pilot/probe?${params}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setProbeError(body?.error || `Probe failed (${res.status})`);
    else setProbe(body);
    setProbing(false);
  }

  // The page refuses a bookmarked URL as well — the nav link being hidden is
  // not access control on its own. (The API enforces it independently.)
  if (permsLoaded && !can("view_sql_pilot")) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">SQL Direct</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const healthOk = status?.health?.ok === true;

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">SQL Direct</h1>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            PILOT · super admin only
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-muted)]">
          Reads store, product and sales data straight from SQL Server via stored procedures —
          the data that is loaded by hand today. <strong>Read-only:</strong> nothing here writes to
          the ledger, store master, control files or uploads, so the existing DISPO and control-file
          flow carries on untouched while the two are compared.
        </p>
      </div>

      {loading && <div className="text-sm text-[var(--color-text-muted)]">Checking connection…</div>}

      {/* ── Connection ── */}
      {status && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Connection
          </h2>
          {!status.configured ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {status.error}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="SQL proxy"
                value={healthOk ? "Reachable" : "Unreachable"}
                tone={healthOk ? "good" : "bad"}
                detail={healthOk ? undefined : String(status.health?.error ?? status.health?.status ?? "")}
              />
              <Stat label="Named queries on proxy" value={String(status.proxyQueryCount ?? 0)} />
              <Stat
                label="Clients visible in SQL"
                value={String(status.sqlClientCount ?? 0)}
                detail={`${status.matchedCount ?? 0} of ${status.clientMatching?.length ?? 0} iRam clients match by exact name`}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Sources ── */}
      {status?.configured && status.sources && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-5">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Sources
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            What each manual upload maps to in SQL.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4">Replaces</th>
                  <th className="py-2 pr-4">SQL source</th>
                  <th className="py-2 pr-4">Stored procedure</th>
                  <th className="py-2">On proxy</th>
                </tr>
              </thead>
              <tbody>
                {status.sources.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td className="py-2 pr-4 text-[var(--color-text-muted)]">{s.replaces}</td>
                    <td className="py-2 pr-4 font-medium text-[var(--color-text)]">
                      {s.label}
                      {s.notes && (
                        <div className="mt-0.5 text-xs font-normal text-[var(--color-text-muted)]">{s.notes}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--color-text-muted)]">{s.proc}</td>
                    <td className="py-2">
                      {s.availableOnProxy === null ? (
                        <span className="text-xs text-[var(--color-text-muted)]">unknown</span>
                      ) : s.availableOnProxy ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">yes</span>
                      ) : (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">missing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Probe ── */}
      {status?.configured && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Pull a source
          </h2>
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Source</label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <option value="">Select a source</option>
                {status.sources?.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                SQL client name
              </label>
              <input
                list="sql-client-names"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="e.g. HAIER ELECTRONICS"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
              <datalist id="sql-client-names">
                {status.sqlClientNames?.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Month (sales only)
              </label>
              <input
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                placeholder="YYYY-MM (blank = latest)"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            onClick={runProbe}
            disabled={!sourceId || !client || probing}
            className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            {probing ? "Pulling…" : "Pull from SQL"}
          </button>

          {probeError && (
            <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {probeError}
            </div>
          )}
        </div>
      )}

      {/* ── Probe result ── */}
      {probe && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-5">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <h2 className="text-sm font-bold text-[var(--color-text)]">{probe.source.label}</h2>
            <span className="text-xs text-[var(--color-text-muted)]">
              {probe.rowCount.toLocaleString()} rows · {probe.columnCount} columns ·{" "}
              {(probe.elapsedMs / 1000).toFixed(1)}s
              {probe.yearMonth ? ` · ${probe.yearMonth}` : ""}
            </span>
          </div>

          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Columns — how populated
          </h3>
          <div className="mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4">Column</th>
                  <th className="py-2 pr-4">Filled</th>
                  <th className="py-2">Example</th>
                </tr>
              </thead>
              <tbody>
                {probe.columns.map((c) => (
                  <tr key={c.column} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5 pr-4 font-mono text-xs text-[var(--color-text)]">{c.column}</td>
                    <td className="py-1.5 pr-4">
                      <span
                        className={
                          c.filledPct === 0
                            ? "rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                            : c.filledPct < 50
                              ? "rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                              : "rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                        }
                      >
                        {c.filledPct}%
                      </span>
                    </td>
                    <td className="py-1.5 font-mono text-xs text-[var(--color-text-muted)]">{c.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Sample rows
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--color-bg)] text-left">
                  {probe.columns.map((c) => (
                    <th key={c.column} className="whitespace-nowrap px-3 py-2 font-mono font-medium text-[var(--color-text-muted)]">
                      {c.column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {probe.sample.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]">
                    {probe.columns.map((c) => (
                      <td key={c.column} className="whitespace-nowrap px-3 py-1.5 text-[var(--color-text)]">
                        {row[c.column] === null || row[c.column] === undefined
                          ? ""
                          : String(row[c.column]).slice(0, 40)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Client name matching ── */}
      {status?.configured && status.clientMatching && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
          <button
            onClick={() => setShowClients(!showClients)}
            className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {showClients ? "▾" : "▸"} Client name matching ({status.matchedCount} of{" "}
            {status.clientMatching.length} match exactly)
          </button>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            SQL keys everything on a client <em>name</em>; iRam has its own client records. A name that
            does not match looks identical to &ldquo;SQL has no data for this client&rdquo;, so the
            mismatches are worth knowing before anything is switched over.
          </p>
          {showClients && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="py-2">iRam client</th>
                  <th className="py-2">Exact name in SQL</th>
                </tr>
              </thead>
              <tbody>
                {status.clientMatching.map((c) => (
                  <tr key={c.iramId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5 text-[var(--color-text)]">{c.iramName}</td>
                    <td className="py-1.5">
                      {c.exactMatch ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">match</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">no exact match</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-4 py-3">
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div
        className={
          "mt-0.5 text-lg font-bold " +
          (tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : "text-[var(--color-text)]")
        }
      >
        {value}
      </div>
      {detail && <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{detail}</div>}
    </div>
  );
}
