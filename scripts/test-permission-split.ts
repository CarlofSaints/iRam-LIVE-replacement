/* Splitting manage_clients has one dangerous failure mode: the LIVE role grid
   is a stored blob, and a stored grid that predates a new permission must not
   hand it to a role whose defaults exclude it. Run:
     npx tsx scripts/test-permission-split.ts */
import { ALL_PERMISSIONS, ROLE_DEFINITIONS, type PermissionKey, type RolePermissions } from "../lib/types";
import { hasPermission } from "../lib/roles";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, want ${expected})`}`);
}

const permKeys = ALL_PERMISSIONS.map((p) => p.key) as PermissionKey[];
check("delete_clients exists as a permission", permKeys.includes("delete_clients"), true);
check("manage_clients still exists", permKeys.includes("manage_clients"), true);

const def = (role: string) => ROLE_DEFINITIONS.find((r) => r.role === role)!;
check("admin gets delete_clients by default", def("admin").permissions.includes("delete_clients"), true);
check("CAM does NOT get delete_clients", def("cam").permissions.includes("delete_clients"), false);
check("viewer does NOT get delete_clients", def("viewer").permissions.includes("delete_clients"), false);
check("client role does NOT get delete_clients", def("client").permissions.includes("delete_clients"), false);

/* ── The live-grid case, which is what actually matters ──
   Carl granted CAM manage_clients on the Roles page so CAMs could add and edit
   clients. That stored grid predates delete_clients. Replaying the real
   forward-compatibility merge from lib/roleData.ts must give admin the new
   permission and must NOT give it to CAM. */
function mergeRoleDefaults(stored: RolePermissions[]): RolePermissions[] {
  const seenPerms = new Set(stored.flatMap((rp) => rp.permissions));
  const newPerms = permKeys.filter((k) => !seenPerms.has(k));
  const byRole = new Map(stored.map((rp) => [rp.role, { role: rp.role, permissions: [...rp.permissions] }]));
  for (const rd of ROLE_DEFINITIONS) {
    const entry = byRole.get(rd.role);
    if (!entry) { byRole.set(rd.role, { role: rd.role, permissions: [...rd.permissions] }); continue; }
    for (const np of newPerms) {
      if (rd.permissions.includes(np) && !entry.permissions.includes(np)) {
        entry.permissions.push(np);
      }
    }
  }
  return [...byRole.values()];
}

const liveGridBeforeTheSplit: RolePermissions[] = [
  { role: "super_admin", permissions: permKeys.filter((k) => k !== "delete_clients") as PermissionKey[] },
  // This is the line that caused the problem: CAM was given manage_clients.
  { role: "admin", permissions: ["manage_users", "manage_clients", "view_activity_log"] as PermissionKey[] },
  { role: "cam", permissions: ["upload_data", "manage_clients", "view_dashboard"] as PermissionKey[] },
  { role: "viewer", permissions: ["view_dashboard"] as PermissionKey[] },
  // A hand-made role the defaults know nothing about.
  { role: "data_loader", permissions: ["upload_data", "manage_clients"] as PermissionKey[] },
];

const merged = mergeRoleDefaults(liveGridBeforeTheSplit);

check("CAM keeps manage_clients (can still add/edit)", hasPermission(merged, "cam", "manage_clients" as PermissionKey), true);
check("THE FIX: CAM cannot delete clients", hasPermission(merged, "cam", "delete_clients" as PermissionKey), false);
check("admin keeps manage_clients", hasPermission(merged, "admin", "manage_clients" as PermissionKey), true);
check("admin gains delete_clients automatically", hasPermission(merged, "admin", "delete_clients" as PermissionKey), true);
check("super_admin can delete (always true by role)", hasPermission(merged, "super_admin", "delete_clients" as PermissionKey), true);
check("a CUSTOM role does not silently gain delete", hasPermission(merged, "data_loader", "delete_clients" as PermissionKey), false);
check("viewer still cannot delete", hasPermission(merged, "viewer", "delete_clients" as PermissionKey), false);

// Activity log: admin-only is already the default; CAM must not have it.
check("admin has view_activity_log", hasPermission(merged, "admin", "view_activity_log" as PermissionKey), true);
check("CAM does not have view_activity_log", hasPermission(merged, "cam", "view_activity_log" as PermissionKey), false);

console.log(failed === 0 ? "\nAll permission checks passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
