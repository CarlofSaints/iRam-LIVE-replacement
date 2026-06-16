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

export function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodeSession(cookie: string): SessionPayload | null {
  try {
    return JSON.parse(
      Buffer.from(cookie, "base64").toString("utf-8")
    ) as SessionPayload;
  } catch {
    return null;
  }
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
