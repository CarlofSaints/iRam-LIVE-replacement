"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import type { UploadMeta, Client, Channel, StoreRecord } from "@/lib/types";

interface DashboardData {
  uploads: UploadMeta[];
  clients: Client[];
  channels: Channel[];
  stores: StoreRecord[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [uploadsRes, clientsRes, channelsRes, storesRes] =
          await Promise.all([
            authFetch("/api/uploads"),
            authFetch("/api/clients"),
            authFetch("/api/channels"),
            authFetch("/api/store-files/merged"),
          ]);

        const uploads = uploadsRes.ok
          ? ((await uploadsRes.json()) as UploadMeta[])
          : [];
        const clients = clientsRes.ok
          ? ((await clientsRes.json()) as Client[])
          : [];
        const channels = channelsRes.ok
          ? ((await channelsRes.json()) as Channel[])
          : [];
        const stores = storesRes.ok
          ? ((await storesRes.json()) as StoreRecord[])
          : [];

        setData({ uploads, clients, channels, stores });
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-sm text-[var(--color-text-muted)]">
          Loading dashboard...
        </div>
      </div>
    );
  }

  const d = data ?? { uploads: [], clients: [], channels: [], stores: [] };
  const subChannels = d.channels.filter((c) => c.parentId);
  const recentUploads = d.uploads.slice(0, 10);

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Dashboard
      </h1>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={d.clients.length} color="primary" />
        <StatCard label="Sub-Channels" value={subChannels.length} color="secondary" />
        <StatCard label="Stores" value={d.stores.length} color="accent" />
        <StatCard label="Uploads" value={d.uploads.length} color="primary" />
      </div>

      {/* Recent uploads */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Recent Uploads
          </h2>
        </div>
        {recentUploads.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            No uploads yet. Go to Data Load to upload your first DISPO file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Channel</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Vendor</th>
                  <th className="px-6 py-3">Rows</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-6 py-3 font-medium text-[var(--color-text)]">
                      {u.clientName}
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">
                      {u.subChannelName ?? u.channelName}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.fileType === "dispo"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {u.fileType === "dispo" ? "DISPO" : "Aged Stock"}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">
                      {u.vendorNumber}
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">
                      {u.rowCount.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">
                      {new Date(u.uploadDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.status === "processed"
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {u.status}
                      </span>
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

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "primary" | "secondary" | "accent";
}) {
  const colorMap = {
    primary: "text-[var(--color-primary)]",
    secondary: "text-[var(--color-secondary)]",
    accent: "text-[var(--color-accent)]",
  };
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white px-6 py-5">
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold ${colorMap[color]}`}>
        {value}
      </div>
    </div>
  );
}
