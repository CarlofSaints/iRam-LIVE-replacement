import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getUserById, verifyPassword, setUserPassword, updateUser } from "@/lib/userData";
import { requireLogin, encodeSession, sessionCookieOptions, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";

export async function POST(req: NextRequest) {
  try {
    const session = requireLogin(req);
    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return Response.json({ error: "Current password and new password are required" }, { status: 400, headers: noCacheHeaders() });
    }
    const user = await getUserById(session.userId);
    if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: noCacheHeaders() });
    const valid = await verifyPassword(user, currentPassword);
    if (!valid) return Response.json({ error: "Current password is incorrect" }, { status: 401, headers: noCacheHeaders() });
    await setUserPassword(user.id, newPassword);
    await updateUser(user.id, { forcePasswordChange: false });
    await addLog({ userId: user.id, userName: user.name, action: "change_password", details: "Password changed successfully", status: "success" });

    // Re-issue session with forcePasswordChange cleared
    const updatedSession = { ...session, forcePasswordChange: false };
    const cookieStore = await cookies();
    const { name, ...opts } = sessionCookieOptions();
    cookieStore.set(name, encodeSession(updatedSession), opts);

    return Response.json({ success: true, session: updatedSession }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
