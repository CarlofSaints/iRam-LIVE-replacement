"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import DropboxSetup from "./DropboxSetup";

/* Download a control file from Dropbox, edit it, put it back.

   Two things this screen has to be honest about, because getting either wrong
   loses someone's work or their trust:

   1. Saving to Dropbox does NOT update SQL. Mark's process polls every couple
      of minutes. In between, an exported report looks completely normal and
      quietly contains the OLD data. So the save is not reported as finished
      until SQL actually shows the change — and until then the screen says so
      in as many words.

   2. The Dropbox account is shared, so two people are the same user to
      Dropbox. If the file moved on since it was downloaded, the save is
      refused rather than flattening whoever went first. */

interface ControlFile {
  kind: string | null;
  label: string;
  feeds: string;
  name: string;
  path: string;
  rev: string;
  size: number;
  modified: string;
  verifiable: boolean;
}

interface Listing {
  clientName: string;
  sqlClientName: string | null;
  folder: string | null;
  matchedFolderName?: string;
  files: ControlFile[];
  error?: string;
  /* No folder configured yet, as opposed to configured-and-broken. The two
     need different next steps, so the API distinguishes them. */
  needsSetup?: boolean;
}

interface SyncState {
  state: "waiting" | "synced" | "timeout" | "unverifiable";
  note: string;
  fileName: string;
  elapsedMs: number;
  timeoutMs: number;
  safeToExport: boolean;
  beforeRows: number | null;
  afterRows: number | null;
}

function fmtSize(b: number): string {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return Math.round(b / 1e3) + " KB";
  return b + " B";
}

function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

export default function DropboxControlFiles({
  clientId,
  clientName,
  dropboxFolder,
  dropboxFiles,
  onSetupSaved,
}: {
  clientId: string;
  clientName: string;
  dropboxFolder?: string;
  dropboxFiles?: Record<string, string>;
  onSetupSaved?: () => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sync, setSync] = useState<SyncState | null>(null);
  const [jobId, setJobId] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/dropbox/control-files?clientId=${encodeURIComponent(clientId)}`);
      const d = await res.json();
      if (!res.ok) setError(d.error || "Could not read the Dropbox folder.");
      else setListing(d);
    } catch {
      setError("Network error reading Dropbox.");
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  /* Stop polling when this unmounts, otherwise a tab left open keeps hitting
     SQL through the shared proxy every 20 seconds forever. */
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await authFetch(`/api/dropbox/sync-status?job=${encodeURIComponent(id)}`);
        const d: SyncState = await res.json();
        if (!res.ok) return;
        setSync(d);
        if (d.state !== "waiting" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* a dropped poll is not worth surfacing; the next one retries */ }
    };
    tick();
    pollRef.current = setInterval(tick, 20000);
  }

  async function download(f: ControlFile) {
    setBusy(f.path); setError("");
    try {
      const res = await authFetch(
        `/api/dropbox/control-files/link?clientId=${encodeURIComponent(clientId)}&path=${encodeURIComponent(f.path)}`,
      );
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Could not get a download link."); setBusy(""); return; }
      /* Straight from Dropbox — a 20MB workbook never touches this app. */
      window.location.href = d.url;
    } catch {
      setError("Network error starting the download.");
    }
    setBusy("");
  }

  async function upload(f: ControlFile, file: File) {
    setBusy(f.path); setError(""); setSync(null); setJobId("");
    try {
      const startRes = await authFetch("/api/dropbox/control-files/upload-link", {
        method: "POST",
        body: JSON.stringify({ clientId, path: f.path, rev: f.rev }),
      });
      const start = await startRes.json();
      if (!startRes.ok) { setError(start.error || "Could not start the upload."); setBusy(""); return; }

      /* Browser straight to Dropbox. Vercel caps a request body at ~4.5MB and
         these files run past 20MB, so this must not go through our own API. */
      const put = await fetch(start.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!put.ok) {
        const t = await put.text();
        setError(
          t.includes("conflict")
            ? `"${f.name}" changed in Dropbox while you were editing, so it was not overwritten. Download it again and redo the edit.`
            : `Dropbox refused the upload (${put.status}).`,
        );
        setBusy(""); return;
      }

      const done = await authFetch("/api/dropbox/control-files/complete", {
        method: "POST",
        body: JSON.stringify({ jobId: start.jobId, previousRev: f.rev }),
      });
      const d = await done.json();
      if (!done.ok) { setError(d.error || "The upload did not land."); setBusy(""); return; }

      setJobId(start.jobId);
      startPolling(start.jobId);
      await load();
    } catch {
      setError("Network error during the upload.");
    }
    setBusy("");
  }

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Reading Dropbox…</p>;

  if (error && !listing) {
    return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  }

  /* Nothing is set up yet, or what was set up no longer opens. Either way the
     useful thing is the picker, not a message — this used to be a dead end
     that said "no folder found" and offered nothing to do about it. */
  if (listing && !listing.folder) {
    return (
      <div className="space-y-4">
        <div className={`rounded-lg border px-4 py-3 text-sm ${listing.needsSetup
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-red-200 bg-red-50 text-red-700"}`}>
          {listing.error}
        </div>
        <DropboxSetup
          clientId={clientId}
          clientName={listing.clientName}
          initialFolder={dropboxFolder}
          initialFiles={dropboxFiles}
          onSaved={() => { onSetupSaved?.(); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text)]">Control files in Dropbox</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          These files live in Dropbox and are the single copy. Download one, edit it, and upload it
          back — it replaces the same file. A process then carries the change into SQL, and this page
          waits and tells you when that has happened.
        </p>
        {listing?.folder && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-[var(--color-text-muted)]">{listing.folder}</p>
            <button type="button" onClick={() => setSetupOpen((v) => !v)}
              className="text-xs font-medium text-[var(--color-primary)] hover:underline">
              {setupOpen ? "Hide setup" : "Change folder / files"}
            </button>
          </div>
        )}

        {setupOpen && listing?.folder && (
          <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-zinc-50 p-4">
            <DropboxSetup
              clientId={clientId}
              clientName={listing.clientName}
              initialFolder={dropboxFolder || listing.folder}
              initialFiles={dropboxFiles}
              onSaved={() => { onSetupSaved?.(); setSetupOpen(false); load(); }}
            />
          </div>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {listing?.error && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{listing.error}</div>
      )}

      {sync && <SyncBanner sync={sync} jobId={jobId} />}

      {listing?.files.length ? (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Changed</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listing.files.map((f) => (
                <tr key={f.path} className="border-t border-[var(--color-border)] align-middle">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text)]">{f.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{f.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{f.feeds}</div>
                    {!f.verifiable && (
                      <div className="mt-1 text-xs text-amber-700">
                        No stored procedure behind this one yet, so the app cannot confirm when SQL picks it up.
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-muted)]">{fmtSize(f.size)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-muted)]">{fmtWhen(f.modified)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => download(f)} disabled={!!busy}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50">
                        {busy === f.path ? "Working…" : "Download"}
                      </button>
                      <label className={`cursor-pointer rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-primary-dark)] ${busy ? "pointer-events-none opacity-50" : ""}`}>
                        Upload replacement
                        <input type="file" accept=".xlsx,.xls" className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) upload(f, file);
                          }} />
                      </label>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !listing?.error && <p className="text-sm text-[var(--color-text-muted)]">No control files in this folder.</p>
      )}
    </div>
  );
}

