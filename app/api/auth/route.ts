import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, verifyPassword, updateUser } from "@/lib/userData";
import { encodeSession, sessionCookieOptions, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import type { SessionPayload } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return Response.json({ error: "Email and password are required" }, { status: 400, headers: noCacheHeaders() });
    }
    const user = await getUserByEmail(email);
    if (!user || !user.active) {
      return Response.json({ error: "Invalid credentials" }, { status: 401, headers: noCacheHeaders() });
    }
    const valid = await verifyPassword(user, password);
    if (!valid) {
      return Response.json({ error: "Invalid credentials" }, { status: 401, headers: noCacheHeaders() });
    }
    await updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    const session: SessionPayload = {
      userId: user.id, email: user.email, name: user.name, role: user.role, forcePasswordChange: user.forcePasswordChange,
    };
    const encoded = encodeSession(session);
    const cookieOpts = sessionCookieOptions();
    const res = NextResponse.json({ user: session }, { headers: noCacheHeaders() });
    res.cookies.set(cookieOpts.name, encoded, cookieOpts);
    await addLog({ userId: user.id, userName: user.name, action: "login", details: `Logged in as ${user.role}`, status: "success" });
    return res;
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE() {
  const cookieOpts = sessionCookieOptions(0);
  const res = NextResponse.json({ success: true }, { headers: noCacheHeaders() });
  res.cookies.set(cookieOpts.name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
