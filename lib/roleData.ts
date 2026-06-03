import type { RolePermissions } from "./types";
import { ALL_PERMISSIONS } from "./types";
import { readJson, writeJson } from "./blob";
import { DEFAULT_ROLE_PERMISSIONS } from "./roles";

const KEY = "role-permissions.json";

export async function getRolePermissions(): Promise<RolePermissions[]> {
  return readJson<RolePermissions[]>(KEY, DEFAULT_ROLE_PERMISSIONS);
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
