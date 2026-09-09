"use client";

import { useEffect, useState, FormEvent } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import SearchSelect from "@/components/SearchSelect";
import Link from "next/link";
import { authFetch, useAuth, usePermissions } from "@/lib/useAuth";
import type { Client, Channel, CAM, ControlFileType } from "@/lib/types";
import { CLIENT_REQUEST_CHECKLIST, emptyChecklist } from "@/lib/clientRequestChecklist";

/* The whole "Email OJ" request in one shape, used for the initial state, for
   the reset after a send, and posted as-is. One object rather than a field
   list in three places, so a new question cannot be added to the form and
   then quietly dropped from the reset or the body. */
function emptyRequest() {
  return { clientName: "", vendorNumbers: "", channels: "", notes: "", ...emptyChecklist() };
}

/* The client names SQL Server holds for iRam LIVE. Nobody types a client name
   into this app any more — a typed name is how iRam and SQL drifted apart in
   the first place (only 1 of 30 matched by exact string), and a wrong name is
   indistinguishable from "SQL has no data for this client". */
interface SqlClientRef { name: string; id: string; active: boolean }
interface SqlNamesResponse {
  configured: boolean;
  names: string[];
  error: string | null;
  taken: SqlClientRef[];
  /* Per SQL name: the iRam client that certainly owns it, and the one that
     probably does under a longer legal name ("BISCO" here, "BISCO PLUS"
     there). Only 1 of the 19 SQL names matches an iRam client by string, so
     the second list is the normal case, not the edge case. */
  match?: { sqlName: string; taken: SqlClientRef[]; likely: SqlClientRef[] }[];
}

