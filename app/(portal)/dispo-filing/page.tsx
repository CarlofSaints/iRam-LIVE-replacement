"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";

/* SharePoint filing — the companion to the DISPO Load Checklist.
   That page answers "was it loaded?"; this one answers "was it also filed?"
   Same grid shape and the same rules the weekly load-status email uses. */

interface Period { year: number; month: number; week: number; key: string; label: string }
interface Cell {
  verdict: string;
  expectedPath: string;
  found?: string[];
  fileCount?: number;
  expectedFiles?: number;
  files?: string[];
  loadedAt?: string;
  loadedBy?: string;
}
interface Row { clientName: string; cells: Record<string, Cell | null> }
interface Summary { checked: number; filed: number; problems: number }
interface Data {
  ran: boolean;
  error?: string;
  rootUrl?: string;
  periods: Period[];
  rows: Row[];
  perPeriod: Record<string, Summary>;
}

// Everything except "filed" needs attention; the shades separate "the file is
// probably there but short" from "there is no folder at all".
const TONE: Record<string, string> = {
  "filed": "bg-green-100 text-green-700 border-green-200",
  "missing files": "bg-amber-100 text-amber-800 border-amber-300",
  "empty week folder": "bg-orange-100 text-orange-800 border-orange-300",
  "no week folder": "bg-red-100 text-red-700 border-red-200",
  "no month folder": "bg-red-100 text-red-700 border-red-200",
  "no year folder": "bg-red-100 text-red-700 border-red-200",
  "no DISPO folder": "bg-red-100 text-red-700 border-red-200",
  "no client folder": "bg-zinc-200 text-zinc-700 border-zinc-300",
};
const LABEL: Record<string, string> = {
  "filed": "✓",
  "missing files": "short",
  "empty week folder": "empty",
  "no week folder": "no W",
  "no month folder": "no M",
  "no year folder": "no Y",
  "no DISPO folder": "no D",
  "no client folder": "no client",
};

/** Turn "CLIENTS/VERIGREEN/DISPO's…/2026/2026-08/WK1" into a clickable link. */
function folderLink(rootUrl: string | undefined, expectedPath: string): string | null {
  if (!rootUrl || !expectedPath.startsWith("CLIENTS/")) return null;
  const rel = expectedPath.slice("CLIENTS/".length);
  return `${rootUrl.replace(/\/$/, "")}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export default function DispoFilingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{ client: string; period: string; cell: Cell } | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/dispo-filing");
      const d = await res.json().catch(() => ({}));
      if (res.ok) setData(d);
      else setError(d.error || "Failed to run the filing check");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">SharePoint Filing</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Every DISPO loaded into iRam LIVE should also be saved in SharePoint under
            {" "}<strong>CLIENTS / &lt;client&gt; / DISPO&rsquo;s &amp; DATA SOURCES / &lt;year&gt; / &lt;year-month&gt; / W&lt;n&gt;</strong>.
            A client only appears in a week it actually loaded a DISPO for, and a week only
            counts as filed once the folder holds <strong>at least one file per DISPO loaded</strong>.
            The same check goes out in the weekday 16:00 load-status email.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data && !data.ran && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <strong>The filing check could not run.</strong> {data.error}
          <div className="mt-1 text-xs text-orange-700">
            Nothing below should be read as &ldquo;not filed&rdquo; — SharePoint could not be reached.
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
          Reading the SharePoint folders… this takes a few seconds.
        </div>
      )}

      {data?.ran && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Client
                </th>
                {data.periods.map((p) => {
                  const s = data.perPeriod[p.key];
                  return (
                    <th key={p.key} className="px-3 py-3 text-center text-xs font-semibold text-[var(--color-text-muted)]">
                      <div className="text-[var(--color-text)]">{p.label}</div>
                      {s && (
                        <div className="mt-0.5 font-normal">
                          <span className="text-green-700">{s.filed} filed</span>
                          {s.problems > 0 && <span className="text-red-600"> · {s.problems} not</span>}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.clientName} className="border-b border-[var(--color-border)] last:border-0 hover:bg-zinc-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-semibold text-[var(--color-text)]">
                    {r.clientName}
                  </td>
                  {data.periods.map((p) => {
                    const c = r.cells[p.key];
                    if (!c) {
                      return (
                        <td key={p.key} className="px-3 py-2.5 text-center">
                          <span className="text-xs text-zinc-300" title="No DISPO loaded for this week">–</span>
                        </td>
                      );
                    }
                    return (
                      <td key={p.key} className="px-3 py-2.5 text-center">
                        <button type="button" onClick={() => setDetail({ client: r.clientName, period: p.label, cell: c })}
                          className={`inline-block min-w-[52px] rounded border px-2 py-1 text-xs font-semibold ${TONE[c.verdict] ?? "bg-zinc-100 text-zinc-600 border-zinc-200"}`}
                          title={`${c.verdict} — click for detail`}>
                          {LABEL[c.verdict] ?? c.verdict}
                        </button>
                        {c.verdict === "missing files" && (
                          <div className="mt-0.5 text-[10px] text-amber-700">{c.fileCount}/{c.expectedFiles}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.ran && data.rows.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
          No DISPO loads in the recent periods, so there is nothing to check.
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text)]">{detail.client}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">{detail.period}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm hover:border-zinc-400">
                Close
              </button>
            </div>

            <p className={`mt-4 inline-block rounded border px-2 py-1 text-xs font-semibold ${TONE[detail.cell.verdict]}`}>
              {detail.cell.verdict}
            </p>

            {detail.cell.expectedFiles != null && (
              <p className="mt-3 text-sm text-[var(--color-text)]">
                <strong>{detail.cell.fileCount ?? 0}</strong> file{(detail.cell.fileCount ?? 0) === 1 ? "" : "s"} in the folder
                for <strong>{detail.cell.expectedFiles}</strong> DISPO{detail.cell.expectedFiles === 1 ? "" : "s"} loaded
                {detail.cell.loadedBy ? ` (last by ${detail.cell.loadedBy})` : ""}.
              </p>
            )}

            <p className="mt-3 text-xs text-[var(--color-text-muted)]">Folder</p>
            <p className="break-all font-mono text-xs text-[var(--color-text)]">{detail.cell.expectedPath}</p>
            {folderLink(data?.rootUrl, detail.cell.expectedPath) && (
              <a href={folderLink(data?.rootUrl, detail.cell.expectedPath)!} target="_blank" rel="noreferrer"
                className="mt-1 inline-block text-xs font-medium text-[var(--color-primary)] hover:underline">
                Open in SharePoint ↗
              </a>
            )}

            {detail.cell.files && detail.cell.files.length > 0 && (
              <>
                <p className="mt-4 text-xs text-[var(--color-text-muted)]">Files present</p>
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text)]">
                  {detail.cell.files.map((f) => <li key={f} className="font-mono break-all">{f}</li>)}
                </ul>
              </>
            )}

            {detail.cell.found && detail.cell.found.length > 0 && (
              <>
                <p className="mt-4 text-xs text-[var(--color-text-muted)]">Folders that ARE there</p>
                <p className="mt-1 text-xs text-[var(--color-text)]">{detail.cell.found.join(", ")}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
