"use client";

/* "Why didn't rep X get their report?" — on a screen instead of in a console.
 *
 * The audit ledger has recorded every check-in outcome and its reason since
 * July, and /api/store-reports/audit has always been able to answer this. It
 * had no UI, so answering the question meant someone hand-crafting a URL — and
 * in practice nobody did, which is how the auto-send poller sat switched off
 * for three days in September 2026 while reps reported missing emails and the
 * cause was assumed to be store-code mismatches.
 *
 * Deliberately its own component rather than more of the store-reports page,
 * which is already several tools deep in one file.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/useAuth";

interface AuditRow {
  id: string;
  day: string;
  at: string;
  siteCode: string;
  store: string;
  channel: string;
  repEmail: string;
  repName: string;
  status: string;
  actions?: number;
  detail?: string;
}

interface AuditResponse {
  day: string;
  total: number;
  byStatus: Record<string, number>;
  rows: AuditRow[];
}

/* Plain-English reason per outcome, and whether it needs someone to act.
   The raw status codes are the runner's vocabulary, not a reader's. */
const STATUS_META: Record<string, { label: string; help: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  "sent": { label: "Sent", help: "The rep received their report.", tone: "good" },
  "would-send": { label: "Would send (dry run)", help: "A dry run — nothing was actually sent.", tone: "muted" },
  "skipped-duplicate": { label: "Already sent today", help: "Working as intended: one report per store per rep per day.", tone: "muted" },
  "skipped-no-data": {
    label: "Nothing to report",
    help: "The store matched loaded data, but no product needed action. A genuinely clean store.",
    tone: "muted",
  },
  "skipped-no-mapping": {
    label: "Site not in any loaded DISPO",
    help: "Either the site code differs from the DISPO's, or that channel's data is not loaded at all. Check Site Code Check first, then whether the channel has a current DISPO.",
    tone: "bad",
  },
  "skipped-no-sitecode": { label: "Visit had no site code", help: "Perigee sent a check-in with no store on it.", tone: "bad" },
  "skipped-no-email": { label: "Rep has no email", help: "Perigee has no email address for this rep.", tone: "bad" },
  "skipped-channel": { label: "Channel not allowed", help: "This Perigee channel is not in the Sync Settings allow-list.", tone: "warn" },
  "failed": { label: "Failed", help: "The report could not be built or sent. See the detail.", tone: "bad" },
};

function meta(status: string) {
  return STATUS_META[status] ?? { label: status, help: "", tone: "muted" as const };
}

const TONE_CLASS: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  muted: "bg-zinc-50 text-zinc-600 border-[var(--color-border)]",
};

function today(): string {
  // SAST day, matching the ledger's own day key.
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function time(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
}

export default function StoreReportAuditPanel() {
  const [day, setDay] = useState(today());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/store-reports/audit?day=${encodeURIComponent(d)}`);
      if (res.status === 401) {
        setError("Your session has expired — sign in again.");
        setData(null);
      } else if (!res.ok) {
        setError("Could not load the audit for that day.");
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

  useEffect(() => { load(day); }, [day, load]);

  /* Filtering happens here rather than by re-querying: a day is a few hundred
     rows and a round trip per keystroke is the wrong trade. */
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return (
        r.siteCode.toLowerCase().includes(q) ||
        r.store.toLowerCase().includes(q) ||
        r.repEmail.toLowerCase().includes(q) ||
        r.repName.toLowerCase().includes(q) ||
        r.channel.toLowerCase().includes(q)
      );
    });
  }, [data, search, status]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-5">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Why a rep did or didn&apos;t get a report</h2>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">
        Every Perigee check-in the poller processed, and what happened to it. Search a rep&apos;s name,
        email or a store code.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Day</label>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rep name, email, store code…"
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => load(day)}
          disabled={loading}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {data && (
        <>
          {/* Counts per reason, doubling as the status filter. */}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setStatus("")}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium " +
                (status === "" ? "border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]" : TONE_CLASS.muted)
              }
            >
              All {data.total}
            </button>
            {Object.entries(data.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => {
                const m = meta(s);
                const on = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(on ? "" : s)}
                    title={m.help}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium " +
                      (on ? "border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]" : TONE_CLASS[m.tone])
                    }
                  >
                    {m.label} {n}
                  </button>
                );
              })}
          </div>

          {/* The single most important thing this panel can say. */}
          {data.total === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <b>No check-in was processed at all on this day.</b> That is not a store or a mapping
              problem — it means the poller did not run. Check <b>Auto-send</b> above: if it is off,
              no rep receives anything, however good the data is. Also worth checking that the day
              had visits in Perigee at all.
            </div>
          )}

          {data.total > 0 && rows.length === 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-zinc-50 p-4 text-sm text-[var(--color-text-muted)]">
              {data.total} check-in{data.total === 1 ? " was" : "s were"} processed on this day, but
              none match this search. The rep may not have checked in — an absent row means Perigee
              never reported a visit, which is a different thing from a report being skipped.
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">Site</th>
                    <th className="px-4 py-2">Store</th>
                    <th className="px-4 py-2">Channel</th>
                    <th className="px-4 py-2">Rep</th>
                    <th className="px-4 py-2">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = meta(r.status);
                    return (
                      <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-[var(--color-text-muted)]">{time(r.at)}</td>
                        <td className="px-4 py-2 font-mono font-medium">{r.siteCode || "—"}</td>
                        <td className="px-4 py-2 text-[var(--color-text-muted)]">{r.store || "—"}</td>
                        <td className="px-4 py-2 text-[var(--color-text-muted)]">{r.channel || "—"}</td>
                        <td className="px-4 py-2">
                          <div>{r.repName || "—"}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{r.repEmail || "no email"}</div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={"inline-block rounded-full border px-2 py-0.5 text-xs font-medium " + TONE_CLASS[m.tone]}>
                            {m.label}
                            {r.status === "sent" && r.actions !== undefined ? ` · ${r.actions} actions` : ""}
                          </span>
                          {m.help && (
                            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{m.help}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            A rep with no row here did not have a check-in processed. That is different from a
            skipped report: check Perigee actually recorded the visit, and that the poller was
            running at the time.
          </p>
        </>
      )}
    </div>
  );
}
