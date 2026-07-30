import { NextRequest } from "next/server";
import { getUsers, createUser, updateUser, deleteUser, pickNotifyFlags } from "@/lib/userData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_users");
    const users = await getUsers();
    const safe = users.map(({ password: _, ...u }) => u);
    return Response.json(safe, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_users");
    const body = await req.json();
    const { name, email, password, role, forcePasswordChange, clientIds } = body;
    if (!name || !email || !password || !role) {
      return Response.json({ error: "All fields are required" }, { status: 400, headers: noCacheHeaders() });
    }
    // Notification tickboxes are honoured at CREATE time, not only on a later
    // edit — pickNotifyFlags keeps this in step with the User flag list.
    const user = await createUser({
      name, email, password, role,
      forcePasswordChange: forcePasswordChange ?? true,
      clientIds: Array.isArray(clientIds) ? clientIds : undefined,
      ...pickNotifyFlags(body),
    });
    await addLog({ userId: session.userId, userName: session.name, action: "create_user", details: `Created user ${email} (${role})`, status: "success" });
    const { password: _, ...safe } = user;
    return Response.json(safe, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_users");
    const { id, password: _pw, ...updates } = await req.json();
    if (!id) return Response.json({ error: "ID required" }, { status: 400, headers: noCacheHeaders() });
    const user = await updateUser(id, updates);
    await addLog({ userId: session.userId, userName: session.name, action: "update_user", details: `Updated user ${user.email}`, status: "success" });
    const { password: _, ...safe } = user;
    return Response.json(safe, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_users");
    const { id } = await req.json();
    if (!id) return Response.json({ error: "ID required" }, { status: 400, headers: noCacheHeaders() });
    await deleteUser(id);
    await addLog({ userId: session.userId, userName: session.name, action: "delete_user", details: `Deleted user ${id}`, status: "success" });
    return Response.json({ success: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
