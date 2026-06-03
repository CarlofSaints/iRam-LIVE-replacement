"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Channel, StoreControlFile } from "@/lib/types";

export default function StoreFilesPage() {
  const [files, setFiles] = useState<StoreControlFile[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stores, setStores] = useState<{ channel: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedMainChannel, setSelectedMainChannel] = useState("");
  const [selectedSubChannels, setSelectedSubChannels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const mainChannels = channels.filter((c) => !c.parentId);
  const subChannels = channels.filter((c) => c.parentId && c.parentId === selectedMainChannel);

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
      // Count per sub-channel
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

  function toggleSubChannel(id: string) {
    setSelectedSubChannels((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleUpload(file: File) {
    if (selectedSubChannels.length === 0) {
      setError("Select at least one sub-channel this file covers");
      return;
    }
    setError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("subChannelIds", JSON.stringify(selectedSubChannels));

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
        setSelectedSubChannels([]);
        setTimeout(() => setToast(""), 3000);
        load();
      }
    } catch {
      setError("Network error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Store Control Files
      </h1>

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

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-[var(--color-text)]">Main Channel</label>
          <select value={selectedMainChannel} onChange={(e) => { setSelectedMainChannel(e.target.value); setSelectedSubChannels([]); }}
            className="w-full max-w-xs rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">Select a main channel...</option>
            {mainChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
        </div>

        {selectedMainChannel && subChannels.length > 0 && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[var(--color-text)]">
              Which sub-channels does this file cover?
            </label>
            <div className="flex flex-wrap gap-2">
              {subChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => toggleSubChannel(ch.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedSubChannels.includes(ch.id)
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-300"
                  }`}
                >
                  {ch.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedMainChannel && subChannels.length === 0 && (
          <div className="mb-4 text-sm text-[var(--color-text-muted)]">No sub-channels for this main channel.</div>
        )}

        <UploadZone
          onFile={handleUpload}
          accept=".xlsx,.xls,.xlsm"
          label={uploading ? "Uploading..." : "Drop a store master Excel file here"}
          disabled={uploading}
        />
      </div>

      {/* Current files table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        <div className="border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Uploaded Files</h2>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
        ) : files.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">No store files uploaded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-6 py-3">File Name</th>
                <th className="px-6 py-3">Sub-Channels</th>
                <th className="px-6 py-3">Rows</th>
                <th className="px-6 py-3">Uploaded</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-6 py-3 font-medium text-[var(--color-text)]">{f.fileName}</td>
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap gap-1">
                      {f.subChannelIds.map((id) => {
                        const ch = channels.find((c) => c.id === id);
                        return (
                          <span key={id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {ch?.name ?? id}
                          </span>
                        );
                      })}
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
