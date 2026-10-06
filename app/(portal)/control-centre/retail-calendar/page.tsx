"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import { isRetailYearLoaded, weeksInRetailMonth } from "@/lib/retailCalendar";
import { invalidateRetailCalendar, loadRetailCalendar } from "@/lib/useRetailCalendar";
import type { RetailCalendarYear } from "@/lib/retailCalendarData";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Preview {
  fileName: string;
  year: number;
  weeks: number[];
  monthEndWeeks: number[];
  jan1Weekday: number | null;
  problems: string[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });

export default function RetailCalendarPage() {
  const thisYear = new Date().getFullYear();
  const [years, setYears] = useState<RetailCalendarYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(thisYear + 1);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  async function load() {
    try {
      setYears(await loadRetailCalendar());
    } catch (e) {
      setError(`Couldn't load the saved calendars: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  /* Every call goes through here so a non-JSON reply (Vercel's 413 page for a
     PDF over ~4.5MB, a 504) says what happened instead of "Network error". */
  async function call(url: string, init: Parameters<typeof authFetch>[1], fallback: string) {
    let res: Response;
    try {
      res = await authFetch(url, init);
    } catch {
      return { ok: false as const, error: "Couldn't reach the server. Check your connection and try again." };
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body) return { ok: true as const, body };
    const why = body?.error
      ?? (res.status === 413 ? "That file is too big to upload (limit about 4.5MB)."
        : `${fallback} (server said ${res.status}).`);
    return { ok: false as const, error: why };
  }

  async function readPdf(file: File) {
    setError("");
    setPreview(null);
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("year", String(year));
    const r = await call("/api/retail-calendar", { method: "POST", body: form, rawBody: true, headers: {} }, "Couldn't read that file");
    if (r.ok) setPreview(r.body); else setError(r.error);
    setBusy(false);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setError("");
    const r = await call("/api/retail-calendar", {
      method: "PUT",
      body: JSON.stringify({
        year: preview.year,
        weeks: preview.weeks,
        fileName: preview.fileName,
        printedJan1Weekday: preview.jan1Weekday,
      }),
    }, "Save failed");
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    invalidateRetailCalendar();
    flash(`${preview.year} calendar saved. Data Load and Reports now use it.`);
    setPreview(null);
    await load();
  }

  async function remove(y: number) {
    if (confirmDelete !== y) { setConfirmDelete(y); return; }
    setConfirmDelete(null);
    setError("");
    const r = await call(`/api/retail-calendar?year=${y}`, { method: "DELETE" }, "Remove failed");
    if (!r.ok) { setError(r.error); return; }
    invalidateRetailCalendar();
    flash(`${y} calendar removed.`);
    await load();
  }

  // Always show this year and next, so a missing year is visible, not absent.
  const shownYears = [...new Set([thisYear, thisYear + 1, ...years.map((y) => y.year)])].sort();
  const byYear = new Map(years.map((y) => [y.year, y]));

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">Retail Calendar</h1>

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Massmart reports on a 4-5-4 retail calendar, so only some months have a Week 5. Load each year&apos;s
        <strong> Massmart Planning Calendar PDF</strong> when it comes out. The Data Load and Reports week
        lists then offer only the weeks each month really has.
      </div>

      {toast && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-8 rounded-xl border border-[var(--color-border)] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">Load a calendar</h2>
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-[var(--color-text)]">Year this calendar is for</label>
          <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setPreview(null); }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <UploadZone
          onFile={readPdf}
          accept=".pdf"
          label={busy ? "Reading…" : `Drop the Massmart ${year} Planning Calendar PDF here`}
          disabled={busy}
        />

        {preview && (
          <div className="mt-6">
            <p className="mb-2 text-sm text-[var(--color-text)]">
              Read from <strong>{preview.fileName}</strong>. Check the weeks per month, then save.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    {MON.map((m) => <th key={m} className="px-3 py-1 text-center">{m}</th>)}
                    <th className="px-3 py-1 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {preview.weeks.map((w, i) => (
                      <td key={i} className={`px-3 py-1 text-center font-semibold ${w === 5 ? "text-[var(--color-primary)]" : ""}`}>{w}</td>
                    ))}
                    <td className="px-3 py-1 text-center font-semibold">{preview.weeks.reduce((a, b) => a + b, 0)}</td>
                  </tr>
                  <tr className="text-xs text-[var(--color-text-muted)]">
                    {preview.monthEndWeeks.map((w, i) => <td key={i} className="px-3 py-1 text-center">ends wk {w}</td>)}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {preview.problems.length > 0 ? (
              <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
                Can&apos;t save this as {preview.year}:
                <ul className="ml-5 list-disc">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            ) : (
              <button onClick={save} disabled={busy}
                className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                Save {preview.year} calendar
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Weeks per month in use</h2>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-6 py-3">Year</th>
                  {MON.map((m) => <th key={m} className="px-2 py-3 text-center">{m}</th>)}
                  <th className="px-6 py-3">Source</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {shownYears.map((y) => {
                  const entry = byYear.get(y);
                  const known = isRetailYearLoaded(y);
                  return (
                    <tr key={y} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-6 py-3 font-medium">{y}</td>
                      {MON.map((_, i) => {
                        const w = weeksInRetailMonth(y, i + 1);
                        return <td key={i} className={`px-2 py-3 text-center ${w === 5 ? "font-semibold text-[var(--color-primary)]" : ""} ${known ? "" : "text-[var(--color-text-muted)]"}`}>{w}</td>;
                      })}
                      <td className="px-6 py-3 text-[var(--color-text-muted)]">
                        {entry ? <>From <strong>{entry.fileName}</strong>, loaded {fmt(entry.loadedAt)} by {entry.loadedBy}</>
                          : known ? "Built in (2026 printed calendar)"
                          : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not loaded: assuming standard 4-5-4</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {entry && (
                          <button onClick={() => remove(y)} className="text-xs font-medium text-red-600 hover:underline">
                            {confirmDelete === y ? "Click again to remove" : "Remove"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
