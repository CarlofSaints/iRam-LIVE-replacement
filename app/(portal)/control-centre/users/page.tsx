"use client";

import { useEffect, useState, FormEvent } from "react";
import { authFetch, useAuth } from "@/lib/useAuth";
import { ROLE_DEFINITIONS } from "@/lib/types";
import type { User } from "@/lib/types";

type UserSafe = Omit<User, "password">;

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserSafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cam", forcePasswordChange: true, receiveStoreAlerts: false });
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    const res = await authFetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await authFetch("/api/users", {
      method: editId ? "PUT" : "POST",
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error || "Failed");
      return;
    }
    setShowForm(false);
    setEditId(null);
    setForm({ name: "", email: "", password: "", role: "cam", forcePasswordChange: true, receiveStoreAlerts: false });
    load();
  }

  function startEdit(u: UserSafe) {
    setEditId(u.id);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, forcePasswordChange: u.forcePasswordChange, receiveStoreAlerts: u.receiveStoreAlerts ?? false });
    setShowForm(true);
    setError("");
  }

  async function toggleActive(u: UserSafe) {
    await authFetch("/api/users", {
      method: "PUT",
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    load();
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Users</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setError(""); setForm({ name: "", email: "", password: "", role: "cam", forcePasswordChange: true, receiveStoreAlerts: false }); }}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
        >
          {showForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
            {editId ? "Edit User" : "New User"}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            {error && <div className="col-span-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            {!editId && <input placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
              {ROLE_DEFINITIONS.map((rd) => (
                <option key={rd.role} value={rd.role}>{rd.label}</option>
              ))}
            </select>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.forcePasswordChange} onChange={(e) => setForm({ ...form, forcePasswordChange: e.target.checked })} />
              Force password change on first login
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.receiveStoreAlerts} onChange={(e) => setForm({ ...form, receiveStoreAlerts: e.target.checked })} />
              Receive missing store alerts
            </label>
            <button type="submit" className="col-span-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
              {editId ? "Save Changes" : "Create User"}
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Alerts</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-6 py-3 font-medium text-[var(--color-text)]">{u.name}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{u.email}</td>
                    <td className="px-6 py-3">
                      <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-[var(--color-text)]">
                        {ROLE_DEFINITIONS.find((r) => r.role === u.role)?.label ?? u.role}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        {u.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {u.receiveStoreAlerts && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Store Alerts
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(u)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                        {u.id !== me?.userId && (
                          <button onClick={() => toggleActive(u)} className="text-xs text-[var(--color-text-muted)] hover:underline">
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
