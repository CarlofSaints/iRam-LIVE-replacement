"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";

export default function SSOCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("Missing SSO token");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/sso/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          setError(data.error || "SSO login failed");
          return;
        }

        login(data.user);

        if (data.user.forcePasswordChange) {
          router.replace("/account");
        } else {
          router.replace("/");
        }
      } catch {
        setError("Network error during SSO login");
      }
    })();
  }, [searchParams, router, login]);

  if (error) {
    const hubUrl = process.env.NEXT_PUBLIC_IRAM_HUB_URL || "https://iram-hub.vercel.app";
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-white p-8 text-center shadow-lg">
          <div className="mb-4 text-4xl text-red-500">!</div>
          <h2 className="mb-2 text-lg font-bold text-[var(--color-text)]">SSO Login Failed</h2>
          <p className="mb-6 text-sm text-[var(--color-text-muted)]">{error}</p>
          <a href={hubUrl} className="inline-block rounded-lg bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-dark)]">
            Back to iRam Hub
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="text-sm text-[var(--color-text-muted)]">Signing in...</div>
    </div>
  );
}
