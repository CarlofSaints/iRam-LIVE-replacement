"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch, usePermissions } from "@/lib/useAuth";
import type { LogEntry } from "@/lib/types";
import SearchSelect from "@/components/SearchSelect";

// Friendly labels for the machine-style action codes. Anything not listed is
// already human-readable (e.g. "Downloaded Month-End report") and passes through.
const ACTION_LABELS: Record<string, string> = {
  upload_dispo: "Loaded DISPO",
  upload_control_file: "Loaded Control File",
  upload_store_file: "Loaded Store File",
  create_client: "Added Client",
  update_client: "Updated Client",
  delete_client: "Deleted Client",
  create_channel: "Added Channel",
  update_channel: "Updated Channel",
  delete_channel: "Deleted Channel",
  reset_channels: "Reset Channels",
  create_cam: "Added CAM",
  update_cam: "Updated CAM",
  delete_cam: "Deleted CAM",
  create_user: "Added User",
  update_user: "Updated User",
  delete_user: "Deleted User",
  delete_upload: "Deleted Upload",
  delete_control_file: "Deleted Control File",
  delete_store_file: "Deleted Store File",
  save_links_mapping: "Saved LINKS Mapping",
  save_product_mapping: "Saved Product Mapping",
  rebuild_product_master: "Rebuilt Product Master",
  auto_detect_statuses: "Auto-detected Statuses",
  update_status: "Updated Status",
  delete_status: "Deleted Status",
  update_permissions: "Updated Permissions",
  login: "Logged In",
  change_password: "Changed Password",
  reset_password: "Reset Password",
  set_password: "Set Password",
  send_reset_link: "Sent Reset Link",
  upload_client_logo: "Uploaded Client Logo",
  delete_client_logo: "Deleted Client Logo",
  upload_channel_logo: "Uploaded Channel Logo",
  delete_channel_logo: "Deleted Channel Logo",
  store_report_arm: "Armed Store Reports",
  store_report_disarm: "Disarmed Store Reports",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export default function ActivityLogPage() {
  /* The nav link is hidden without this permission and /api/logs enforces it,
     but a bookmarked or shared URL still lands here. Say no plainly rather
     than rendering an empty log, which reads as "there is no activity". */
  const { can, loaded: permsLoaded } = usePermissions();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [logRes, clientRes] = await Promise.all([
          authFetch("/api/logs"),
          authFetch("/api/clients?scope=all"),
        ]);
        if (logRes.ok) setLogs(await logRes.json());
        if (clientRes.ok) {
          const cs = await clientRes.json();
          setClients(
            (Array.isArray(cs) ? cs : [])
              .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
              .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
          );
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Distinct actions / users actually present in the log, for the dropdowns.
  const actionOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const l of logs) set.set(l.action, actionLabel(l.action));
    return [...set.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [logs]);

  const userOptions = useMemo(() => {
    return [...new Set(logs.map((l) => l.userName).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [logs]);

  // A log "belongs to" a client when it carries the structured clientName, or
  // (for historical entries) when the client's name appears in the details text.
  function matchesClient(log: LogEntry, name: string): boolean {
    if (!name) return true;
    if (log.clientName && log.clientName === name) return true;
    const d = (log.details || "").toLowerCase();
    return d.includes(name.toLowerCase());
  }

  const filtered = useMemo(() => {
    return logs.filter(
      (l) =>
        (!actionFilter || l.action === actionFilter) &&
        (!userFilter || l.userName === userFilter) &&
        matchesClient(l, clientFilter),
    );
  }, [logs, actionFilter, userFilter, clientFilter]);

  const hasFilters = !!(actionFilter || clientFilter || userFilter);

  if (permsLoaded && !can("view_activity_log")) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Activity Log</h1>
        <p className="mt-3 max-w-prose text-sm text-[var(--color-text-muted)]">
          You do not have access to the activity log. If you need it, ask an
          administrator to grant your role the <strong>View Activity Log</strong> permission.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Activity Log</h1>
        <span className="text-sm text-[var(--color-text-muted)]">
          {loading ? "" : `${filtered.length} of ${logs.length} entries`}
        </span>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Action
          </span>
          <SearchSelect
            value={actionFilter}
            onChange={setActionFilter}
            options={actionOptions}
            allLabel="All actions"
            searchLabel="actions"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Client
          </span>
          <SearchSelect
            value={clientFilter}
            onChange={setClientFilter}
            options={clients.map((c) => ({ value: c.name, label: c.name }))}
            allLabel="All clients"
            searchLabel="clients"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            User
          </span>
          <SearchSelect
            value={userFilter}
            onChange={setUserFilter}
            options={userOptions.map((u) => ({ value: u, label: u }))}
            allLabel="All users"
            searchLabel="users"
          />
        </label>

        {hasFilters && (
          <button
            onClick={() => {
              setActionFilter("");
              setClientFilter("");
              setUserFilter("");
            }}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg,#f5f7fa)]"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {logs.length === 0 ? "No activity yet." : "No entries match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-6 py-3">Time</th>
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Action</th>
                  <th className="px-6 py-3">Details</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="whitespace-nowrap px-6 py-3 text-[var(--color-text-muted)]">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 font-medium text-[var(--color-text)]">{log.userName}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-[var(--color-text)]">
                      {actionLabel(log.action)}
                    </td>
                    <td className="max-w-md px-6 py-3 text-[var(--color-text-muted)]">{log.details}</td>
                    <td className="px-6 py-3">
                      {log.status && (
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            log.status === "success"
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {log.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
