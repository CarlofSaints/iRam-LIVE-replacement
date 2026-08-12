"use client";

import { useEffect, useState, FormEvent } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { authFetch } from "@/lib/useAuth";
import type { CAM } from "@/lib/types";

export default function CamsPage() {
  const [cams, setCams] = useState<CAM[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const blankForm = { name: "", surname: "", email: "", cell: "", createLogin: false, password: "" };
  const [form, setForm] = useState(blankForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const res = await authFetch("/api/cams");
    if (res.ok) setCams(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!editId && form.createLogin && !form.password.trim()) {
      setError("Enter a password for the login, or untick “Also create a login”.");
      return;
    }
    const method = editId ? "PUT" : "POST";
    const body = editId
      ? { id: editId, name: form.name, surname: form.surname, email: form.email, cell: form.cell }
      : form;
    const res = await authFetch("/api/cams", { method, body: JSON.stringify(body) });
    if (!res.ok) { setError((await res.json()).error || "Failed"); return; }
    const data = await res.json().catch(() => ({}));
    if (!editId && form.createLogin) {
      if (data.loginCreated) setNotice(`CAM created and a login was set up for ${form.email} (role: CAM, must change password on first login).`);
      else if (data.loginError) setNotice(`CAM created. ${data.loginError}`);
    } else {
      setNotice("");
    }
    setShowForm(false); setEditId(null);
    setForm(blankForm);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this CAM?")) return;
    await authFetch("/api/cams", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  }

  const camTools = useTableTools<CAM>(
    cams,
    {
      name: (c) => `${c.name} ${c.surname}`,
      email: (c) => c.email,
      cell: (c) => c.cell,
    },
    "name",
    (c) => [c.name, c.surname, c.email, c.cell].join(" "),
  );

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">CAMs</h1>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setError(""); setForm(blankForm); }} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
          {showForm ? "Cancel" : "+ Add CAM"}
        </button>
      </div>

      <div className="mb-4">
        <TableSearch value={camTools.query} onChange={camTools.setQuery}
          count={camTools.rows.length} total={camTools.total} placeholder="Search CAMs…" />
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-blue-700 hover:underline">Dismiss</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
            {error && <div className="col-span-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <input placeholder="First Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Surname" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Cell" value={form.cell} onChange={(e) => setForm({ ...form, cell: e.target.value })} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />

            {!editId && (
              <div className="col-span-2 rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                  <input type="checkbox" checked={form.createLogin} onChange={(e) => setForm({ ...form, createLogin: e.target.checked })} className="h-4 w-4 rounded border-[var(--color-border)]" />
                  Also create a portal login for this CAM
                </label>
                {form.createLogin && (
                  <div className="mt-3">
                    <input
                      type="text"
                      placeholder="Temporary password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    />
                    <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                      Creates a user account using the CAM&apos;s name and email, with the <strong>CAM</strong> role. They&apos;ll be
                      prompted to change this password on first login. (Requires the Manage Users permission.)
                    </p>
                  </div>
                )}
              </div>
            )}

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
                {[["Name", "name"], ["Email", "email"], ["Cell", "cell"]].map(([label, key]) => (
                  <SortableTh key={key} label={label} sortKey={key} className="px-6"
                    current={camTools.sortKey} dir={camTools.sortDir} onSort={camTools.toggleSort} />
                ))}
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {camTools.rows.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-6 py-3 font-medium text-[var(--color-text)]">{c.name} {c.surname}</td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.email}</td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{c.cell}</td>
                  <td className="px-6 py-3 flex gap-2">
                    <button onClick={() => { setEditId(c.id); setError(""); setForm({ name: c.name, surname: c.surname, email: c.email, cell: c.cell, createLogin: false, password: "" }); setShowForm(true); }} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
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
