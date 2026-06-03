import { NextRequest } from "next/server";
import { getRolePermissions, saveRolePermissions } from "@/lib/roleData";
import { requirePermission, requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const perms = await getRolePermissions();
    return Response.json(perms, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_roles");
    const data = await req.json();
    await saveRolePermissions(data);
    await addLog({ userId: session.userId, userName: session.name, action: "update_permissions", details: "Role permissions updated", status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
