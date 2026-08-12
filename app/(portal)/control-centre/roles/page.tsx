"use client";

import { useEffect, useState } from "react";
import { matchesQuery } from "@/lib/useTableTools";
import { SortArrow, TableSearch } from "@/components/TableTools";
import { authFetch } from "@/lib/useAuth";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "@/lib/types";
import type { RolePermissions, PermissionKey } from "@/lib/types";

export default function RolesPage() {
  const [rolePerms, setRolePerms] = useState<RolePermissions[]>([]);
  const [original, setOriginal] = useState<RolePermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  async function load() {
    const res = await authFetch("/api/role-permissions");
    if (res.ok) {
      const data: RolePermissions[] = await res.json();
      setRolePerms(data);
      setOriginal(JSON.parse(JSON.stringify(data)));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const dirty = JSON.stringify(rolePerms) !== JSON.stringify(original);

  function toggle(role: string, perm: PermissionKey) {
    if (role === "super_admin") return; // locked
    setRolePerms((prev) =>
      prev.map((rp) => {
        if (rp.role !== role) return rp;
        const has = rp.permissions.includes(perm);
        return {
          ...rp,
          permissions: has
            ? rp.permissions.filter((p) => p !== perm)
            : [...rp.permissions, perm],
        };
      })
    );
  }

  async function save() {
    setSaving(true);
    const res = await authFetch("/api/role-permissions", {
      method: "PUT",
      body: JSON.stringify(rolePerms),
    });
    if (res.ok) {
      setOriginal(JSON.parse(JSON.stringify(rolePerms)));
      setToast("Permissions saved");
      setTimeout(() => setToast(""), 3000);
    }
    setSaving(false);
  }

  function discard() {
    setRolePerms(JSON.parse(JSON.stringify(original)));
  }

  const roles = ROLE_DEFINITIONS;

  /* A permissions matrix has permissions down and roles across, so there is
     nothing to sort by except the permission name — and with the list this
     long, finding one by typing matters more than ordering. The search matches
     the label, the underlying key and the roles that currently hold it, so
     "cam delete" finds what a CAM can destroy. */
  const [permQuery, setPermQuery] = useState("");
  const [permDesc, setPermDesc] = useState(false);
  const visiblePermissions = ALL_PERMISSIONS
    .filter((p) => {
      if (!permQuery.trim()) return true;
      const holders = roles
        .filter((rd) => rolePerms.find((r) => r.role === rd.role)?.permissions.includes(p.key))
        .map((rd) => rd.label)
        .join(" ");
      return matchesQuery(`${p.label} ${p.key} ${holders}`, permQuery);
    })
    .sort((a, b) => (permDesc ? -1 : 1) * a.label.localeCompare(b.label));

  if (loading) {
    return (
      <div className="p-8 text-sm text-[var(--color-text-muted)]">Loading...</div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">
          Roles & Permissions
        </h1>
        {dirty && (
          <div className="flex gap-2">
            <button onClick={discard} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-zinc-50">
              Discard
            </button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          {toast}
        </div>
      )}

      <div className="mb-3">
        <TableSearch value={permQuery} onChange={setPermQuery}
          count={visiblePermissions.length} total={ALL_PERMISSIONS.length}
          placeholder="Search permissions or roles…" />
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {/* Was a hard-coded 520px, which forced scrolling on any screen and got
            worse with every permission added. Size to the viewport instead: the
            offset is the page padding + the heading row. The cap stays because
            it is what keeps the header row and the Permission column sticky —
            CSS computes overflow-y to auto as soon as overflow-x is set, so
            there is no "grow vertically but scroll horizontally" option here. */}
        <div className="max-h-[calc(100vh-11rem)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-[var(--color-border)]">
                <th className="sticky left-0 z-20 bg-white px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <button type="button" onClick={() => setPermDesc((d) => !d)}
                    className="group flex items-center gap-0.5 uppercase tracking-wider hover:text-[var(--color-text)]"
                    title="Sort permissions A–Z / Z–A">
                    Permission
                    <SortArrow active dir={permDesc ? "desc" : "asc"} />
                  </button>
                </th>
                {roles.map((rd) => (
                  <th
                    key={rd.role}
                    className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                  >
                    <div>{rd.label}</div>
                    <div className="mt-0.5 font-normal normal-case opacity-60">
                      {rd.description}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePermissions.map((perm) => (
                <tr
                  key={perm.key}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="sticky left-0 z-10 bg-white px-6 py-2 font-medium text-[var(--color-text)]">
                    {perm.label}
                  </td>
                  {roles.map((rd) => {
                    const rp = rolePerms.find((r) => r.role === rd.role);
                    const has = rp?.permissions.includes(perm.key) ?? false;
                    const locked = rd.role === "super_admin";
                    return (
                      <td key={rd.role} className="px-4 py-2 text-center">
                        <button
                          onClick={() => toggle(rd.role, perm.key)}
                          disabled={locked}
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                            has
                              ? "bg-[var(--color-primary)] text-white"
                              : "border border-zinc-300 bg-zinc-50 text-transparent"
                          } ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-80"}`}
                        >
                          {has && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
