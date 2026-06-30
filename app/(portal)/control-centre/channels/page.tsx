"use client";

import { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { authFetch } from "@/lib/useAuth";
import type { Channel } from "@/lib/types";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editIsSub, setEditIsSub] = useState(false);
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [compEditId, setCompEditId] = useState<string | null>(null);
  const [compSel, setCompSel] = useState<string[]>([]);

  async function load() {
    const res = await authFetch("/api/channels");
    let chs: Channel[] = [];
    if (res.ok) { chs = await res.json(); setChannels(chs); }
    setLoading(false);
    // Load logos for main channels (generic, used on report cover sheets)
    const mains = chs.filter((c) => !c.parentId);
    const entries = await Promise.all(
      mains.map(async (m): Promise<[string, string | null]> => {
        const r = await authFetch(`/api/channels/${m.id}/logo`);
        if (r.ok) { const d = await r.json(); return [m.id, d?.dataUrl ?? null]; }
        return [m.id, null];
      })
    );
    const map: Record<string, string> = {};
    for (const [cid, url] of entries) if (url) map[cid] = url;
    setLogos(map);
  }

  useEffect(() => { load(); }, []);

  async function uploadChannelLogo(channelId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert("Image too large (max 1.5MB)"); return; }
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
    const res = await authFetch(`/api/channels/${channelId}/logo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }),
    });
    if (res.ok) setLogos((p) => ({ ...p, [channelId]: dataUrl }));
    else { const er = await res.json().catch(() => ({})); alert(er.error || "Upload failed"); }
  }

  async function deleteChannelLogo(channelId: string) {
    const res = await authFetch(`/api/channels/${channelId}/logo`, { method: "DELETE" });
    if (res.ok) setLogos((p) => { const n = { ...p }; delete n[channelId]; return n; });
  }

  const mainChannels = channels.filter((c) => !c.parentId);
  const getSubChannels = (parentId: string) =>
    channels.filter((c) => c.parentId === parentId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (editId) {
      // Edit — only rename (no re-parenting)
      const res = await authFetch(`/api/channels/${editId}`, {
        method: "PUT",
        body: JSON.stringify({ id: editId, name: form.name }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed");
        return;
      }
    } else {
      // Create — main channel only (no parentId)
      const res = await authFetch("/api/channels", {
        method: "POST",
        body: JSON.stringify({ name: form.name }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed");
        return;
      }
    }

    setShowForm(false);
    setEditId(null);
    setEditIsSub(false);
    setForm({ name: "" });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this channel?")) return;
    const res = await authFetch(`/api/channels/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Failed to delete");
      return;
    }
    load();
  }

  async function handleResetAll() {
    if (!confirm("This will DELETE all channels and store files.\n\nAfter reset:\n- Main channels (MAKRO, GAME, MASSBUILD) will be re-created\n- You must re-upload store control files to recreate sub-channels\n- Client channel assignments will need to be re-done\n\nContinue?")) return;
    if (!confirm("Are you sure? This cannot be undone.")) return;
    const res = await authFetch("/api/channels/reset", { method: "POST" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Reset failed");
      return;
    }
    alert("Channels and store files wiped. Defaults re-seeded. Please re-upload your store control files.");
    load();
  }

  function startEdit(c: Channel) {
    setEditId(c.id);
    setEditIsSub(!!c.parentId);
    setForm({ name: c.name });
    setShowForm(true);
    setError("");
  }

  function startCompanions(c: Channel) {
    setCompEditId(compEditId === c.id ? null : c.id);
    setCompSel(c.companionChannelIds ?? []);
  }
  const toggleComp = (id: string) =>
    setCompSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function saveCompanions() {
    if (!compEditId) return;
    const res = await authFetch(`/api/channels/${compEditId}`, {
      method: "PUT",
      body: JSON.stringify({ id: compEditId, companionChannelIds: compSel }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    setCompEditId(null);
    load();
  }
  const channelName = (id: string) => mainChannels.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Channels</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setEditIsSub(false); setError(""); setForm({ name: "" }); }}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
        >
          {showForm ? "Cancel" : "+ Add Main Channel"}
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Sub-channels are automatically created when store files are uploaded.
      </div>

      {/* Reset button */}
      <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <span className="text-sm text-amber-700">Channel data out of sync?</span>
        <button
          onClick={handleResetAll}
          className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
        >
          Reset All Channels &amp; Store Files
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
            {error && <div className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <input
              placeholder="Channel name"
              value={form.name}
              onChange={(e) => setForm({ name: e.target.value })}
              required
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            {editIsSub && (
              <span className="flex items-center text-xs text-[var(--color-text-muted)]">Rename only (sub-channel)</span>
            )}
            <button type="submit" className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
              {editId ? "Save" : "Create"}
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {mainChannels.map((main) => (
              <div key={main.id}>
                <div className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-[var(--color-secondary)]/10 px-2 py-0.5 text-xs font-bold text-[var(--color-secondary)]">
                      MAIN
                    </span>
                    <span className="font-medium text-[var(--color-text)]">{main.name}</span>
                    {logos[main.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logos[main.id]} alt="" className="h-7 rounded border border-[var(--color-border)] bg-white px-1" />
                    )}
                    {!!main.companionChannelIds?.length && (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        + {main.companionChannelIds.map(channelName).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer text-xs text-[var(--color-primary)] hover:underline">
                      {logos[main.id] ? "Replace logo" : "Add logo"}
                      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
                        onChange={(e) => uploadChannelLogo(main.id, e)} />
                    </label>
                    {logos[main.id] && (
                      <button onClick={() => deleteChannelLogo(main.id)} className="text-xs text-red-500 hover:underline">Remove logo</button>
                    )}
                    <button onClick={() => startCompanions(main)} className="text-xs text-[var(--color-primary)] hover:underline">Companions</button>
                    <button onClick={() => startEdit(main)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                    <button onClick={() => handleDelete(main.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                {compEditId === main.id && (
                  <div className="border-t border-[var(--color-border)] bg-blue-50/40 px-6 py-4">
                    <p className="mb-1 text-xs font-semibold text-[var(--color-text)]">Companion channels for {main.name}</p>
                    <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
                      Pick other main channels whose sites arrive inside {main.name}&apos;s DISPO export. When a {main.name} DISPO
                      is loaded, sites are validated against all selected channels&apos; store files and rows are split into each
                      channel&apos;s own ledger.
                    </p>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {mainChannels.filter((c) => c.id !== main.id).map((c) => (
                        <button key={c.id} type="button" onClick={() => toggleComp(c.id)}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${compSel.includes(c.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                          {c.name}
                        </button>
                      ))}
                      {mainChannels.filter((c) => c.id !== main.id).length === 0 && (
                        <span className="text-xs text-[var(--color-text-muted)]">No other main channels to link.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveCompanions} className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">Save</button>
                      <button onClick={() => setCompEditId(null)} className="rounded-lg border border-[var(--color-border)] px-4 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-zinc-50">Cancel</button>
                    </div>
                  </div>
                )}
                {getSubChannels(main.id).map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-6 py-2.5 pl-14">
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-[var(--color-primary)]/10 px-2 py-0.5 text-xs font-bold text-[var(--color-primary)]">
                        SUB
                      </span>
                      <span className="text-sm text-[var(--color-text)]">{sub.name}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                        Auto-created from store files
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(sub)} className="text-xs text-[var(--color-primary)] hover:underline">Rename</button>
                      <button onClick={() => handleDelete(sub.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
