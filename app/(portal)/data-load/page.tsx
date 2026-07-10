"use client";

import { useEffect, useState, useRef } from "react";
import { upload } from "@vercel/blob/client";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import SearchSelect from "@/components/SearchSelect";
import type { Client, Channel, FileType } from "@/lib/types";

type Step = "select" | "upload" | "confirm" | "result";

interface MissingArticleDetail {
  article: string;
  articleDesc: string;
  vendProd: string;
  barcode?: string;
}

interface HeaderCollision {
  field: string;
  kept: { col: string; header: string };
  dropped: { col: string; header: string }[];
}

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
  // Week must be chosen deliberately (no default guess) so every DISPO load is
  // stamped with the correct week for the load checklist.
  const [reportWeek, setReportWeek] = useState<number | "">("");
  const [uploading, setUploading] = useState(false);

  // Keep a ref to the uploaded file so we can re-submit with force=true
  const pendingFileRef = useRef<File | null>(null);
  // Blob URL of the browser-uploaded file, reused across the confirm/force step.
  const pendingBlobUrlRef = useRef<string | null>(null);

  const [confirmData, setConfirmData] = useState<{
    warning: string;
    missingArticles: MissingArticleDetail[];
    missingSites: string[];
    collisions: HeaderCollision[];
  } | null>(null);

  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    rowCount?: number;
    merge?: { inserted: number; updated: number; unchanged: number };
    warnings?: {
      missingArticles: MissingArticleDetail[];
      missingSites: string[];
      collisions?: HeaderCollision[];
    };
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

  // Show main channels that have at least one sub-channel assigned to the client,
  // plus any companion channels (e.g. Walmart rides inside Makro's DISPO export),
  // so the rep can load the shared file from either side.
  const mainChannels = channels.filter((c) => !c.parentId);
  const subChannels = channels.filter((c) => !!c.parentId);
  const availableChannels = (() => {
    if (!selectedClient) return [];
    const directMains = mainChannels.filter((main) =>
      selectedClient.channelIds.includes(main.id) ||
      subChannels.some(
        (sub) => sub.parentId === main.id && selectedClient.channelIds.includes(sub.id)
      )
    );
    const ids = new Set(directMains.map((m) => m.id));
    // companions OF the assigned mains
    for (const m of directMains) for (const cid of m.companionChannelIds ?? []) ids.add(cid);
    // mains that list an assigned main as a companion (link is bidirectional)
    for (const m of mainChannels) if (m.companionChannelIds?.some((cid) => ids.has(cid))) ids.add(m.id);
    return mainChannels.filter((m) => ids.has(m.id));
  })();

  async function submitUpload(file: File, force: boolean) {
    setUploading(true);

    try {
      // Upload the file straight to Vercel Blob from the browser so the big
      // payload never hits the ~4.5MB serverless request-body limit (which was
      // failing large DISPOs with "Network Error"). Done once; the confirm/force
      // step reuses the same blob URL.
      if (!pendingBlobUrlRef.current) {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/uploads/blob",
        });
        pendingBlobUrlRef.current = blob.url;
      }

      const res = await authFetch("/api/uploads", {
        method: "POST",
        body: JSON.stringify({
          blobUrl: pendingBlobUrlRef.current,
          fileName: file.name,
          clientId,
          channelId,
          fileType,
          reportYear,
          reportMonth,
          reportWeek,
          force,
        }),
      });
      const data = await res.json();

      if (data.needsConfirmation) {
        // Server returned validation warnings — ask the user
        pendingFileRef.current = file;
        setConfirmData({
          warning: data.warning,
          missingArticles: data.missingArticles ?? [],
          missingSites: data.missingSites ?? [],
          collisions: data.collisions ?? [],
        });
        setStep("confirm");
        setUploading(false);
        return;
      }

      if (res.ok && data.success) {
        setResult({
          ok: true,
          message: `${data.rowCount} rows processed`,
          rowCount: data.rowCount,
          merge: data.merge,
          warnings: data.warnings,
        });
      } else {
        setResult({
          ok: false,
          message: data.error || "Upload failed",
        });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    }

    setStep("result");
    setUploading(false);
  }

  function handleUpload(file: File) {
    if (!clientId || !channelId) return;
    setResult(null);
    setConfirmData(null);
    pendingBlobUrlRef.current = null; // fresh upload → new blob
    submitUpload(file, false);
  }

  async function handleForceUpload() {
    const file = pendingFileRef.current;
    if (!file) return;
    setConfirmData(null);
    await submitUpload(file, true);
  }

  function reset() {
    setStep("select");
    setResult(null);
    setConfirmData(null);
    pendingFileRef.current = null;
    pendingBlobUrlRef.current = null;
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
          <div key={s.key} className={`flex items-center gap-2 text-sm font-medium ${step === s.key || (step === "confirm" && s.key === "result") ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === s.key || (step === "confirm" && s.key === "result") ? "bg-[var(--color-primary)] text-white" : "bg-zinc-200 text-zinc-500"}`}>
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
              <SearchSelect
                value={clientId}
                onChange={(v) => { setClientId(v); setChannelId(""); }}
                options={clients.map((c) => ({ value: c.id, label: `${c.name} (${c.vendorNumbers.join(", ")})` }))}
                allLabel="Select a client..."
                searchLabel="clients"
                widthClass="w-full"
              />
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
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    Week <span className="text-red-500">*</span>
                  </label>
                  <select value={reportWeek} onChange={(e) => setReportWeek(e.target.value === "" ? "" : Number(e.target.value))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${reportWeek === "" ? "border-red-300" : "border-[var(--color-border)]"}`}>
                    <option value="">Select week…</option>
                    {[1, 2, 3, 4, 5].map((w) => (
                      <option key={w} value={w}>Week {w}</option>
                    ))}
                  </select>
                </div>
              </div>
              {reportWeek === "" && (
                <p className="mt-1.5 text-xs text-red-500">Pick the week this load is for — it&apos;s required for the DISPO checklist.</p>
              )}
            </div>
            <button onClick={() => setStep("upload")} disabled={!clientId || !channelId || reportWeek === ""}
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

      {/* ── Confirmation step — validation warnings ── */}
      {step === "confirm" && confirmData && (
        <div className="max-w-2xl">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <div className="mb-3 text-sm font-bold text-amber-800">
              Validation Warnings
            </div>
            <p className="mb-4 text-sm text-amber-700">{confirmData.warning}</p>

            {/* Missing articles table */}
            {confirmData.missingArticles.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Missing Articles ({confirmData.missingArticles.length})
                </div>
                <p className="mb-2 text-xs text-amber-600">
                  These articles are in the DISPO but not in the LINKS file.
                </p>
                <div className="max-h-64 overflow-auto rounded-lg border border-amber-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-amber-100">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Article</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Article Description</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Vend Prod Code</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Barcode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {confirmData.missingArticles.slice(0, 100).map((a, i) => (
                        <tr key={i} className="hover:bg-amber-50/50">
                          <td className="px-3 py-1 text-zinc-700">{a.article}</td>
                          <td className="px-3 py-1 text-zinc-600">{a.articleDesc || "—"}</td>
                          <td className="px-3 py-1 text-zinc-600">{a.vendProd || "—"}</td>
                          <td className="px-3 py-1 text-zinc-600">{a.barcode || "—"}</td>
                        </tr>
                      ))}
                      {confirmData.missingArticles.length > 100 && (
                        <tr><td colSpan={4} className="px-3 py-1 text-amber-600">+ {confirmData.missingArticles.length - 100} more</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Missing sites */}
            {confirmData.missingSites.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Missing Stores ({confirmData.missingSites.length})
                </div>
                <p className="mb-2 text-xs text-amber-600">
                  These sites are in the DISPO but not in the store master.
                </p>
                <div className="max-h-48 overflow-auto rounded-lg border border-amber-200 bg-white p-3">
                  <ul className="space-y-0.5 text-xs text-zinc-700">
                    {confirmData.missingSites.slice(0, 50).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                    {confirmData.missingSites.length > 50 && (
                      <li className="text-amber-600">+ {confirmData.missingSites.length - 50} more</li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            {/* Column-mapping conflicts */}
            {confirmData.collisions.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Column Mapping Conflicts ({confirmData.collisions.length})
                </div>
                <p className="mb-2 text-xs text-amber-600">
                  Two or more columns in this file map to the same field. The app kept the first
                  and ignored the rest. Check the kept column is correct — if not, fix the file
                  (rename or remove the stray column) before loading.
                </p>
                <div className="max-h-48 overflow-auto rounded-lg border border-amber-200 bg-white p-3">
                  <ul className="space-y-2 text-xs text-zinc-700">
                    {confirmData.collisions.map((c) => (
                      <li key={c.field}>
                        <span className="font-semibold">{c.field}</span> — kept{" "}
                        <span className="rounded bg-green-100 px-1 text-green-800">{`col ${c.kept.col} "${c.kept.header}"`}</span>
                        , ignored{" "}
                        {c.dropped.map((d, i) => (
                          <span key={i}>
                            {i > 0 ? " " : ""}
                            <span className="rounded bg-red-100 px-1 text-red-800">{`col ${d.col} "${d.header}"`}</span>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleForceUpload}
                disabled={uploading}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Continue Anyway"}
              </button>
              <button
                onClick={reset}
                disabled={uploading}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50"
              >
                Cancel &mdash; Fix Files First
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="max-w-2xl">
          <div className={`rounded-xl border p-4 ${result.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className={`mb-1 text-sm font-bold ${result.ok ? "text-green-700" : "text-red-700"}`}>
              {result.ok ? "Success" : "Upload Failed"}
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

          {/* Warnings on successful forced upload */}
          {result.ok && result.warnings && (
            <>
              {result.warnings.missingArticles.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 text-sm font-bold text-amber-700">
                    Missing Articles ({result.warnings.missingArticles.length}) — Uploaded Anyway
                  </div>
                  <p className="mb-2 text-xs text-amber-600">
                    These articles were not in the LINKS file. Data for these SKUs may be incomplete in reports.
                  </p>
                  <div className="max-h-48 overflow-auto rounded-lg border border-amber-200 bg-white">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-amber-100">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Article</th>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Description</th>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Vend Prod</th>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-800">Barcode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {result.warnings.missingArticles.slice(0, 30).map((a, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1 text-zinc-700">{a.article}</td>
                            <td className="px-3 py-1 text-zinc-600">{a.articleDesc || "—"}</td>
                            <td className="px-3 py-1 text-zinc-600">{a.vendProd || "—"}</td>
                            <td className="px-3 py-1 text-zinc-600">{a.barcode || "—"}</td>
                          </tr>
                        ))}
                        {result.warnings.missingArticles.length > 30 && (
                          <tr><td colSpan={4} className="px-3 py-1 text-amber-600">+ {result.warnings.missingArticles.length - 30} more</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {result.warnings.missingSites.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 text-sm font-bold text-amber-700">
                    Missing Stores ({result.warnings.missingSites.length}) — Uploaded Anyway
                  </div>
                  <div className="max-h-32 overflow-auto rounded-lg border border-amber-200 bg-white p-3">
                    <ul className="space-y-0.5 text-xs text-zinc-700">
                      {result.warnings.missingSites.slice(0, 30).map((s) => <li key={s}>{s}</li>)}
                      {result.warnings.missingSites.length > 30 && (
                        <li className="text-amber-600">+ {result.warnings.missingSites.length - 30} more</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
              {result.warnings.collisions && result.warnings.collisions.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 text-sm font-bold text-amber-700">
                    Column Mapping Conflicts ({result.warnings.collisions.length}) — Kept First Column
                  </div>
                  <p className="mb-2 text-xs text-amber-600">
                    Multiple columns mapped to the same field. Verify the kept column is the correct one.
                  </p>
                  <div className="max-h-40 overflow-auto rounded-lg border border-amber-200 bg-white p-3">
                    <ul className="space-y-2 text-xs text-zinc-700">
                      {result.warnings.collisions.map((c) => (
                        <li key={c.field}>
                          <span className="font-semibold">{c.field}</span> — kept{" "}
                          <span className="rounded bg-green-100 px-1 text-green-800">{`col ${c.kept.col} "${c.kept.header}"`}</span>
                          , ignored{" "}
                          {c.dropped.map((d, i) => (
                            <span key={i}>
                              {i > 0 ? " " : ""}
                              <span className="rounded bg-red-100 px-1 text-red-800">{`col ${d.col} "${d.header}"`}</span>
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}

          <button onClick={reset} className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
