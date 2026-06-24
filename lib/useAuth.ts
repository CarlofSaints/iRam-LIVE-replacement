"use client";

import { useState, useEffect, useCallback } from "react";
import type { SessionPayload, RolePermissions, PermissionKey } from "./types";
import { SYSTEM_ROLES } from "./types";

interface AuthState {
  user: SessionPayload | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
  });

  useEffect(() => {
    const stored = localStorage.getItem("iram-live-session");
    if (stored) {
      try {
        const user = JSON.parse(stored) as SessionPayload;
        setState({ user, loading: false });
      } catch {
        localStorage.removeItem("iram-live-session");
        setState({ user: null, loading: false });
      }
    } else {
      setState({ user: null, loading: false });
    }
  }, []);

  const login = useCallback((user: SessionPayload) => {
    localStorage.setItem("iram-live-session", JSON.stringify(user));
    setState({ user, loading: false });
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem("iram-live-session");
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }, []);

  const hasRole = useCallback(
    (minRole: string): boolean => {
      if (!state.user) return false;
      const hierarchy = [...SYSTEM_ROLES];
      const roleIdx = hierarchy.indexOf(state.user.role as (typeof SYSTEM_ROLES)[number]);
      const minIdx = hierarchy.indexOf(minRole as (typeof SYSTEM_ROLES)[number]);
      const effectiveRole = roleIdx === -1 ? hierarchy.length : roleIdx;
      const effectiveMin = minIdx === -1 ? hierarchy.length : minIdx;
      return effectiveRole <= effectiveMin;
    },
    [state.user]
  );

  return {
    user: state.user,
    loading: state.loading,
    login,
    logout,
    hasRole,
    isAuthenticated: !!state.user,
  };
}

/**
 * Client-side permission check. Fetches the role→permissions matrix once and
 * exposes `can(perm)`. Super-admin always passes. `loaded` lets callers avoid a
 * "no access" flash before the matrix arrives. (Authoritative checks still live
 * server-side via requirePermission — this only governs UI visibility.)
 */
export function usePermissions() {
  const { user } = useAuth();
  const [perms, setPerms] = useState<RolePermissions[] | null>(null);

  useEffect(() => {
    let active = true;
    authFetch("/api/role-permissions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) setPerms(d as RolePermissions[] | null); })
      .catch(() => { if (active) setPerms(null); });
    return () => { active = false; };
  }, []);

  const can = useCallback(
    (perm: PermissionKey | string): boolean => {
      if (!user) return false;
      if (user.role === "super_admin") return true;
      if (!perms) return false;
      const entry = perms.find((p) => p.role === user.role);
      return entry ? entry.permissions.includes(perm as PermissionKey) : false;
    },
    [user, perms],
  );

  return { can, loaded: user?.role === "super_admin" || perms !== null };
}

export async function authFetch(
  url: string,
  options: RequestInit & { rawBody?: boolean } = {}
): Promise<Response> {
  const { rawBody, ...fetchOptions } = options;
  const headers: Record<string, string> = {};
  if (!rawBody) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      ...headers,
      ...(fetchOptions.headers as Record<string, string>),
    },
  });
}
