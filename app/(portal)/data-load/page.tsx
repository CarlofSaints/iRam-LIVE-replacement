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
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportWeek, setReportWeek] = useState(Math.ceil(new Date().getDate() / 7));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    rowCount?: number;
    merge?: { inserted: number; updated: number; unchanged: number };
    missingArticles?: string[];
    missingSites?: string[];
  } | null>(null);

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

  // Show main channels that have at least one sub-channel assigned to the client
  // (client channelIds stores sub-channel IDs, not main channel IDs)
  const mainChannels = channels.filter((c) => !c.parentId);
  const subChannels = channels.filter((c) => !!c.parentId);
  const availableChannels = selectedClient
    ? mainChannels.filter((main) =>
        selectedClient.channelIds.includes(main.id) ||
        subChannels.some(
          (sub) => sub.parentId === main.id && selectedClient.channelIds.includes(sub.id)
        )
      )
    : [];

  async function handleUpload(file: File) {
    if (!clientId || !channelId) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientId", clientId);
    formData.append("channelId", channelId);
    formData.append("fileType", fileType);
    formData.append("reportYear", String(reportYear));
    formData.append("reportMonth", String(reportMonth));
    formData.append("reportWeek", String(reportWeek));

    try {
      const res = await authFetch("/api/uploads", {
        method: "POST",
        body: formData,
        rawBody: true,
        headers: {},
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          ok: true,
          message: `${data.rowCount} rows processed`,
          rowCount: data.rowCount,
          merge: data.merge,
        });
      } else {
        setResult({
          ok: false,
          message: data.error || "Upload failed",
          missingArticles: data.missingArticles,
          missingSites: data.missingSites,
        });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    }

    setStep("result");
    setUploading(false);
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
              {!clientId ? (
                <p className="text-sm text-[var(--color-text-muted)]">Select a client first</p>
              ) : availableChannels.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No main channels assigned to this client</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableChannels.map((ch) => (
                    <button key={ch.id} type="button" onClick={() => setChannelId(ch.id === channelId ? "" : ch.id)}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${channelId === ch.id ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                      {ch.name}
                    </button>
                  ))}
                </div>
              )}
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
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Report Period</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Year</label>
                  <select value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Month</label>
                  <select value={reportMonth} onChange={(e) => setReportMonth(Number(e.target.value))}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, "0")} - {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Week</label>
                  <select value={reportWeek} onChange={(e) => setReportWeek(Number(e.target.value))}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                    {[1, 2, 3, 4, 5].map((w) => (
                      <option key={w} value={w}>Week {w}</option>
                    ))}
                  </select>
                </div>
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
              <strong>Type:</strong> {fileType === "dispo" ? "DISPO" : "Aged Stock"} &middot;{" "}
              <strong>Period:</strong> {reportYear}{String(reportMonth).padStart(2, "0")} Wk{reportWeek}
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
          <div className={`rounded-xl border p-4 ${result.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className={`mb-1 text-sm font-bold ${result.ok ? "text-green-700" : "text-red-700"}`}>
              {result.ok ? "Success" : "Upload Blocked"}
            </div>
            <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>
              {result.message}
            </p>
            {result.ok && result.merge && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {result.merge.inserted} new
                </span>
                <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {result.merge.updated} updated
                </span>
                <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {result.merge.unchanged} unchanged
                </span>
              </div>
            )}
          </div>

          {/* Missing articles card */}
          {result.missingArticles && result.missingArticles.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="mb-2 text-sm font-bold text-red-700">
                Missing Articles ({result.missingArticles.length})
              </div>
              <p className="mb-2 text-xs text-red-600">
                These articles are in the DISPO but not in the LINKS file. Update the LINKS file and re-upload.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-white p-3">
                <ul className="space-y-0.5 text-xs text-red-700">
                  {result.missingArticles.slice(0, 50).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                  {result.missingArticles.length > 50 && (
                    <li className="text-red-500">+ {result.missingArticles.length - 50} more</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* Missing sites card */}
          {result.missingSites && result.missingSites.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="mb-2 text-sm font-bold text-red-700">
                Missing Stores ({result.missingSites.length})
              </div>
              <p className="mb-2 text-xs text-red-600">
                These sites are in the DISPO but not in the store master. Upload an updated store file first.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-white p-3">
                <ul className="space-y-0.5 text-xs text-red-700">
                  {result.missingSites.slice(0, 50).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  {result.missingSites.length > 50 && (
                    <li className="text-red-500">+ {result.missingSites.length - 50} more</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <button onClick={reset} className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
