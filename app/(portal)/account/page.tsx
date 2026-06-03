"use client";

import { useState, FormEvent } from "react";
import { useAuth, authFetch } from "@/lib/useAuth";
import PasswordInput from "@/components/PasswordInput";

export default function AccountPage() {
  const { user } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

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
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

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
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-[var(--color-text-muted)]">Name</span>
            <div className="font-medium text-[var(--color-text)]">
              {user?.name}
            </div>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Email</span>
            <div className="font-medium text-[var(--color-text)]">
              {user?.email}
            </div>
          </div>
          <div>
            <span className="text-[var(--color-text-muted)]">Role</span>
            <div className="font-medium text-[var(--color-text)]">
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