/* The waiting state, and the reason this screen exists.

   "Saved" is the answer people act on, so it is deliberately not shown until
   SQL actually has the change — otherwise someone exports a Month-End thirty
   seconds later and gets the old numbers with nothing to tell them why. */
function SyncBanner({ sync, jobId }: { sync: SyncState; jobId: string }) {
  const secs = Math.round(sync.elapsedMs / 1000);
  const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;

  if (sync.state === "synced") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-semibold text-green-900">SQL has your change — safe to export</p>
        <p className="mt-1 text-sm text-green-800">{sync.note}</p>
        <p className="mt-1 text-xs text-green-700">
          {sync.fileName} · took {elapsed}
          {sync.beforeRows !== null && sync.afterRows !== null && ` · ${sync.beforeRows} → ${sync.afterRows} rows`}
        </p>
      </div>
    );
  }

  if (sync.state === "timeout") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-900">SQL has not picked this up</p>
        <p className="mt-1 text-sm text-red-800">{sync.note}</p>
        <p className="mt-1 text-xs text-red-700">Your file IS saved in Dropbox. Job {jobId.slice(0, 8)}.</p>
      </div>
    );
  }

  if (sync.state === "unverifiable") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Saved to Dropbox — cannot confirm SQL</p>
        <p className="mt-1 text-sm text-amber-800">{sync.note}</p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((sync.elapsedMs / sync.timeoutMs) * 100));
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold text-blue-900">
        Saved to Dropbox — waiting for SQL to catch up
      </p>
      <p className="mt-1 text-sm text-blue-800">
        <strong>Do not export a report yet.</strong> The change is in Dropbox but SQL has not taken it
        on board, so a report run now would still show the old data. This usually takes about two
        minutes and this page will tell you the moment it is safe.
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-200">
        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-blue-700">
        {sync.fileName} · waiting {elapsed} · checking every 20 seconds
      </p>
    </div>
  );
}
