"use client";

import { useEffect, useState, FormEvent } from "react";
import { authFetch } from "@/lib/useAuth";
import type { CAM } from "@/lib/types";

export default function CamsPage() {
  const [cams, setCams] = useState<CAM[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", surname: "", email: "", cell: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await authFetch("/api/cams");
    if (res.ok) setCams(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const method = editId ? "PUT" : "POST";
    const body = editId ? { id: editId, ...form } : form;
    const res = await authFetch("/api/cams", { method, body: JSON.stringify(body) });
    if (!res.ok) { setError((await res.json()).error || "Failed"); return; }
    setShowForm(false); setEditId(null);
    setForm({ name: "", surname: "", email: "", cell: "" });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this CAM?")) return;
    await authFetch("/api/cams", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">CAMs</h1>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: "", surname: "", email: "", cell: "" }); }} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
          {showForm ? "Cancel" : "+ Add CAM"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
            {error && <div className="col-span-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <input placeholder="First Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Surname" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Cell" value={form.cell} onChange={(e) => setForm({ ...form, cell: e.target.value })} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <button type="submit" className="col-span-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
              {editId ? "Save" : "Create"}
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : cams.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">No CAMs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Cell</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cams.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-6 py-3 font-medium text-[var(--color-text)]">{c.name} {c.surname}</td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.email}</td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.cell}</td>
                  <td className="px-6 py-3 flex gap-2">
                    <button onClick={() => { setEditId(c.id); setForm({ name: c.name, surname: c.surname, email: c.email, cell: c.cell }); setShowForm(true); }} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                    <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
