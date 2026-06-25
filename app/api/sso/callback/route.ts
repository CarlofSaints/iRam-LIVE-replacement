import { NextRequest, NextResponse } from "next/server";
import { verifySSOToken } from "@/lib/sso";
import { getUsers, getUserByEmail, updateUser } from "@/lib/userData";
import { writeJson } from "@/lib/blob";
import { encodeSession, sessionCookieOptions, noCacheHeaders } from "@/lib/auth";
import type { SessionPayload, User } from "@/lib/types";
import { v4 as uuid } from "uuid";

const MODULE_SLUG = "iram-live";

export async function POST(req: NextRequest) {
  const { token } = (await req.json()) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400, headers: noCacheHeaders() });

  const secret = process.env.IRAM_SSO_SECRET;
  if (!secret) return NextResponse.json({ error: "SSO not configured" }, { status: 500, headers: noCacheHeaders() });

  const payload = verifySSOToken(token, secret);
  if (!payload) return NextResponse.json({ error: "Invalid or expired SSO token" }, { status: 401, headers: noCacheHeaders() });

  if (!payload.modules.includes(MODULE_SLUG)) {
    return NextResponse.json({ error: "You do not have access to iRam LIVE" }, { status: 403, headers: noCacheHeaders() });
  }

  let user = await getUserByEmail(payload.email);

  if (!user) {
    const users = await getUsers();
    const newUser: User = {
      id: uuid(),
      name: payload.name,
      email: payload.email.toLowerCase(),
      password: "",
      role: "cam",
      forcePasswordChange: false,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    users.push(newUser);
    await writeJson("users.json", users);
    user = newUser;
  } else if (user.forcePasswordChange) {
    // SSO authenticates via the Hub — there is no LIVE password to change.
    // Clear the stale force-change gate so the user isn't trapped on /account.
    await updateUser(user.id, { forcePasswordChange: false });
    user = { ...user, forcePasswordChange: false };
  }

  const session: SessionPayload = {
    userId: user.id, email: user.email, name: user.name, role: user.role,
    forcePasswordChange: false, // SSO sessions are never force-gated
    clientIds: user.clientIds && user.clientIds.length > 0 ? user.clientIds : undefined,
  };

  const encoded = encodeSession(session);
  const cookieOpts = sessionCookieOptions();
  const res = NextResponse.json({ ok: true, user: session }, { headers: noCacheHeaders() });
  res.cookies.set(cookieOpts.name, encoded, cookieOpts);
  return res;
}
