"use client";

import { useState } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { authFetch, useAuth } from "@/lib/useAuth";
import PackPriceAudit from "@/components/PackPriceAudit";
import ParserVersionAudit from "@/components/ParserVersionAudit";

interface LedgerDescIssue {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  totalRows: number;
  flaggedRows: number;
  samples: string[];
}
interface DescAuditReport {
  generatedAt: string;
  metered: boolean;
  affectedClients: string[];
  issues: LedgerDescIssue[];
}

export default function DataHealthPage() {
  const { user } = useAuth();
  const [report, setReport] = useState<DescAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function scan() {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const res = await authFetch("/api/diagnostics/desc-audit");
      if (res.ok) setReport(await res.json());
      else setError((await res.json()).error || "Scan failed");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  const tools = useTableTools<LedgerDescIssue>(
    report?.issues ?? [],
    {
      clientName: (i) => i.clientName,
      channelName: (i) => i.channelName,
      flaggedRows: (i) => i.flaggedRows,
    },
    "flaggedRows",
    (i) => [i.clientName, i.channelName, i.samples.join(" ")].join(" "),
    "desc", // worst offenders first
  );

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">Data Health</h1>

      <h2 className="mb-2 text-xl font-bold text-[var(--color-text)]">Bad descriptions</h2>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Scans every client&apos;s sales ledger for product descriptions that look like payment-terms
        text — the symptom of the column-mapping bug (e.g. Libra&apos;s &ldquo;Descriptio&rdquo; column).
        Any client listed below just needs its <strong>latest DISPO re-uploaded</strong> in Data Load
        to overwrite the bad names. The parser is already fixed, so a fresh load corrects them.
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
          {report.issues.length === 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
              ✓ No bad descriptions found. All ledgers look clean.
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <div className="text-sm font-bold text-amber-800">
                  {report.affectedClients.length} client(s) need a re-upload
                </div>
                <div className="mt-1 text-sm text-amber-700">{report.affectedClients.join(", ")}</div>
              </div>

              <div className="mb-3">
                <TableSearch value={tools.query} onChange={tools.setQuery}
                  count={tools.rows.length} total={tools.total} placeholder="Search clients, channels, samples…" />
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                      {[["Client", "clientName"], ["Channel", "channelName"]].map(([label, key]) => (
                        <SortableTh key={key} label={label} sortKey={key} className="px-4 py-2.5"
                          current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      ))}
                      <SortableTh label="Bad / Total" sortKey="flaggedRows" className="px-4 py-2.5" align="right"
                        current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                      <th className="px-4 py-2.5 text-left font-semibold">Sample bad descriptions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {tools.rows.map((i) => (
                      <tr key={`${i.clientId}-${i.channelId}`} className="align-top hover:bg-zinc-50/50">
                        <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{i.clientName}</td>
                        <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{i.channelName}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-semibold text-red-600">{i.flaggedRows.toLocaleString()}</span>
                          <span className="text-[var(--color-text-muted)]"> / {i.totalRows.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <ul className="space-y-0.5 text-xs text-[var(--color-text-muted)]">
                            {i.samples.map((s, k) => <li key={k} className="truncate max-w-md" title={s}>{s}</li>)}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Scanned {new Date(report.generatedAt).toLocaleString()}. Re-run after reloading to confirm they clear.
          </p>
        </div>
      )}

      {/* Only a super admin may run the repair; everyone who can reach this page
          can still SCAN, because seeing the damage is not the dangerous half. */}
      <PackPriceAudit canRepair={user?.role === "super_admin"} />

      <ParserVersionAudit />
    </div>
  );
}
