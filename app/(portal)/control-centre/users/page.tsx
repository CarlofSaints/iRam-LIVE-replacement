"use client";

import { useEffect, useState, FormEvent } from "react";
import { authFetch, useAuth } from "@/lib/useAuth";
import { ROLE_DEFINITIONS } from "@/lib/types";
import type { User } from "@/lib/types";

type UserSafe = Omit<User, "password">;

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserSafe[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cam", forcePasswordChange: true, receiveStoreAlerts: false, receiveProductAlerts: false, receiveStoreReportDigest: false, clientIds: [] as string[] });
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  // ── Super-admin credential management ──
  const isSuperAdmin = me?.role === "super_admin";
  const [pwModalUser, setPwModalUser] = useState<UserSafe | null>(null);
  const [pwMode, setPwMode] = useState<"set" | "generate">("generate");
  const [pwValue, setPwValue] = useState("");
  const [pwForce, setPwForce] = useState(true);
  const [pwEmail, setPwEmail] = useState(true);
  const [pwError, setPwError] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // userId+action being run
  const [result, setResult] = useState<{
    name: string;
    email: string;
    action: string;
    password?: string;
    emailed?: boolean;
    emailError?: string;
    error?: boolean;
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function callCreds(payload: Record<string, unknown>) {
    const res = await authFetch("/api/users/credentials", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data } as { ok: boolean; data: Record<string, unknown> };
  }

  function openPwModal(u: UserSafe) {
    setPwModalUser(u);
    setPwMode("generate");
    setPwValue("");
    setPwForce(true);
    setPwEmail(true);
    setPwError("");
  }

  async function submitPw() {
    const u = pwModalUser;
    if (!u) return;
    setPwError("");
    const payload: Record<string, unknown> =
      pwMode === "set"
        ? { action: "set-password", userId: u.id, password: pwValue, forcePasswordChange: pwForce, sendEmail: pwEmail }
        : { action: "reset-password", userId: u.id, forcePasswordChange: pwForce, sendEmail: pwEmail };
    if (pwMode === "set" && pwValue.trim().length < 6) {
      setPwError("Password must be at least 6 characters");
      return;
    }
    setBusy("pw");
    const { ok, data } = await callCreds(payload);
    setBusy(null);
    if (!ok) {
      setPwError((data.error as string) || "Failed");
      return;
    }
    setPwModalUser(null);
    setCopied(false);
    setResult({
      name: u.name,
      email: u.email,
      action: pwMode === "set" ? "set-password" : "reset-password",
      password: data.password as string | undefined,
      emailed: data.emailed as boolean | undefined,
      emailError: data.emailError as string | undefined,
      message:
        pwMode === "set"
          ? `Password updated for ${u.name}.${pwEmail ? (data.emailed ? " Login details emailed." : " But the email could not be sent.") : ""}`
          : `New temporary password generated for ${u.name}.${data.emailed ? ` Emailed to ${u.email}.` : " Email could not be sent — share the password below."}`,
    });
    load();
  }

  async function quickAction(u: UserSafe, action: "reinvite" | "send-credentials") {
    const verb = action === "reinvite" ? "re-invite" : "send login details to";
    if (
      !confirm(
        `This generates a NEW temporary password for ${u.name} and will ${verb} them by email. Their current password will stop working. Continue?`,
      )
    )
      return;
    setBusy(u.id + action);
    const { ok, data } = await callCreds({ action, userId: u.id });
    setBusy(null);
    if (!ok) {
      setResult({ name: u.name, email: u.email, action, error: true, message: (data.error as string) || "Failed" });
      return;
    }
    setCopied(false);
    setResult({
      name: u.name,
      email: u.email,
      action,
      password: data.password as string | undefined,
      emailed: data.emailed as boolean | undefined,
      emailError: data.emailError as string | undefined,
      message: data.emailed
        ? `${action === "reinvite" ? "Invite" : "Login details"} emailed to ${u.email}.`
        : `Email could NOT be sent${data.emailError ? ` (${data.emailError})` : ""} — share the password below manually.`,
    });
    load();
  }

  function copyPassword() {
    if (!result?.password) return;
    navigator.clipboard?.writeText(result.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function load() {
    const res = await authFetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/clients");
      if (res.ok) {
        const all: { id: string; name: string }[] = await res.json();
        setClients(all);
      }
    })();
  }, []);

  const blankForm = { name: "", email: "", password: "", role: "cam", forcePasswordChange: true, receiveStoreAlerts: false, receiveProductAlerts: false, receiveStoreReportDigest: false, clientIds: [] as string[] };
  const toggleFormClient = (id: string) =>
    setForm((f) => ({ ...f, clientIds: f.clientIds.includes(id) ? f.clientIds.filter((c) => c !== id) : [...f.clientIds, id] }));

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
    setForm(blankForm);
    load();
  }

  function startEdit(u: UserSafe) {
    setEditId(u.id);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, forcePasswordChange: u.forcePasswordChange, receiveStoreAlerts: u.receiveStoreAlerts ?? false, receiveProductAlerts: u.receiveProductAlerts ?? false, receiveStoreReportDigest: u.receiveStoreReportDigest ?? false, clientIds: u.clientIds ?? [] });
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
          onClick={() => { setShowForm(!showForm); setEditId(null); setError(""); setForm(blankForm); }}
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
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.receiveProductAlerts} onChange={(e) => setForm({ ...form, receiveProductAlerts: e.target.checked })} />
              Receive missing product alerts (LINKS/PMF)
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.receiveStoreReportDigest} onChange={(e) => setForm({ ...form, receiveStoreReportDigest: e.target.checked })} />
              Receive daily store-report digest (manager)
            </label>

            {/* Client scoping — restrict this account to specific clients */}
            <div className="col-span-2">
              <div className="mb-1 text-sm font-medium text-[var(--color-text)]">Client access</div>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                Leave empty for internal staff (sees all clients). Select one or more clients to restrict this account — a
                client account (role <span className="font-mono">Client</span>) will only ever see the selected clients&apos; data.
              </p>
              <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] p-3">
                {clients.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">No clients available.</span>}
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.clientIds.includes(c.id)} onChange={() => toggleFormClient(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
              {form.role === "client" && form.clientIds.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">A Client account with no clients selected will see nothing — select at least one.</p>
              )}
            </div>

            <button type="submit" className="col-span-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
              {editId ? "Save Changes" : "Create User"}
            </button>
          </form>
        </div>
      )}

      {result && (
        <div
          className={`mb-6 rounded-xl border p-4 ${
            result.error ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className={`text-sm font-medium ${result.error ? "text-red-700" : "text-green-800"}`}>
                {result.message}
              </p>
              {result.password && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-muted)]">Temporary password:</span>
                  <code className="rounded bg-white px-2 py-1 text-sm font-semibold text-[var(--color-text)] ring-1 ring-[var(--color-border)]">
                    {result.password}
                  </code>
                  <button
                    onClick={copyPassword}
                    className="rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-zinc-50"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
              {result.password && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Shown once — copy it now if you need to share it manually. It is stored only as a hash and cannot be retrieved again.
                </p>
              )}
            </div>
            <button onClick={() => setResult(null)} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {pwModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-[var(--color-text)]">Reset password</h2>
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              {pwModalUser.name} <span className="text-xs">({pwModalUser.email})</span>
            </p>
            {pwError && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pwError}</div>}

            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPwMode("generate")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  pwMode === "generate" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                }`}
              >
                Generate random
              </button>
              <button
                type="button"
                onClick={() => setPwMode("set")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  pwMode === "set" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                }`}
              >
                Set specific
              </button>
            </div>

            {pwMode === "set" && (
              <input
                placeholder="New password (min 6 chars)"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                className="mb-4 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
            )}

            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pwForce} onChange={(e) => setPwForce(e.target.checked)} />
              Force password change on next login
            </label>
            <label className="mb-5 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pwEmail} onChange={(e) => setPwEmail(e.target.checked)} />
              Email the new login details to the user
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPwModalUser(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={submitPw}
                disabled={busy === "pw"}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
              >
                {busy === "pw" ? "Working…" : pwMode === "set" ? "Set password" : "Generate & apply"}
              </button>
            </div>
          </div>
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
                      <div className="flex flex-wrap gap-1">
                        {u.receiveStoreAlerts && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Store Alerts
                          </span>
                        )}
                        {u.receiveProductAlerts && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Product Alerts
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <button onClick={() => startEdit(u)} className="text-xs text-[var(--color-primary)] hover:underline">Edit</button>
                        {u.id !== me?.userId && (
                          <button onClick={() => toggleActive(u)} className="text-xs text-[var(--color-text-muted)] hover:underline">
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                        {isSuperAdmin && (
                          <>
                            <button onClick={() => openPwModal(u)} className="text-xs text-[var(--color-primary)] hover:underline">Reset PW</button>
                            <button onClick={() => quickAction(u, "reinvite")} disabled={busy === u.id + "reinvite"} className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50">
                              {busy === u.id + "reinvite" ? "Sending…" : "Re-invite"}
                            </button>
                            <button onClick={() => quickAction(u, "send-credentials")} disabled={busy === u.id + "send-credentials"} className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50">
                              {busy === u.id + "send-credentials" ? "Sending…" : "Send creds"}
                            </button>
                          </>
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
