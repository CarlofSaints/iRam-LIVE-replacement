"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { useAuth } from "@/lib/useAuth";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLocal = searchParams.get("local") === "true";
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLocal) return;
    if (user) {
      if (user.forcePasswordChange) router.replace("/account");
      else router.replace("/");
      return;
    }
    const hubUrl = process.env.NEXT_PUBLIC_IRAM_HUB_URL || "https://iram-hub.vercel.app";
    const callback = `${window.location.origin}/sso/callback`;
    window.location.href = `${hubUrl}/login?redirect=${encodeURIComponent(callback)}&module=iram-live`;
  }, [isLocal, router, user]);

  if (!isLocal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="mb-4 text-sm text-[var(--color-text-muted)]">Redirecting to iRam Hub...</div>
          <button onClick={() => {
            const hubUrl = process.env.NEXT_PUBLIC_IRAM_HUB_URL || "https://iram-hub.vercel.app";
            const callback = `${window.location.origin}/sso/callback`;
            window.location.href = `${hubUrl}/login?redirect=${encodeURIComponent(callback)}&module=iram-live`;
          }} className="text-sm text-[var(--color-primary)] hover:underline">
            Click here if not redirected
          </button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); setLoading(false); return; }
      login(data.user);
      if (data.user.forcePasswordChange) router.push("/account");
      else router.push("/");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md">
        <div className="rounded-t-xl bg-[var(--color-primary)] px-8 py-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-white/20 text-xl font-bold text-white">L</div>
          <h1 className="text-xl font-bold text-white">iRam LIVE</h1>
          <p className="mt-1 text-sm text-white/80">OuterJoin</p>
        </div>
        <div className="border-x border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700">
          Emergency local login — normal access is via iRam Hub
        </div>
        <div className="rounded-b-xl border border-t-0 border-[var(--color-border)] bg-white px-8 py-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" className="w-full rounded-lg border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">Password</label>
              <PasswordInput id="password" name="password" value={password} onChange={setPassword} placeholder="Enter your password" required />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <div className="mt-6 text-center">
            <a href="/forgot-password" className="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]">Forgot password?</a>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">Powered by OuterJoin</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-50"><div className="text-sm text-zinc-400">Loading...</div></div>}>
      <LoginInner />
    </Suspense>
  );
}
