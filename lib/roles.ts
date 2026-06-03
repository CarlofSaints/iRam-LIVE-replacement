import type { PermissionKey, RolePermissions } from "./types";
import { SYSTEM_ROLES, ROLE_DEFINITIONS } from "./types";

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions[] = ROLE_DEFINITIONS.map(
  (rd) => ({
    role: rd.role,
    permissions: rd.permissions,
  })
);

const SYSTEM_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_DEFINITIONS.map((rd) => [rd.role, rd.label])
);

export const ROLE_LABELS = SYSTEM_ROLE_LABELS;

export function getRoleLabel(role: string): string {
  return SYSTEM_ROLE_LABELS[role] ?? role;
}

export function isRoleAtLeast(role: string, minRole: string): boolean {
  const hierarchy = [...SYSTEM_ROLES];
  const roleIdx = hierarchy.indexOf(role as (typeof SYSTEM_ROLES)[number]);
  const minIdx = hierarchy.indexOf(minRole as (typeof SYSTEM_ROLES)[number]);
  const effectiveRole = roleIdx === -1 ? hierarchy.length : roleIdx;
  const effectiveMin = minIdx === -1 ? hierarchy.length : minIdx;
  return effectiveRole <= effectiveMin;
}

export function hasPermission(
  rolePerms: RolePermissions[],
  role: string,
  perm: PermissionKey
): boolean {
  if (role === "super_admin") return true;
  const entry = rolePerms.find((rp) => rp.role === role);
  return entry ? entry.permissions.includes(perm) : false;
}
