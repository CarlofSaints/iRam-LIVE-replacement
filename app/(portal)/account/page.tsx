"use client";

import { useState, useRef, FormEvent } from "react";
import { useAuth, authFetch } from "@/lib/useAuth";
import PasswordInput from "@/components/PasswordInput";

export default function AccountPage() {
  const { user, login } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleAvatarUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/account/avatar", {
        method: "POST",
        body: formData,
        rawBody: true,
        headers: {},
      });
      const data = await res.json();
      if (res.ok && data.session) {
        login(data.session);
      }
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPw !== confirmPw) {
      setError("New passwords do not match");
      return;
    }

    if (newPw.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPw,
          newPassword: newPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change password");
      } else {
        setSuccess("Password changed successfully");
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
        // Update localStorage session so AppShell stops redirecting here
        if (data.session) {
          localStorage.setItem("iram-live-session", JSON.stringify(data.session));
          window.location.href = "/";
        }
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Account
      </h1>

      {user?.forcePasswordChange && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You must change your password before continuing.
        </div>
      )}

      {/* Profile info */}
      <div className="mb-8 rounded-xl border border-[var(--color-border)] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Profile
        </h2>
        <div className="mb-6 flex items-center gap-5">
          <div className="relative">
            {user?.profilePicUrl ? (
              <img
                src={user.profilePicUrl}
                alt={user.name}
                className="h-20 w-20 rounded-full object-cover border-2 border-[var(--color-border)]"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-primary)] text-2xl font-bold text-white">
                {initials}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-white border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-zinc-50 disabled:opacity-50"
              title="Upload photo"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAvatarUpload(f);
                e.target.value = "";
              }}
            />
          </div>
          <div>
            <div className="text-lg font-semibold text-[var(--color-text)]">{user?.name}</div>
            <div className="text-sm text-[var(--color-text-muted)]">{user?.email}</div>
            <div className="mt-1 inline-block rounded-full bg-[var(--color-primary)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)]">
              {user?.role.replace("_", " ")}
            </div>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          Change Password
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
              {success}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Current Password
            </label>
            <PasswordInput
              value={currentPw}
              onChange={setCurrentPw}
              placeholder="Current password"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              New Password
            </label>
            <PasswordInput
              value={newPw}
              onChange={setNewPw}
              placeholder="New password"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Confirm New Password
            </label>
            <PasswordInput
              value={confirmPw}
              onChange={setConfirmPw}
              placeholder="Confirm password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            {loading ? "Changing..." : "Change Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
