"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { authFetch, usePermissions } from "@/lib/useAuth";
import type { Client, Channel, CAM } from "@/lib/types";

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

export default function ClientsPage() {
  const { can } = usePermissions();
  const canManage = can("manage_clients");
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cams, setCams] = useState<CAM[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "", vendorNumbers: "", camId: "", channelIds: [] as string[], notes: "",
  });
  const [error, setError] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
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

  const activeCount = clients.filter((c) => c.active).length;
  const archivedCount = clients.length - activeCount;

  const filtered = clients
    .filter((c) => (view === "archived" ? !c.active : c.active))
    .filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.vendorNumbers.some((v) => v.includes(search))
    );

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
        <button onClick={() => { setShowForm(!showForm); setError(""); }} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
          {showForm ? "Cancel" : "+ Add Client"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <div className="grid grid-cols-2 gap-4">
              <input placeholder="Client Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
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
            <button type="submit" className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">Create Client</button>
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
        <input placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-sm rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
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
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Vendor Numbers</th>
                <th className="px-6 py-3">Channels</th>
                <th className="px-6 py-3">CAM</th>
                <th className="px-6 py-3">Control Files</th>
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
                        <button type="button" onClick={() => openDelete(c)}
                          title="Permanently delete this client and all of its stored data"
                          className="ml-4 text-xs font-medium text-red-600 hover:underline">
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
