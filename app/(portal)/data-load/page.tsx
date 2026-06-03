"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Client, Channel, FileType } from "@/lib/types";

type Step = "select" | "upload" | "result";

export default function DataLoadPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("select");
  const [clientId, setClientId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [fileType, setFileType] = useState<FileType>("dispo");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; rowCount?: number } | null>(null);

  async function load() {
    const [cRes, chRes] = await Promise.all([
      authFetch("/api/clients"),
      authFetch("/api/channels"),
    ]);
    if (cRes.ok) setClients(await cRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const selectedClient = clients.find((c) => c.id === clientId);
  const subChannels = channels.filter((c) => c.parentId);
  const availableChannels = selectedClient
    ? subChannels.filter((ch) => selectedClient.channelIds.includes(ch.id))
    : subChannels;

  async function handleUpload(file: File) {
    if (!clientId || !channelId) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientId", clientId);
    formData.append("channelId", channelId);
    formData.append("fileType", fileType);

    try {
      const res = await authFetch("/api/uploads", {
        method: "POST",
        body: formData,
        rawBody: true,
        headers: {},
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `Successfully processed ${data.rowCount} rows`, rowCount: data.rowCount });
        setStep("result");
      } else {
        setResult({ ok: false, message: data.error || "Upload failed" });
        setStep("result");
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
      setStep("result");
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setStep("select");
    setResult(null);
  }

  if (loading) return <div className="p-8 text-sm text-[var(--color-text-muted)]">Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">Data Load</h1>

      {/* Step indicators */}
      <div className="mb-8 flex gap-4">
        {[
          { key: "select", label: "1. Select" },
          { key: "upload", label: "2. Upload" },
          { key: "result", label: "3. Result" },
        ].map((s) => (
          <div key={s.key} className={`flex items-center gap-2 text-sm font-medium ${step === s.key ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === s.key ? "bg-[var(--color-primary)] text-white" : "bg-zinc-200 text-zinc-500"}`}>
              {s.label[0]}
            </div>
            {s.label}
          </div>
        ))}
      </div>

      {step === "select" && (
        <div className="max-w-lg rounded-xl border border-[var(--color-border)] bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-text)]">Select Client & Channel</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Client</label>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setChannelId(""); }}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                <option value="">Select a client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.vendorNumbers.join(", ")})</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Channel</label>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" disabled={!clientId}>
                <option value="">Select a channel...</option>
                {availableChannels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">File Type</label>
              <div className="flex gap-3">
                <button onClick={() => setFileType("dispo")}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${fileType === "dispo" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                  DISPO
                </button>
                <button onClick={() => setFileType("aged_stock")}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${fileType === "aged_stock" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                  Aged Stock
                </button>
              </div>
            </div>
            <button onClick={() => setStep("upload")} disabled={!clientId || !channelId}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      )}

      {step === "upload" && (
        <div className="max-w-lg">
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-white px-4 py-3">
            <div className="text-sm">
              <strong>Client:</strong> {selectedClient?.name} &middot;{" "}
              <strong>Channel:</strong> {channels.find((c) => c.id === channelId)?.name} &middot;{" "}
              <strong>Type:</strong> {fileType === "dispo" ? "DISPO" : "Aged Stock"}
            </div>
          </div>
          <UploadZone
            onFile={handleUpload}
            label={uploading ? "Processing..." : `Drop your ${fileType === "dispo" ? "DISPO" : "Aged Stock"} Excel file here`}
            disabled={uploading}
          />
          <button onClick={() => setStep("select")} className="mt-3 text-sm text-[var(--color-text-muted)] hover:underline">
            Back to selection
          </button>
        </div>
      )}

      {step === "result" && result && (
        <div className="max-w-lg">
          <div className={`rounded-xl border p-6 ${result.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className={`mb-2 text-lg font-bold ${result.ok ? "text-green-700" : "text-red-700"}`}>
              {result.ok ? "Upload Successful" : "Upload Failed"}
            </div>
            <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>
              {result.message}
            </p>
          </div>
          <button onClick={reset} className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
