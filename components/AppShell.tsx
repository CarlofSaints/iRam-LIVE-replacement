"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // localStorage says "signed in" long after the cookie has expired or been
  // refused, and every page then reads its 401s as "no data". Ask the server
  // once; only a definite 401 signs out, a network blip leaves things alone.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" })
      .then((res) => { if (!cancelled && res.status === 401) logout(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loading, user, logout]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.forcePasswordChange && pathname !== "/account") {
      router.replace("/account");
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-white">
            L
          </div>
          <div className="text-sm text-[var(--color-text-muted)]">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-[var(--background)]">
        {children}
      </main>
    </div>
  );
}
