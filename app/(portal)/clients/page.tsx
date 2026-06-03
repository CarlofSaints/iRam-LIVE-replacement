"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/useAuth";
import type { Client, Channel, CAM } from "@/lib/types";

export default function ClientsPage() {
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

  async function load() {
    const [cRes, chRes, camRes] = await Promise.all([
      authFetch("/api/clients"),
      authFetch("/api/channels"),
      authFetch("/api/cams"),
    ]);
    if (cRes.ok) setClients(await cRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    if (camRes.ok) setCams(await camRes.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const subChannels = channels.filter((c) => c.parentId);
  const filtered = clients.filter((c) =>
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

      <div className="mb-4">
        <input placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-sm rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">No clients found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Vendor Numbers</th>
                <th className="px-6 py-3">Channels</th>
                <th className="px-6 py-3">CAM</th>
                <th className="px-6 py-3">Control Files</th>
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
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.vendorNumbers.join(", ")}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.channelIds.map((id) => {
                          const ch = channels.find((x) => x.id === id);
                          return <span key={id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{ch?.name ?? id}</span>;
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{cam ? `${cam.name} ${cam.surname}` : "—"}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{cfCount}/5</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