interface PurgeItem { label: string; blobCount: number; bytes: number }
interface PurgePreview {
  clientId: string;
  clientName: string;
  items: PurgeItem[];
  totalBlobs: number;
  totalBytes: number;
  uploadCount: number;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

/** Excel wants a date it can sort and filter, not a pretty one. */
function xlDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const CONTROL_FILE_COLUMNS: [ControlFileType, string][] = [
  ["pmf", "PMF"], ["links", "LINKS"], ["ranging", "Ranging"],
  ["custom_sites", "Custom Sites"], ["promotions", "Promotions"],
];

export default function ClientsPage() {
  const { can } = usePermissions();
  const { user } = useAuth();
  const canManage = can("manage_clients");
  const canDelete = can("delete_clients");
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cams, setCams] = useState<CAM[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", vendorNumbers: "", camId: "", channelIds: [] as string[], notes: "",
  });
  const [error, setError] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");

  // The SQL name list, fetched when the add form is opened rather than on
  // every visit — it is a live call to SQL Server and most visits only read.
  const [sqlNames, setSqlNames] = useState<SqlNamesResponse | null>(null);
  const [namesLoading, setNamesLoading] = useState(false);
  const [nameNotice, setNameNotice] = useState("");

  // "Email OJ" — the way out when the client genuinely is not on the list.
  const [showRequest, setShowRequest] = useState(false);
  const [reqForm, setReqForm] = useState(emptyRequest);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [toast, setToast] = useState("");

  // Delete flow: preview what will be destroyed, then require the exact name.
  const [delTarget, setDelTarget] = useState<Client | null>(null);
  const [delPreview, setDelPreview] = useState<PurgePreview | null>(null);
  const [delConfirm, setDelConfirm] = useState("");
  const [delError, setDelError] = useState("");
  const [deleting, setDeleting] = useState(false);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  async function toggleArchive(c: Client) {
    const archiving = c.active;
    if (archiving && !confirm(
      `Archive ${c.name}?\n\nAll data is kept and stays available in Reports and Charts, but ${c.name} will drop out of the DISPO checklist, the load-status email, store reports and all upload dropdowns.`,
    )) return;
    setBusyId(c.id);
    setError("");
    try {
      const res = await authFetch(`/api/clients/${c.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: archiving }),
      });
      if (res.ok) {
        flash(archiving ? `${c.name} archived — data kept` : `${c.name} restored`);
        await load();
      } else {
        setError((await res.json().catch(() => ({}))).error || "Failed");
      }
    } catch {
      setError("Network error");
    }
    setBusyId("");
  }

  async function openDelete(c: Client) {
    setDelTarget(c);
    setDelPreview(null);
    setDelConfirm("");
    setDelError("");
    try {
      const res = await authFetch(`/api/clients/${c.id}/purge-preview`);
      if (res.ok) setDelPreview(await res.json());
      else setDelError((await res.json().catch(() => ({}))).error || "Could not read what this client owns");
    } catch {
      setDelError("Could not read what this client owns — check your connection before deleting");
    }
  }

  async function confirmDelete() {
    if (!delTarget) return;
    setDeleting(true);
    setDelError("");
    try {
      const res = await authFetch(
        `/api/clients/${delTarget.id}?confirm=${encodeURIComponent(delConfirm.trim())}`,
        { method: "DELETE" },
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        flash(
          `${delTarget.name} deleted — ${d.deletedBlobs ?? 0} object(s), ${fmtBytes(d.totalBytes ?? 0)} freed` +
          (d.failed?.length ? ` (${d.failed.length} object(s) failed to delete)` : ""),
        );
        setDelTarget(null);
        await load();
      } else {
        setDelError(d.error || "Delete failed");
      }
    } catch {
      setDelError("Network error");
    }
    setDeleting(false);
  }

  async function load() {
    const [cRes, chRes, camRes] = await Promise.all([
      authFetch("/api/clients?scope=all"),
      authFetch("/api/channels"),
      authFetch("/api/cams"),
    ]);
    if (cRes.ok) setClients(await cRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    if (camRes.ok) setCams(await camRes.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function loadSqlNames() {
    setNamesLoading(true);
    try {
      const res = await authFetch("/api/clients/sql-names");
      if (res.ok) setSqlNames(await res.json());
      else setSqlNames({
        configured: false, names: [], taken: [],
        error: (await res.json().catch(() => ({}))).error || `The client list could not be read (${res.status}).`,
      });
    } catch {
      setSqlNames({ configured: false, names: [], taken: [], error: "Could not reach the server to read the client list." });
    }
    setNamesLoading(false);
  }

  // Opening the form is what asks SQL Server for the list; closing and
  // reopening re-reads it, so a client added at the source shows up without a
  // page reload.
  function toggleForm() {
    const opening = !showForm;
    setShowForm(opening);
    setError("");
    setNameNotice("");
    if (opening) loadSqlNames();
  }

  // Keyed on the SQL name, which is what the picker offers.
  const matchByName = new Map(
    (sqlNames?.match ?? []).map((m) => [m.sqlName.trim().toUpperCase(), m]),
  );
  const takenNames = new Map(
    (sqlNames?.match ?? [])
      .filter((m) => m.taken.length > 0)
      .map((m) => [m.sqlName.trim().toUpperCase(), m.taken[0]]),
  );

  function pickClientName(name: string) {
    setNameNotice("");
    if (!name) { setForm((f) => ({ ...f, name: "" })); return; }
    const m = matchByName.get(name.trim().toUpperCase());
    const already = m?.taken[0];
    if (already) {
      // Adding it twice would split the client's data across two records, and
      // an archived client still owns its name.
      setNameNotice(
        `${name} is already on iRam LIVE${already.active ? "" : " (archived — restore it instead of adding it again)"}.`,
      );
      return;
    }
    /* A likely duplicate under a longer name is a WARNING, not a block. It is
       a guess, and the person adding the client knows whether it is the same
       company; being wrong the other way would stop a legitimate add. */
    if (m && m.likely.length > 0) {
      setNameNotice(
        `iRam LIVE already has ${m.likely.map((l) => `"${l.name}"`).join(" and ")}. ` +
        `If that is the same company, do NOT add "${name}" as a second client — open the existing one and ` +
        `rename it to "${name}" instead, which keeps its data and maps it to SQL.`,
      );
    }
    setForm((f) => ({ ...f, name }));
  }

  async function sendClientRequest(e: FormEvent) {
    e.preventDefault();
    setReqError("");
    if (!reqForm.clientName.trim()) { setReqError("The client name is the one thing this has to carry."); return; }
    setReqBusy(true);
    try {
      const res = await authFetch("/api/clients/request", {
        method: "POST",
        body: JSON.stringify(reqForm),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowRequest(false);
        setReqForm(emptyRequest());
        flash(`Sent to ${d.to ?? "OuterJoin"} — they will reply to you directly`);
      } else {
        setReqError(d.error || "The request could not be sent.");
      }
    } catch {
      setReqError("Network error — the request was not sent.");
    }
    setReqBusy(false);
  }

  const mainChannels = channels.filter((c) => !c.parentId);
  const subChannels = channels.filter((c) => c.parentId);

  /** Derive main channel names for a client from its assigned sub-channel IDs */
  function clientMainChannelNames(client: Client): string[] {
    return mainChannels
      .filter(
        (main) =>
          client.channelIds.includes(main.id) ||
          subChannels.some(
            (sub) => sub.parentId === main.id && client.channelIds.includes(sub.id)
          )
      )
      .map((ch) => ch.name);
  }

  /** The sub-channels actually ticked on the client, not the mains they roll up to */
  function clientSubChannelNames(client: Client): string[] {
    return subChannels.filter((s) => client.channelIds.includes(s.id)).map((s) => s.name);
  }

  const activeCount = clients.filter((c) => c.active).length;
  const archivedCount = clients.length - activeCount;

  const inView = clients.filter((c) => (view === "archived" ? !c.active : c.active));

  // Search reaches the CAM and channel names too, which are joined in from
  // other lists rather than stored on the client — searching what you can see
  // is the whole point.
  const tools = useTableTools<Client>(
    inView,
    {
      name: (c) => c.name,
      vendors: (c) => c.vendorNumbers.join(", "),
      channels: (c) => clientMainChannelNames(c).join(", "),
      cam: (c) => {
        const cam = cams.find((cm) => cm.id === c.camId);
        return cam ? `${cam.name} ${cam.surname}` : "";
      },
      controlFiles: (c) => Object.values(c.controlFiles).filter(Boolean).length,
    },
    "name",
    (c) => {
      const cam = cams.find((cm) => cm.id === c.camId);
      return [c.name, c.vendorNumbers.join(" "), clientMainChannelNames(c).join(" "),
        cam ? `${cam.name} ${cam.surname}` : "", c.notes ?? ""].join(" ");
    },
  );
  const filtered = tools.rows;

  // Export exactly what is on screen — same view, same search, same sort order —
  // plus the columns that never fit on the page (CAM contact details, per-file
  // control-file dates, SQL name, linked clients, notes).
  // The second sheet states the scope, because a filtered export looks identical
  // to a complete one once it is off the screen and in someone's inbox.
  async function exportClients() {
    if (!filtered.length) return;
    const XLSX = await import("xlsx");

    const rows = filtered.map((c) => {
      const cam = cams.find((cm) => cm.id === c.camId);
      const row: Record<string, string | number> = {
        "Client": c.name,
        "Status": c.active ? "Active" : "Archived",
        "Archived On": xlDate(c.archivedAt),
        "Archived By": c.archivedBy ?? "",
        "Vendor Numbers": c.vendorNumbers.join(", "),
        "Channels": clientMainChannelNames(c).join(", "),
        "Sub-Channels": clientSubChannelNames(c).join(", "),
        "CAM": cam ? `${cam.name} ${cam.surname}` : "",
        "CAM Email": cam?.email ?? "",
        "CAM Cell": cam?.cell ?? "",
        "Control Files": `${Object.values(c.controlFiles ?? {}).filter(Boolean).length}/5`,
      };
      // One column per control file holding the date it was last loaded — blank
      // reads as "never loaded", which is the question this export gets asked.
      for (const [type, label] of CONTROL_FILE_COLUMNS) {
        row[label] = xlDate(c.controlFiles?.[type]?.uploadedAt);
      }
      row["SQL Client Name"] = c.sqlClientName ?? "";
      row["Consolidated Store Reports"] = c.sendConsolidatedStoreReports ? "Yes" : "No";
      row["Linked Clients"] = c.linkedClientIds
        .map((id) => clients.find((x) => x.id === id)?.name ?? id)
        .join(", ");
      row["Notes"] = c.notes ?? "";
      row["Created"] = xlDate(c.createdAt);
      return row;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 26 }, { wch: 26 },
      { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 12 },
      ...CONTROL_FILE_COLUMNS.map(() => ({ wch: 13 })),
      { wch: 24 }, { wch: 12 }, { wch: 28 }, { wch: 50 }, { wch: 12 },
    ];
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: Object.keys(rows[0]).length - 1, r: rows.length } }) };
    XLSX.utils.book_append_sheet(wb, ws, view === "archived" ? "Archived Clients" : "Active Clients");

    const search = tools.query.trim();
    const about = [
      { Field: "Exported at", Value: new Date().toLocaleString("en-ZA") },
      { Field: "Exported by", Value: user?.name ?? "" },
      { Field: "View", Value: view === "archived" ? "Archived clients" : "Active clients" },
      { Field: "Search filter", Value: search ? `"${search}"` : "none" },
      { Field: "Rows in this export", Value: String(filtered.length) },
      { Field: "Clients in this view", Value: String(view === "archived" ? archivedCount : activeCount) },
      { Field: "Active clients in total", Value: String(activeCount) },
      { Field: "Archived clients in total", Value: String(archivedCount) },
    ];
    const wsAbout = XLSX.utils.json_to_sheet(about);
    wsAbout["!cols"] = [{ wch: 26 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsAbout, "About this export");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `clients-${view}${search ? "-filtered" : ""}-${stamp}.xlsx`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await authFetch("/api/clients", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        vendorNumbers: form.vendorNumbers.split(",").map((v) => v.trim()).filter(Boolean),
        camId: form.camId || undefined,
        channelIds: form.channelIds,
        notes: form.notes || undefined,
      }),
    });
    if (!res.ok) { setError((await res.json()).error || "Failed"); return; }
    setShowForm(false);
    setForm({ name: "", vendorNumbers: "", camId: "", channelIds: [], notes: "" });
    load();
  }

  function toggleChannel(id: string) {
    setForm((prev) => ({
      ...prev,
      channelIds: prev.channelIds.includes(id)
        ? prev.channelIds.filter((x) => x !== id)
        : [...prev.channelIds, id],
    }));
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Clients</h1>
        <button onClick={toggleForm} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
          {showForm ? "Cancel" : "+ Add Client"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            {/* The name is PICKED, never typed — see SqlNamesResponse above. */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text)]">Client Name</label>
              {namesLoading ? (
                <div className="rounded-lg border border-[var(--color-border)] bg-zinc-50 px-3 py-2 text-sm text-[var(--color-text-muted)]">
                  Reading the client list from SQL Server…
                </div>
              ) : sqlNames && sqlNames.names.length > 0 ? (
                <SearchSelect
                  value={form.name}
                  options={sqlNames.names.map((n) => {
                    const m = matchByName.get(n.trim().toUpperCase());
                    if (m?.taken.length) return { value: n, label: `${n} · already added` };
                    if (m?.likely.length) return { value: n, label: `${n} · probably "${m.likely[0].name}"` };
                    return { value: n, label: n };
                  })}
                  onChange={pickClientName}
                  allLabel="Choose a client…"
                  searchLabel="client names"
                  widthClass="w-full"
                />
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <div className="font-medium">The client list could not be read from SQL Server.</div>
                  <div className="mt-1 break-words font-mono text-[11px] leading-relaxed">
                    {sqlNames?.error || "The stored procedure returned no names."}
                  </div>
                  <div className="mt-1 text-xs">
                    A client cannot be added until this is working — names are not typed in by hand any more.
                    Use Email OJ if the client needs adding urgently.
                  </div>
                  <button type="button" onClick={loadSqlNames} className="mt-2 text-xs font-medium underline">
                    Try again
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <span>
                  Names come from SQL Server
                  {sqlNames && sqlNames.names.length > 0
                    /* Count the overlap, not every client iRam has: clients
                       created before this list existed are not on it, and
                       counting them would say "12 already added" over a list
                       of 8. */
                    ? ` — ${sqlNames.names.length} on the list, ${
                        sqlNames.names.filter((n) => takenNames.has(n.trim().toUpperCase())).length
                      } already added`
                    : ""}.
                </span>
                <button type="button"
                  onClick={() => { setReqError(""); setShowRequest(true); }}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:border-zinc-400">
                  ✉ Email OJ — client not on the list
                </button>
              </div>
              {nameNotice && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{nameNotice}</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input placeholder="Vendor Numbers (comma-separated)" value={form.vendorNumbers} onChange={(e) => setForm({ ...form, vendorNumbers: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
            <select value={form.camId} onChange={(e) => setForm({ ...form, camId: e.target.value })} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              <option value="">No CAM assigned</option>
              {cams.map((c) => <option key={c.id} value={c.id}>{c.name} {c.surname}</option>)}
            </select>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text)]">Channels</label>
              <div className="flex flex-wrap gap-2">
                {subChannels.map((ch) => (
                  <button key={ch.id} type="button" onClick={() => toggleChannel(ch.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${form.channelIds.includes(ch.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                    {ch.name}
                  </button>
                ))}
              </div>
            </div>
            <textarea placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" rows={2} />
            <button type="submit" disabled={!form.name}
              title={form.name ? "" : "Choose a client name from the SQL Server list first"}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-40">
              Create Client
            </button>
          </form>
        </div>
      )}

      {toast && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}
      {error && !showForm && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-[var(--color-border)] p-1">
          {(["active", "archived"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                view === v ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
              {v === "active" ? `Active (${activeCount})` : `Archived (${archivedCount})`}
            </button>
          ))}
        </div>
        <TableSearch value={tools.query} onChange={tools.setQuery} count={filtered.length} total={tools.total}
          placeholder="Search clients, vendors, channels, CAM…" />
        {/* Downloads what is on screen — the button says how many so a filtered
            export is never mistaken for the whole list. */}
        <button type="button" onClick={exportClients} disabled={loading || filtered.length === 0}
          title="Download the clients shown here as an Excel file, with CAM contacts, control-file dates and notes"
          className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-40">
          ⬇ Export to Excel ({filtered.length})
        </button>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {view === "archived" && archivedCount === 0
              ? "No archived clients. Archiving keeps all of a client's data but takes them out of the checklist, the load-status email, store reports and every upload dropdown."
              : "No clients found."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {[
                  ["Client", "name"], ["Vendor Numbers", "vendors"], ["Channels", "channels"],
                  ["CAM", "cam"], ["Control Files", "controlFiles"],
                ].map(([label, key]) => (
                  <SortableTh key={key} label={label} sortKey={key} className="px-6"
                    current={tools.sortKey} dir={tools.sortDir} onSort={tools.toggleSort} />
                ))}
                {canManage && <th className="px-6 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const cam = cams.find((cm) => cm.id === c.camId);
                const cfCount = Object.values(c.controlFiles).filter(Boolean).length;
                return (
                  <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-zinc-50">
                    <td className="px-6 py-3">
                      <Link href={`/clients/${c.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
                        {c.name}
                      </Link>
                      {!c.active && (
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          Archived{c.archivedAt ? ` ${new Date(c.archivedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
                          {c.archivedBy ? ` by ${c.archivedBy}` : ""} · data kept
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.vendorNumbers.join(", ")}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {clientMainChannelNames(c).map((name) => (
                          <span key={name} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{name}</span>
                        ))}
                        {clientMainChannelNames(c).length === 0 && (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{cam ? `${cam.name} ${cam.surname}` : "—"}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{cfCount}/5</td>
                    {canManage && (
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button type="button" disabled={busyId === c.id} onClick={() => toggleArchive(c)}
                          title={c.active
                            ? "Archive — keeps all data, removes the client from the checklist, load-status email, store reports and upload dropdowns"
                            : "Restore this client to the operational lists"}
                          className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50">
                          {busyId === c.id ? "…" : c.active ? "Archive" : "Restore"}
                        </button>
                        {/* Separate permission — see delete_clients in lib/types.ts.
                            The API enforces it too; this only keeps the button
                            out of the way of people who cannot use it. */}
                        {canDelete && (
                          <button type="button" onClick={() => openDelete(c)}
                            title="Permanently delete this client and all of its stored data"
                            className="ml-4 text-xs font-medium text-red-600 hover:underline">
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Email OJ — the client is genuinely not on the SQL Server list, so it
          has to be added at the source before it can exist here. */}
      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={sendClientRequest} className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Ask OuterJoin to add a client</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Client names come from SQL Server, so a client that is not on the list cannot be
              created here. This emails <strong>mark@outerjoin.co.za</strong> with the details, and
              the reply comes back to you.
            </p>

            <label className="mt-4 block text-sm font-medium text-[var(--color-text)]">
              Client name
              <input autoFocus value={reqForm.clientName} required
                onChange={(e) => setReqForm({ ...reqForm, clientName: e.target.value })}
                placeholder="The client's name as it should appear"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal" />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-[var(--color-text)]">
                Vendor number(s)
                <input value={reqForm.vendorNumbers}
                  onChange={(e) => setReqForm({ ...reqForm, vendorNumbers: e.target.value })}
                  placeholder="e.g. 7629, 7425"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal" />
              </label>
              <label className="block text-sm font-medium text-[var(--color-text)]">
                Channel(s)
                <input value={reqForm.channels}
                  onChange={(e) => setReqForm({ ...reqForm, channels: e.target.value })}
                  placeholder="e.g. MAKRO, MASSBUILD"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal" />
              </label>
            </div>

            {/* PMF / Links / Ranging. Every answer goes in the mail, ticked or
                not, so an unticked box tells Mark what is still outstanding
                rather than saying nothing at all. Deliberately not required —
                a gate here would only teach people to tick all three. */}
            <fieldset className="mt-4 rounded-lg border border-[var(--color-border)] p-3">
              <legend className="px-1 text-sm font-medium text-[var(--color-text)]">Preparation</legend>
              <p className="text-xs text-[var(--color-text-muted)]">
                Tick what is done. Anything left unticked is sent as outstanding.
              </p>
              <div className="mt-2 space-y-2">
                {CLIENT_REQUEST_CHECKLIST.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input type="checkbox" checked={reqForm[item.key]}
                      onChange={(e) => setReqForm({ ...reqForm, [item.key]: e.target.checked })}
                      className="h-4 w-4 rounded border-[var(--color-border)]" />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-3 block text-sm font-medium text-[var(--color-text)]">
              Anything else worth knowing
              <textarea value={reqForm.notes} rows={3}
                onChange={(e) => setReqForm({ ...reqForm, notes: e.target.value })}
                placeholder="Who asked for it, when it is needed, which stores or products it covers…"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-normal" />
            </label>

            {reqError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{reqError}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRequest(false)} disabled={reqBusy}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-zinc-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={reqBusy || !reqForm.clientName.trim()}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-40">
                {reqBusy ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete: show exactly what will be destroyed, then demand the name */}
      {delTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-red-700">Delete {delTarget.name}?</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              This permanently destroys the client <strong>and all of its stored data</strong>. It cannot be undone.
              {delTarget.active && " If you only want to stop the reports and chasing, Archive keeps the data instead."}
            </p>

            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3">
              {delPreview ? (
                delPreview.totalBlobs === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">This client has no stored data — only the client record will be removed.</p>
                ) : (
                  <>
                    <table className="w-full text-sm">
                      <tbody>
                        {delPreview.items.map((it) => (
                          <tr key={it.label}>
                            <td className="py-1 pr-3 text-[var(--color-text)]">{it.label}</td>
                            <td className="py-1 text-right whitespace-nowrap text-[var(--color-text-muted)]">
                              {it.blobCount} object{it.blobCount === 1 ? "" : "s"}
                            </td>
                            <td className="py-1 pl-3 text-right whitespace-nowrap font-medium text-[var(--color-text)]">{fmtBytes(it.bytes)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-[var(--color-border)]">
                          <td className="pt-2 pr-3 font-semibold text-[var(--color-text)]">Total</td>
                          <td className="pt-2 text-right whitespace-nowrap text-[var(--color-text-muted)]">{delPreview.totalBlobs} objects</td>
                          <td className="pt-2 pl-3 text-right whitespace-nowrap font-bold text-red-700">{fmtBytes(delPreview.totalBytes)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )
              ) : delError ? null : (
                <p className="text-sm text-[var(--color-text-muted)]">Working out what this client owns…</p>
              )}
            </div>

            <label className="mt-4 block text-sm text-[var(--color-text)]">
              Type <span className="font-mono font-semibold">{delTarget.name}</span> to confirm:
              <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} autoFocus
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            </label>

            {delError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{delError}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDelTarget(null)} disabled={deleting}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-zinc-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={confirmDelete}
                disabled={deleting || delConfirm.trim().toLowerCase() !== delTarget.name.trim().toLowerCase()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
