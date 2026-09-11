"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/useAuth";

/* Control Centre → Dropbox.

   Two things lived only as API routes before this page existed, which meant
   neither could actually be used:

   - CONNECT. dropboxConfigGaps() tells people to "click Connect", and there
     was no Connect anywhere in the app. The OAuth callback even redirected to
     /sql-pilot, a page with nothing about Dropbox on it. The alternative to a
     button is running an OAuth exchange by hand and pasting a code between
     two windows before it expires — which is what this was built to avoid.

   - THE SELF TEST. The write path could not be tried without overwriting a
     real client's master file, so it never had been. It now runs against a
     scratch file in its own folder. */

interface Probe {
  ok: boolean;
  account?: string;
  root?: string;
  rootEntries?: number;
  error?: string;
  gaps: string[];
  configuredRoot: string;
  resolvedPath: string;
  teamSpace: boolean | null;
  connectedBy: string | null;
  connectedAt: string | null;
  tokenSource: string;
  /* Objects, not strings. This was declared as string[] by hand and never
     checked against the route, so `{s}` rendered an object as a React child —
     which throws on every render and took the whole page down. A hand-written
     interface over a fetch is a claim, not a check: TypeScript agrees with
     whatever shape you assert. [[api-200-must-keep-its-shape]] */
  sample?: { name: string; size: number; modified: string }[];
  /* Only present when the folder could NOT be listed — the connection is fine
     and the configured path is wrong. This is the most useful thing the probe
     produces and the page used to throw it away. */
  hint?: string;
  topLevel?: string[] | null;
  topLevelError?: string | null;
}

interface Step { name: string; ok: boolean; detail: string }
interface SelfTest { ok: boolean; folder: string | null; steps: Step[]; elapsedMs: number }

function fmtSize(b: number): string {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return Math.round(b / 1e3) + " KB";
  return b + " B";
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function DropboxPageInner() {
  const params = useSearchParams();
  const justConnected = params.get("dropbox") === "connected";

  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [test, setTest] = useState<SelfTest | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/dropbox/probe");
      const d = await res.json();
      if (!res.ok) setError(d.error || "Could not read the Dropbox status.");
      else setProbe(d);
    } catch {
      setError("Network error reading the Dropbox status.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runSelfTest() {
    setTesting(true);
    setTest(null);
    setError("");
    try {
      const res = await authFetch("/api/dropbox/self-test", { method: "POST" });
      const d = await res.json();
      if (!res.ok && !d.steps) setError(d.error || "The self test could not run.");
      else setTest(d);
    } catch {
      setError("Network error running the self test.");
    }
    setTesting(false);
  }

  const connected = !!probe?.ok && probe.gaps.length === 0;

  return (
    <div className="p-8">
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text)]">Dropbox</h1>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        The control files — PMF, LINKS and Ranging — live in Dropbox and are edited there through each
        client&apos;s Dropbox tab. This page says whether that connection is working, and can prove the
        replace path still works without touching a client&apos;s file.
      </p>

      {justConnected && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Dropbox connected.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* ── Connection ─────────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Connection</h2>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:opacity-50">
              {loading ? "Checking…" : "Re-check"}
            </button>
            {/* A plain link, not fetch: this is a 302 out to Dropbox's own
                approval page and back through the callback. */}
            <a href="/api/dropbox/connect"
              className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
              {connected ? "Re-connect Dropbox" : "Connect Dropbox"}
            </a>
          </div>
        </div>

        {loading && !probe && <p className="text-sm text-[var(--color-text-muted)]">Reading Dropbox…</p>}

        {probe && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {connected ? "Connected" : "Not working"}
              </span>
              {probe.error && <span className="text-sm text-red-700">{probe.error}</span>}
            </div>

            {probe.gaps.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <strong>Missing:</strong> {probe.gaps.join(", ")}
                <p className="mt-1 text-xs">
                  The two app credentials are Vercel environment variables and need a redeploy after
                  being added. The account itself is the Connect button above.
                </p>
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Account" value={probe.account ?? "—"} />
              <Row label="Token source" value={probe.tokenSource} />
              <Row label="Connected by" value={probe.connectedBy ?? "—"} />
              <Row label="Connected at" value={when(probe.connectedAt)} />
              <Row label="Team space" value={probe.teamSpace === null ? "—" : probe.teamSpace ? "Yes" : "No"} />
              <Row label="Folders in the root" value={probe.rootEntries === undefined ? "—" : String(probe.rootEntries)} />
              <Row label="Configured root" value={probe.configuredRoot} mono />
              {/* Worth showing beside the configured value: a pasted web URL
                  carries a /work/<Team> prefix that only exists in the browser,
                  and the resolved path is what actually gets used. */}
              <Row label="Resolved to" value={probe.resolvedPath} mono />
            </dl>

            {probe.sample && probe.sample.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
                  What is in that folder ({probe.sample.length})
                </summary>
                <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] p-3 font-mono text-xs text-[var(--color-text-muted)]">
                  {probe.sample.map((e) => (
                    <li key={e.name} className="flex justify-between gap-4">
                      <span className="break-all">{e.name}</span>
                      <span className="shrink-0">{e.size ? fmtSize(e.size) : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* The connection is fine and the path is wrong — say which, and
                show what IS there so the exact spelling can be copied. */}
            {probe.hint && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p>{probe.hint}</p>
                {probe.topLevelError && <p className="mt-1 font-mono text-xs">{probe.topLevelError}</p>}
                {probe.topLevel && probe.topLevel.length > 0 && (
                  <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-amber-200 bg-white p-3 font-mono text-xs text-[var(--color-text-muted)]">
                    {probe.topLevel.map((n) => <li key={n} className="break-all">{n}</li>)}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Self test ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Round-trip self test
          </h2>
          <button onClick={runSelfTest} disabled={testing || !connected}
            title={connected ? "" : "Dropbox is not connected"}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-40">
            {testing ? "Running…" : "Run self test"}
          </button>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">
          Creates a scratch file in <code className="font-mono text-xs">_APP_SELF_TEST_</code>, replaces it
          through the same temporary upload link the Dropbox tab uses, and checks the three things the
          round trip depends on: the file is replaced in place rather than copied, the rev moves, and a
          save against an out-of-date version is refused. The scratch file is deleted afterwards.
          <strong className="text-[var(--color-text)]"> No client file is touched.</strong>
        </p>

        {test && (
          <>
            <div className={`mb-3 rounded-lg px-4 py-2 text-sm font-semibold ${test.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {test.ok ? "All checks passed" : "Something is wrong — see below"}
              <span className="ml-2 font-normal opacity-75">{(test.elapsedMs / 1000).toFixed(1)}s</span>
            </div>
            <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
              {test.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 text-sm font-bold ${s.ok ? "text-green-600" : "text-red-600"}`}>
                    {s.ok ? "✓" : "✕"}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-[var(--color-text)]">{s.name}</span>
                    <span className="block break-all font-mono text-xs text-[var(--color-text-muted)]">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className={`break-all font-medium text-[var(--color-text)] ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

export default function DropboxControlCentrePage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--color-text-muted)]">Loading…</div>}>
      <DropboxPageInner />
    </Suspense>
  );
}
