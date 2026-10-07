import crypto from "crypto";
import { NextRequest } from "next/server";
import type { SessionPayload, PermissionKey } from "./types";
import { SYSTEM_ROLES } from "./types";
import { getRolePermissions } from "./roleData";
import { hasPermission } from "./roles";

const COOKIE_NAME = "iram-live-session";

export function noCacheHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
}

/* ── Signed session cookie ──
   The cookie used to be plain base64(JSON): anyone could write their own and
   claim super_admin, and the repo is public. It is now
   "v1.<payload>.<HMAC-SHA256>" with an expiry inside the signed payload, so
   it can't be edited and a copied cookie stops working when it expires.

   The key is SESSION_SECRET, else REPORT_LINK_SECRET (already a server-only
   secret on every deployment). There is NO constant fallback: a fallback in a
   public repo is a published key. Production without a key accepts no
   sessions at all; local dev gets a random key per process. */
const SESSION_TTL_SECONDS = 60 * 60 * 24;
let devKey: string | null = null;

function sessionKey(): string | null {
  const k = (process.env.SESSION_SECRET || process.env.REPORT_LINK_SECRET || "").trim();
  if (k) return k;
  if (process.env.NODE_ENV === "production") return null;
  devKey ??= crypto.randomBytes(32).toString("hex");
  return devKey;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(body: string, key: string): string {
  return b64url(crypto.createHmac("sha256", key).update(body).digest());
}

export function encodeSession(payload: SessionPayload, ttlSeconds = SESSION_TTL_SECONDS): string {
  const key = sessionKey();
  if (!key) throw new AuthError("Sign-in is not configured on this server (no SESSION_SECRET)", 500);
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `v1.${body}.${sign(body, key)}`;
}

export function decodeSession(cookie: string): SessionPayload | null {
  const key = sessionKey();
  if (!key) return null;
  const [ver, body, sig] = cookie.split(".");
  if (ver !== "v1" || !body || !sig) return null; // includes every old unsigned cookie
  const want = Buffer.from(sign(body, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const { exp, ...payload } = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    ) as SessionPayload & { exp?: number };
    if (typeof exp !== "number" || exp < Date.now() / 1000) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** The seed routes can create a super admin and reset ANY user's password.
 *  A short secret was once written into this public repo's CLAUDE.md, so
 *  anything under 32 characters is refused outright: the routes stay shut
 *  until SUPER_ADMIN_SEED_SECRET is rotated to a long random value. */
export function seedSecretOk(sent: string | null): boolean {
  const want = (process.env.SUPER_ADMIN_SEED_SECRET || "").trim();
  if (want.length < 32 || !sent) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function getSession(req: NextRequest): SessionPayload | null {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return decodeSession(cookie);
}

export function requireLogin(req: NextRequest): SessionPayload {
  const session = getSession(req);
  if (!session) throw new AuthError("Not authenticated", 401);
  return session;
}

export function requireRole(
  req: NextRequest,
  minRole: string
): SessionPayload {
  const session = requireLogin(req);
  const hierarchy = [...SYSTEM_ROLES];
  const roleIdx = hierarchy.indexOf(session.role as (typeof SYSTEM_ROLES)[number]);
  const minIdx = hierarchy.indexOf(minRole as (typeof SYSTEM_ROLES)[number]);
  const effectiveRole = roleIdx === -1 ? hierarchy.length : roleIdx;
  const effectiveMin = minIdx === -1 ? hierarchy.length : minIdx;
  if (effectiveRole > effectiveMin) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return session;
}

export async function requirePermission(
  req: NextRequest,
  perm: PermissionKey
): Promise<SessionPayload> {
  const session = requireLogin(req);
  if (session.role === "super_admin") return session;
  const rolePerms = await getRolePermissions();
  if (!hasPermission(rolePerms, session.role, perm)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return session;
}

/**
 * Enforce client scoping. If the session is restricted to specific client IDs
 * (external "client" accounts), reject any request for a client outside that
 * set. Unrestricted sessions (empty/undefined clientIds) pass through.
 */
export function assertClientAccess(session: SessionPayload, clientId: string): void {
  const allowed = session.clientIds;
  if (allowed && allowed.length > 0 && !allowed.includes(clientId)) {
    throw new AuthError("You do not have access to this client", 403);
  }
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24) {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function handleAuthError(err: unknown) {
  if (err instanceof AuthError) {
    return Response.json(
      { error: err.message },
      { status: err.status, headers: noCacheHeaders() }
    );
  }
  console.error(err);
  return Response.json(
    { error: "Internal server error" },
    { status: 500, headers: noCacheHeaders() }
  );
}
