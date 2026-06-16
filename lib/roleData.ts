import type { RolePermissions } from "./types";
import { ALL_PERMISSIONS } from "./types";
import { readJson, writeJson } from "./blob";
import { DEFAULT_ROLE_PERMISSIONS } from "./roles";

const KEY = "role-permissions.json";

export async function getRolePermissions(): Promise<RolePermissions[]> {
  const stored = await readJson<RolePermissions[] | null>(KEY, null);
  if (!stored || stored.length === 0) return DEFAULT_ROLE_PERMISSIONS;
  return mergeRoleDefaults(stored);
}

/**
 * Forward-compatibility merge: a stored role-permissions blob can predate
 * permissions/roles added later in code. We additively (a) add any default
 * role missing from the blob (e.g. a new "client" role) and (b) grant each
 * permission the blob has NEVER seen to the roles whose defaults include it.
 * Existing per-role customisations are preserved.
 */
function mergeRoleDefaults(stored: RolePermissions[]): RolePermissions[] {
  const seenPerms = new Set(stored.flatMap((rp) => rp.permissions));
  const newPerms = ALL_PERMISSIONS.map((p) => p.key).filter((k) => !seenPerms.has(k));
  const byRole = new Map(stored.map((rp) => [rp.role, { role: rp.role, permissions: [...rp.permissions] }]));
  for (const rd of DEFAULT_ROLE_PERMISSIONS) {
    const entry = byRole.get(rd.role);
    if (!entry) {
      byRole.set(rd.role, { role: rd.role, permissions: [...rd.permissions] });
      continue;
    }
    for (const np of newPerms) {
      if (rd.permissions.includes(np) && !entry.permissions.includes(np)) entry.permissions.push(np);
    }
  }
  return [...byRole.values()];
}

export async function saveRolePermissions(
  rolePerms: RolePermissions[]
): Promise<void> {
  // Enforce super_admin always has all permissions
  const superAdminEntry = rolePerms.find((rp) => rp.role === "super_admin");
  if (superAdminEntry) {
    superAdminEntry.permissions = ALL_PERMISSIONS.map((p) => p.key);
  }
  await writeJson(KEY, rolePerms);
}
