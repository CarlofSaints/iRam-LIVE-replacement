import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getUsers, createUser, updateUser, deleteUser, pickNotifyFlags, pickStoreReportScope } from "@/lib/userData";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import { NO_LOGIN_ROLES, type User } from "@/lib/types";
import { isLimitedToOwnClients } from "@/lib/storeReportScope";

// Who may see which client's data is worth a line in the activity log.
function scopeNote(u: User): string {
  if (!isLimitedToOwnClients(u)) return "";
  const ids = u.storeReportClientIds ?? [];
  return ids.length
    ? ` · store reports limited to client(s) ${ids.join(", ")}`
    : " · store reports limited to own clients, NONE ticked (nothing will send)";
}

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
    const { name, email, role, forcePasswordChange, clientIds } = body;
    // A Rep never logs in, so nobody should know their password: mint a random
    // one rather than asking the admin to invent one.
    const noLogin = NO_LOGIN_ROLES.includes(role);
    const password = noLogin ? randomBytes(32).toString("base64url") : body.password;
    if (!name || !email || !password || !role) {
      return Response.json({ error: "All fields are required" }, { status: 400, headers: noCacheHeaders() });
    }
    // Notification tickboxes are honoured at CREATE time, not only on a later
    // edit — pickNotifyFlags keeps this in step with the User flag list.
    const user = await createUser({
      name, email, password, role,
      forcePasswordChange: noLogin ? false : (forcePasswordChange ?? true),
      clientIds: Array.isArray(clientIds) ? clientIds : undefined,
      ...pickNotifyFlags(body),
      ...pickStoreReportScope(body),
    });
    await addLog({ userId: session.userId, userName: session.name, action: "create_user", details: `Created user ${email} (${role})${scopeNote(user)}`, status: "success" });
    const { password: _, ...safe } = user;
    return Response.json(safe, { status: 201, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_users");
    const { id, password: _pw, storeReportOwnClientsOnly: _o, storeReportClientIds: _c, ...rest } = await req.json();
    if (!id) return Response.json({ error: "ID required" }, { status: 400, headers: noCacheHeaders() });
    const updates = { ...rest, ...pickStoreReportScope({ storeReportOwnClientsOnly: _o, storeReportClientIds: _c }) };
    const user = await updateUser(id, updates);
    await addLog({ userId: session.userId, userName: session.name, action: "update_user", details: `Updated user ${user.email}${scopeNote(user)}`, status: "success" });
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
