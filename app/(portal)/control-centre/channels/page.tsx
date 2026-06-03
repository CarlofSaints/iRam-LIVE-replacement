"use client";

import { useEffect, useState, FormEvent } from "react";
import { authFetch } from "@/lib/useAuth";
import type { Channel } from "@/lib/types";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", parentId: "" });
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    const res = await authFetch("/api/channels");
    if (res.ok) setChannels(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const mainChannels = channels.filter((c) => !c.parentId);
  const getSubChannels = (parentId: string) =>
    channels.filter((c) => c.parentId === parentId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const method = editId ? "PUT" : "POST";
    const body = editId
      ? { id: editId, name: form.name, parentId: form.parentId || null }
      : { name: form.name, parentId: form.parentId || undefined };
    const url = editId ? `/api/channels/${editId}` : "/api/channels";
    const res = await authFetch(url, { method, body: JSON.stringify(body) });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error || "Failed");
      return;
    }
    setShowForm(false);
    setEditId(null);
    setForm({ name: "", parentId: "" });
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

  function startEdit(c: Channel) {
    setEditId(c.id);
    setForm({ name: c.name, parentId: c.parentId ?? "" });
    setShowForm(true);
    setError("");
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Channels</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: "", parentId: "" }); setError(""); }}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
        >
          {showForm ? "Cancel" : "+ Add Channel"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
            {error && <div className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <input
              placeholder="Channel name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            <select
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="">Main Channel</option>
              {mainChannels.map((m) => (
                <option key={m.id} value={m.id}>Sub of: {m.name}</option>
              ))}
            </select>
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
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(main)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                    <button onClick={() => handleDelete(main.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                {getSubChannels(main.id).map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-6 py-2.5 pl-14">
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-[var(--color-primary)]/10 px-2 py-0.5 text-xs font-bold text-[var(--color-primary)]">
                        SUB
                      </span>
                      <span className="text-sm text-[var(--color-text)]">{sub.name}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(sub)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
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
