"use client";

import { useEffect, useState } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { authFetch } from "@/lib/useAuth";

interface ClientStorage {
  clientId: string;
  clientName: string;
  bytes: number;
  blobCount: number;
}
interface StorageReport {
  totalBytes: number;
  totalBlobs: number;
  clients: ClientStorage[];
  sharedBytes: number;
  sharedBlobs: number;
  generatedAt: string;
  metered: boolean;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}
const gb = (bytes: number) => bytes / 1e9;

export default function StoragePage() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rate, setRate] = useState(""); // cost per GB / month, in whatever currency Carl bills

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/storage");
      if (res.ok) setReport(await res.json());
      else setError((await res.json()).error || "Failed to load storage usage");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const rateNum = parseFloat(rate);
  const showCost = !isNaN(rateNum) && rateNum > 0;
  const cost = (bytes: number) => `R ${(gb(bytes) * rateNum).toFixed(2)}`;

  // "% of total" is derived, so it sorts on the underlying bytes.
  const tools = useTableTools<ClientStorage>(
    report?.clients ?? [],
    {
      clientName: (c) => c.clientName,
      blobCount: (c) => c.blobCount,
      bytes: (c) => c.bytes,
      pct: (c) => c.bytes,
    },
    "bytes",
    (c) => c.clientName,
    "desc", // largest first, as it has always opened
  );

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Storage Usage</h1>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50"
        >
          {loading ? "Calculating…" : "Refresh"}
        </button>
      </div>

      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Blob storage used by each client&apos;s data (sales ledgers, PMF/LINKS, control files,
        logos and per-upload rows). Raw DISPO files are <strong>not</strong> stored here — those
        live in SharePoint — so these figures are the app&apos;s actual footprint. Use them to
        attribute the (small) storage cost per client.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {report && !report.metered && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          No Blob store detected (running on local filesystem) — nothing to meter.
        </div>
      )}

      {report && report.metered && (
        <>
          {/* Totals + cost rate */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Total stored</div>
              <div className="mt-1 text-2xl font-bold text-[var(--color-text)]">{fmtBytes(report.totalBytes)}</div>
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{report.totalBlobs.toLocaleString()} objects</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Shared / unattributed</div>
              <div className="mt-1 text-2xl font-bold text-[var(--color-text)]">{fmtBytes(report.sharedBytes)}</div>
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">indexes, channel logos, store master</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Cost per GB / month</label>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 0.50"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm"
              />
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {showCost ? `Total ≈ ${cost(report.totalBytes)} / mo` : "Enter your Vercel rate to estimate cost"}
              </div>
            </div>
          </div>

          {/* Per-client table */}
          <div className="mb-3">
            <TableSearch value={tools.query} onChange={tools.setQuery}
              count={tools.rows.length} total={tools.total} placeholder="Search clients…" />
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                <tr>
                  <SortableTh label="Client" sortKey="clientName" className="px-4 py-2.5"
                    current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                  {[["Objects", "blobCount"], ["Size", "bytes"], ["% of total", "pct"]].map(([label, key]) => (
                    <SortableTh key={key} label={label} sortKey={key} className="px-4 py-2.5" align="right"
                      current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                  ))}
                  {showCost && <th className="px-4 py-2.5 text-right font-semibold">Est. cost/mo</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {tools.rows.map((c) => (
                  <tr key={c.clientId} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{c.clientName}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">{c.blobCount.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{fmtBytes(c.bytes)}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
                      {report.totalBytes > 0 ? ((c.bytes / report.totalBytes) * 100).toFixed(1) : "0.0"}%
                    </td>
                    {showCost && <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{cost(c.bytes)}</td>}
                  </tr>
                ))}
                {report.sharedBytes > 0 && (
                  <tr className="bg-zinc-50/50 italic text-[var(--color-text-muted)]">
                    <td className="px-4 py-2.5">Shared / unattributed</td>
                    <td className="px-4 py-2.5 text-right">{report.sharedBlobs.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{fmtBytes(report.sharedBytes)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {report.totalBytes > 0 ? ((report.sharedBytes / report.totalBytes) * 100).toFixed(1) : "0.0"}%
                    </td>
                    {showCost && <td className="px-4 py-2.5 text-right">{cost(report.sharedBytes)}</td>}
                  </tr>
                )}
                {report.clients.length === 0 && (
                  <tr><td colSpan={showCost ? 5 : 4} className="px-4 py-6 text-center text-[var(--color-text-muted)]">No client data stored yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Actual billed usage is on your Vercel dashboard (Storage → Blob → Usage). Grab the current
            per-GB rate from vercel.com/pricing, enter it above, and the table shows each client&apos;s share.
            {report.generatedAt && ` · Calculated ${new Date(report.generatedAt).toLocaleString()}`}
          </p>
        </>
      )}
    </div>
  );
}
