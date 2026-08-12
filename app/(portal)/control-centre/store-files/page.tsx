"use client";

import { useEffect, useState } from "react";
import { useTableTools } from "@/lib/useTableTools";
import { SortableTh, TableSearch } from "@/components/TableTools";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Channel, StoreControlFile } from "@/lib/types";

export default function StoreFilesPage() {
  const [files, setFiles] = useState<StoreControlFile[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stores, setStores] = useState<{ channel: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  async function load() {
    const [filesRes, chRes, storesRes] = await Promise.all([
      authFetch("/api/store-files"),
      authFetch("/api/channels"),
      authFetch("/api/store-files/merged"),
    ]);
    if (filesRes.ok) setFiles(await filesRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    if (storesRes.ok) {
      const data: { channel: string; subChannel: string; status: string }[] = await storesRes.json();
      const counts = new Map<string, number>();
      for (const s of data) {
        const key = s.subChannel || s.channel;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      setStores(Array.from(counts.entries()).map(([channel, count]) => ({ channel, count })));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(file: File) {
    setError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await authFetch("/api/store-files", {
        method: "POST",
        body: formData,
        rawBody: true,
        headers: {},
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Upload failed");
      } else {
        setToast("Store file uploaded successfully");
        setTimeout(() => setToast(""), 3000);
        load();
      }
    } catch {
      setError("Network error");
    } finally {
      setUploading(false);
    }
  }

  function resolveChannelNames(ids: string[]): string[] {
    return ids.map((id) => channels.find((c) => c.id === id)?.name ?? id);
  }

  const fileTools = useTableTools<StoreControlFile>(
    files,
    {
      fileName: (f) => f.fileName,
      channels: (f) => resolveChannelNames(f.mainChannelIds).join(", "),
      rows: (f) => f.rowCount,
      // Sort on the instant, not the rendered date string, or "01 Feb" would
      // sort before "02 Jan".
      uploaded: (f) => Date.parse(f.uploadedAt) || 0,
    },
    "uploaded",
    (f) => [f.fileName, resolveChannelNames(f.mainChannelIds).join(" "), f.rowCount,
      new Date(f.uploadedAt).toLocaleDateString(), f.uploadedBy ?? ""].join(" "),
  );

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Store Control Files
      </h1>

      {/* Info banner */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Channels and sub-channels are auto-detected from the file&apos;s <strong>Channel</strong> and <strong>Sub_Channel</strong> columns.
      </div>

      {/* Store count cards */}
      {stores.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {stores.map((s) => (
            <div key={s.channel} className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2.5">
              <div className="text-xs font-medium text-[var(--color-text-muted)]">{s.channel}</div>
              <div className="text-lg font-bold text-[var(--color-primary)]">{s.count} stores</div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Upload section */}
      <div className="mb-8 rounded-xl border border-[var(--color-border)] bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">Upload Store File</h2>
        <UploadZone
          onFile={handleUpload}
          accept=".xlsx,.xls,.xlsm"
          label={uploading ? "Uploading..." : "Drop a store master Excel file here"}
          disabled={uploading}
        />
      </div>

      {/* Current files table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Uploaded Files</h2>
          <TableSearch value={fileTools.query} onChange={fileTools.setQuery}
            count={fileTools.rows.length} total={fileTools.total} placeholder="Search files…" />
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : files.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">No store files uploaded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {[["File Name", "fileName"], ["Channels", "channels"], ["Rows", "rows"], ["Uploaded", "uploaded"]].map(([label, key]) => (
                  <SortableTh key={key} label={label} sortKey={key} className="px-6"
                    current={fileTools.sortKey} dir={fileTools.sortDir} onSort={fileTools.toggleSort} />
                ))}
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fileTools.rows.map((f) => (
                <tr key={f.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-6 py-3 font-medium text-[var(--color-text)]">{f.fileName}</td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1">
                      {resolveChannelNames(f.mainChannelIds).map((name) => (
                        <span key={name} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{f.rowCount}</td>
                  <td className="px-6 py-3 text-[var(--color-text-muted)]">{new Date(f.uploadedAt).toLocaleDateString()}</td>
                  <td className="px-6 py-3">
                    <button
                      onClick={async () => {
                        if (!confirm("Delete this store file?")) return;
                        await authFetch(`/api/store-files/${f.id}`, { method: "DELETE" });
                        load();
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
