"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Client, Channel, CAM, ControlFileType, UploadMeta } from "@/lib/types";

const CF_LABELS: Record<ControlFileType, string> = {
  pmf: "PMF (Product Management File)",
  links: "Links",
  ranging: "Ranging",
  custom_sites: "Custom Sites",
  promotions: "Promotions",
};
const CF_TYPES: ControlFileType[] = ["pmf", "links", "ranging", "custom_sites", "promotions"];

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cams, setCams] = useState<CAM[]>([]);
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"details" | "control" | "uploads">("details");
  const [uploading, setUploading] = useState<ControlFileType | null>(null);
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", vendorNumbers: "", camId: "", channelIds: [] as string[], notes: "",
  });

  async function load() {
    const [cRes, chRes, camRes, uRes] = await Promise.all([
      authFetch(`/api/clients/${id}`),
      authFetch("/api/channels"),
      authFetch("/api/cams"),
      authFetch(`/api/uploads?clientId=${id}`),
    ]);
    if (cRes.ok) setClient(await cRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    if (camRes.ok) setCams(await camRes.json());
    if (uRes.ok) setUploads(await uRes.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleControlFileUpload(type: ControlFileType, file: File) {
    setUploading(type);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    const res = await authFetch(`/api/clients/${id}/control-files`, {
      method: "POST",
      body: formData,
      rawBody: true,
      headers: {},
    });
    if (res.ok) {
      setToast(`${CF_LABELS[type]} uploaded`);
      setTimeout(() => setToast(""), 3000);
      load();
    }
    setUploading(null);
  }

  async function handleControlFileDelete(type: ControlFileType) {
    if (!confirm(`Delete ${CF_LABELS[type]}?`)) return;
    await authFetch(`/api/clients/${id}/control-files/${type}`, { method: "DELETE" });
    load();
  }

  const subChannels = channels.filter((c) => c.parentId);

  function startEdit() {
    if (!client) return;
    setEditForm({
      name: client.name,
      vendorNumbers: client.vendorNumbers.join(", "),
      camId: client.camId ?? "",
      channelIds: [...client.channelIds],
      notes: client.notes ?? "",
    });
    setEditing(true);
  }

  function toggleEditChannel(chId: string) {
    setEditForm((prev) => ({
      ...prev,
      channelIds: prev.channelIds.includes(chId)
        ? prev.channelIds.filter((x) => x !== chId)
        : [...prev.channelIds, chId],
    }));
  }

  async function saveEdit() {
    setSaving(true);
    const res = await authFetch(`/api/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: editForm.name,
        vendorNumbers: editForm.vendorNumbers.split(",").map((v) => v.trim()).filter(Boolean),
        camId: editForm.camId || undefined,
        channelIds: editForm.channelIds,
        notes: editForm.notes || undefined,
      }),
    });
    if (res.ok) {
      setEditing(false);
      setToast("Client updated");
      setTimeout(() => setToast(""), 3000);
      load();
    }
    setSaving(false);
  }

  if (loading) return <div className="p-8 text-sm text-[var(--color-text-muted)]">Loading...</div>;
  if (!client) return <div className="p-8 text-sm text-red-600">Client not found</div>;

  const cam = cams.find((c) => c.id === client.camId);

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-[var(--color-text)]">{client.name}</h1>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">Vendor: {client.vendorNumbers.join(", ")}</p>

      {toast && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{toast}</div>}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {(["details", "control", "uploads"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
            {t === "details" ? "Details" : t === "control" ? "Control Files" : "Uploads"}
          </button>
        ))}
      </div>

      {tab === "details" && !editing && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
          <div className="mb-4 flex justify-end">
            <button onClick={startEdit} className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">Edit</button>
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div><span className="text-[var(--color-text-muted)]">CAM</span><div className="font-medium">{cam ? `${cam.name} ${cam.surname}` : "Not assigned"}</div></div>
            <div><span className="text-[var(--color-text-muted)]">Status</span><div className="font-medium">{client.active ? "Active" : "Inactive"}</div></div>
            <div>
              <span className="text-[var(--color-text-muted)]">Channels</span>
              <div className="mt-1 flex flex-wrap gap-1">{client.channelIds.map((cid) => {
                const ch = channels.find((x) => x.id === cid);
                return <span key={cid} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{ch?.name ?? cid}</span>;
              })}</div>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Linked Clients</span>
              <div className="font-medium">{client.linkedClientIds.length > 0 ? client.linkedClientIds.join(", ") : "None"}</div>
            </div>
            {client.notes && <div className="col-span-2"><span className="text-[var(--color-text-muted)]">Notes</span><div className="mt-1">{client.notes}</div></div>}
          </div>
        </div>
      )}

      {tab === "details" && editing && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Client Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Vendor Numbers (comma-separated)</label>
                <input value={editForm.vendorNumbers} onChange={(e) => setEditForm({ ...editForm, vendorNumbers: e.target.value })}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">CAM</label>
              <select value={editForm.camId} onChange={(e) => setEditForm({ ...editForm, camId: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                <option value="">No CAM assigned</option>
                {cams.map((c) => <option key={c.id} value={c.id}>{c.name} {c.surname}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text)]">Channels</label>
              <div className="flex flex-wrap gap-2">
                {subChannels.map((ch) => (
                  <button key={ch.id} type="button" onClick={() => toggleEditChannel(ch.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${editForm.channelIds.includes(ch.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                    {ch.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">Notes</label>
              <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" rows={2} />
            </div>
            <div className="flex gap-3">
              <button onClick={saveEdit} disabled={saving}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setEditing(false)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-zinc-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "control" && (
        <div className="space-y-4">
          {CF_TYPES.map((type) => {
            const meta = client.controlFiles[type];
            return (
              <div key={type} className="rounded-xl border border-[var(--color-border)] bg-white p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{CF_LABELS[type]}</h3>
                  {meta && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-text-muted)]">{meta.rowCount} rows &middot; {new Date(meta.uploadedAt).toLocaleDateString()}</span>
                      <button onClick={() => handleControlFileDelete(type)} className="text-xs text-red-500 hover:underline">Remove</button>
                    </div>
                  )}
                </div>
                {meta ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">Uploaded</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{meta.fileName}</span>
                  </div>
                ) : (
                  <UploadZone
                    onFile={(f) => handleControlFileUpload(type, f)}
                    label={uploading === type ? "Uploading..." : `Upload ${CF_LABELS[type]}`}
                    disabled={uploading !== null}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "uploads" && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white">
          {uploads.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">No uploads for this client.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-6 py-3">Channel</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Vendor</th>
                  <th className="px-6 py-3">Rows</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-6 py-3">{u.subChannelName ?? u.channelName}</td>
                    <td className="px-6 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.fileType === "dispo" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{u.fileType === "dispo" ? "DISPO" : "Aged Stock"}</span></td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{u.vendorNumber}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{u.rowCount}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">{new Date(u.uploadDate).toLocaleDateString()}</td>
                    <td className="px-6 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "processed" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{u.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
