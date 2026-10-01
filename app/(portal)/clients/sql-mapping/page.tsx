"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SearchSelect from "@/components/SearchSelect";
import { authFetch, usePermissions } from "@/lib/useAuth";
import type { ClientMappingRow, MatchReason } from "@/lib/sqlClientMapping";
import type { SqlClientEntry } from "@/lib/sqlClientNames";

/* Every iRam client beside the SQL Server client it is. The SQL Name is the
   join key for every stored procedure: a wrong one does not error, it quietly
   reads another client's data. So suggestions are pre-filled for a person to
   CHECK, and nothing is saved until they press Save. */

interface MappingResponse {
  configured: boolean;
  error: string | null;
  names: string[];
  entries: SqlClientEntry[];
  rows: ClientMappingRow[];
}

const REASON_TEXT: Record<MatchReason, string> = {
  vendor: "same vendor number",
  exact: "same name",
  name: "similar name",
};

type View = "attention" | "all";

export default function SqlMappingPage() {
  const { can, loaded: permsLoaded } = usePermissions();
  const [data, setData] = useState<MappingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // id → SQL name being edited ("" = not mapped). Only rows that differ from saved are sent.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("attention");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await authFetch("/api/clients/sql-mapping");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setDraft(Object.fromEntries((json as MappingResponse).rows.map((r) => [r.id, r.current ?? ""])));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (permsLoaded && can("manage_clients")) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoaded]);

  const options = useMemo(() => {
    const byName = new Map((data?.entries ?? []).map((e) => [e.name, e]));
    return (data?.names ?? []).map((n) => {
      const e = byName.get(n);
      const vendors = e?.vendorCodes.length ? ` · vendor ${e.vendorCodes.join(", ")}` : "";
      return { value: n, label: `${n}${vendors}` };
    });
  }, [data]);

  const rows = data?.rows ?? [];
  const isChanged = (r: ClientMappingRow) => (draft[r.id] ?? "") !== (r.current ?? "");
  const needsAttention = (r: ClientMappingRow) =>
    !r.current || r.currentOnList === false ||
    (r.suggestion != null && r.suggestion.sqlName !== r.current) || isChanged(r);

  const counts = {
    mapped: rows.filter((r) => r.current && r.currentOnList !== false).length,
    unmapped: rows.filter((r) => !r.current).length,
    stale: rows.filter((r) => r.currentOnList === false).length,
    disagree: rows.filter((r) => r.current && r.suggestion && r.suggestion.sqlName !== r.current).length,
  };

  // Suggestions that would fill an EMPTY mapping. A disagreement with an
  // existing mapping is left for a person to look at row by row.
  const fillable = rows.filter((r) => !r.current && r.suggestion && (draft[r.id] ?? "") === "");
  const changed = rows.filter(isChanged);

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => view === "all" || needsAttention(r))
    .filter((r) => !q ||
      r.name.toLowerCase().includes(q) ||
      (r.current ?? "").toLowerCase().includes(q) ||
      (draft[r.id] ?? "").toLowerCase().includes(q) ||
      r.vendorNumbers.some((v) => v.toLowerCase().includes(q)));

  function applySuggestions() {
    setDraft((d) => {
      const next = { ...d };
      for (const r of fillable) next[r.id] = r.suggestion!.sqlName;
      return next;
    });
    setMessage(null);
  }

  async function save() {
    if (changed.length === 0 || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/clients/sql-mapping", {
        method: "PUT",
        body: JSON.stringify({
          changes: changed.map((r) => ({ id: r.id, sqlClientName: draft[r.id] || null })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMessage({ ok: true, text: `Saved the SQL Name for ${json.saved} client(s).` });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setSaving(false);
  }

  if (permsLoaded && !can("manage_clients")) {
    return <div className="p-8 text-sm text-[var(--color-text-muted)]">You do not have permission to manage clients.</div>;
  }

  return (
    <div className="p-8">
      <div className="mb-2 text-sm">
        <Link href="/clients" className="text-[var(--color-primary)] hover:underline">← Clients</Link>
      </div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">SQL Name mapping</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={applySuggestions} disabled={loading || fillable.length === 0}
            title="Fill every unmapped client that has exactly one suggested match. Nothing is saved until you press Save."
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-40">
            Fill {fillable.length} suggestion{fillable.length === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={() => { setDraft(Object.fromEntries(rows.map((r) => [r.id, r.current ?? ""]))); setMessage(null); }}
            disabled={changed.length === 0 || saving}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-40">
            Undo changes
          </button>
          <button type="button" onClick={save} disabled={changed.length === 0 || saving}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
            {saving ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-[var(--color-text-muted)]">
        Each iRam client needs the name SQL Server knows it by, or nothing can read its data from SQL.
        A wrong name does not show an error. It reads another client&apos;s data. Check every suggestion before you save.
      </p>

      {message && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${message.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-white px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
          Reading the client list from SQL Server…
        </div>
      ) : loadError || data?.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium">The client list could not be read from SQL Server, so nothing can be mapped right now.</div>
          <div className="mt-1 break-words font-mono text-[11px]">{loadError || data?.error}</div>
          <button type="button" onClick={load} className="mt-2 text-xs font-medium underline">Try again</button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-green-50 px-3 py-1 text-green-800">Mapped {counts.mapped}</span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-[var(--color-text)]">Not mapped {counts.unmapped}</span>
            {counts.stale > 0 && <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">Name no longer in SQL {counts.stale}</span>}
            {counts.disagree > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Suggestion differs {counts.disagree}</span>}
            <span className="text-[var(--color-text-muted)]">{data?.names.length ?? 0} names in SQL Server</span>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-[var(--color-border)] bg-white p-1">
              {(["attention", "all"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                  {v === "attention" ? `Needs a look (${rows.filter(needsAttention).length})` : `All clients (${rows.length})`}
                </button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search client, SQL name or vendor…"
              className="w-72 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-white">
            {shown.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
                {view === "attention" && !q ? "Every client is mapped and agrees with the evidence." : "No clients match."}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="px-6 py-3">iRam client</th>
                    <th className="px-6 py-3">Vendor numbers</th>
                    <th className="px-6 py-3">SQL Name</th>
                    <th className="px-6 py-3">Suggested match</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const value = draft[r.id] ?? "";
                    const changedRow = isChanged(r);
                    const staleShown = r.currentOnList === false && value === r.current;
                    return (
                      <tr key={r.id} className={`border-b border-[var(--color-border)] last:border-0 align-top ${changedRow ? "bg-blue-50/50" : ""}`}>
                        <td className="px-6 py-3">
                          <Link href={`/clients/${r.id}`} className="font-medium text-[var(--color-primary)] hover:underline">{r.name}</Link>
                          {!r.active && <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">Archived</div>}
                        </td>
                        <td className="px-6 py-3 text-[var(--color-text-muted)]">{r.vendorNumbers.join(", ") || "—"}</td>
                        <td className="px-6 py-3">
                          <SearchSelect value={value} options={options} widthClass="w-80"
                            allLabel="Not mapped" searchLabel="SQL client names"
                            onChange={(v) => { setDraft((d) => ({ ...d, [r.id]: v })); setMessage(null); }} />
                          {changedRow && (
                            <div className="mt-1 text-xs text-blue-700">
                              Unsaved. Was: {r.current ?? "not mapped"}
                            </div>
                          )}
                          {staleShown && (
                            <div className="mt-1 text-xs text-red-700">
                              &quot;{r.current}&quot; is no longer on SQL Server&apos;s list. Pick the right name.
                            </div>
                          )}
                          {r.sharedWith.length > 0 && (
                            <div className="mt-1 text-xs text-amber-800">
                              Also mapped here: {r.sharedWith.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          {r.suggestion ? (
                            r.suggestion.sqlName === value ? (
                              <span className="text-xs text-green-700">✓ {r.suggestion.sqlName} ({REASON_TEXT[r.suggestion.reason]})</span>
                            ) : (
                              <div className="text-xs">
                                <span className="font-medium">{r.suggestion.sqlName}</span>
                                <span className="text-[var(--color-text-muted)]"> ({REASON_TEXT[r.suggestion.reason]})</span>
                                <button type="button" className="ml-2 font-medium text-[var(--color-primary)] underline"
                                  onClick={() => { setDraft((d) => ({ ...d, [r.id]: r.suggestion!.sqlName })); setMessage(null); }}>
                                  Use this
                                </button>
                              </div>
                            )
                          ) : r.candidates.length > 0 ? (
                            <div className="text-xs text-amber-800">
                              {r.candidates.length} possible matches ({REASON_TEXT[r.candidates[0].reason]}):{" "}
                              {r.candidates.map((c, i) => (
                                <span key={c.sqlName}>
                                  {i > 0 && ", "}
                                  <button type="button" className="underline"
                                    onClick={() => { setDraft((d) => ({ ...d, [r.id]: c.sqlName })); setMessage(null); }}>
                                    {c.sqlName}
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">No match found in SQL Server</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
