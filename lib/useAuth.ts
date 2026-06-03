"use client";

import { useState, useEffect, useCallback } from "react";
import type { SessionPayload } from "./types";
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
