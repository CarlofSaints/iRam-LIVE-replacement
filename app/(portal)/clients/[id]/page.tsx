"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { authFetch } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Client, Channel, CAM, ControlFileType, UploadMeta, ProductFieldMapping } from "@/lib/types";

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

  // Product mapping state
  const [pmfHeaders, setPmfHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<ProductFieldMapping>>({});
  const [autoMatched, setAutoMatched] = useState<Partial<ProductFieldMapping>>({});
  const [productCount, setProductCount] = useState<number | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);

  async function load() {
    const t = Date.now();
    const [cRes, chRes, camRes, uRes] = await Promise.all([
      authFetch(`/api/clients/${id}?t=${t}`),
      authFetch(`/api/channels?t=${t}`),
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

  // Load product mapping data when client is loaded and has PMF
  const hasPmf = !!client?.controlFiles?.pmf;
  useEffect(() => {
    if (hasPmf) {
      loadProductMapping();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPmf]);

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
      const json = await res.json();
      setToast(`${CF_LABELS[type]} uploaded`);
      setTimeout(() => setToast(""), 3000);
      await load();
      // Refresh mapping data after PMF upload (after load() updates client state)
      if (type === "pmf") {
        await loadProductMapping();
        if (json.productMasterCount != null) {
          setProductCount(json.productMasterCount);
        }
      }
    }
    setUploading(null);
  }

  // ── Product Mapping ──

  async function loadProductMapping() {
    setMappingLoading(true);
    try {
      const res = await authFetch(`/api/clients/${id}/product-mapping`);
      if (res.ok) {
        const data = await res.json();
        setPmfHeaders(data.headers ?? []);
        setAutoMatched(data.autoMatched ?? {});
        setMapping(data.mapping ?? data.autoMatched ?? {});
      } else {
        console.error("product-mapping GET failed:", res.status, await res.text().catch(() => ""));
      }
      const masterRes = await authFetch(`/api/clients/${id}/product-master`);
      if (masterRes.ok) {
        const masterData = await masterRes.json();
        setProductCount(masterData.count ?? 0);
      }
    } catch (err) {
      console.error("loadProductMapping error:", err);
    }
    setMappingLoading(false);
  }

  async function saveProductMapping() {
    if (!mapping.article) {
      setToast("Article field mapping is required");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setMappingSaving(true);
    const res = await authFetch(`/api/clients/${id}/product-mapping`, {
      method: "PUT",
      body: JSON.stringify({ mapping }),
    });
    if (res.ok) {
      const data = await res.json();
      setProductCount(data.count ?? 0);
      setToast(`Product master built — ${data.count} products mapped`);
      setTimeout(() => setToast(""), 4000);
    } else {
      setToast("Failed to save mapping");
      setTimeout(() => setToast(""), 3000);
    }
    setMappingSaving(false);
  }

  async function handleControlFileDelete(type: ControlFileType) {
    if (!confirm(`Delete ${CF_LABELS[type]}?`)) return;
    const res = await authFetch(`/api/clients/${id}/control-files/${type}`, { method: "DELETE" });
    if (res.ok) {
      setToast(`${CF_LABELS[type]} removed`);
      setTimeout(() => setToast(""), 3000);
    } else {
      const err = await res.text().catch(() => "Unknown error");
      setToast(`Failed to delete: ${err}`);
      setTimeout(() => setToast(""), 5000);
    }
    load();
  }

  const mainChannels = channels.filter((c) => !c.parentId);
  const subChannels = channels.filter((c) => c.parentId);
  const channelIdSet = new Set(channels.map((c) => c.id));

  function startEdit() {
    if (!client) return;
    // Sweep stale channel IDs that no longer exist
    const validChannelIds = client.channelIds.filter((cid) => channelIdSet.has(cid));
    setEditForm({
      name: client.name,
      vendorNumbers: client.vendorNumbers.join(", "),
      camId: client.camId ?? "",
      channelIds: validChannelIds,
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
              <div className="mt-1 flex flex-wrap gap-1">{client.channelIds.filter((cid) => channelIdSet.has(cid)).map((cid) => {
                const ch = channels.find((x) => x.id === cid);
                return <span key={cid} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{ch?.name ?? cid}</span>;
              })}
              {client.channelIds.filter((cid) => !channelIdSet.has(cid)).length > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                  {client.channelIds.filter((cid) => !channelIdSet.has(cid)).length} stale — click Edit to clean up
                </span>
              )}
              {client.channelIds.filter((cid) => channelIdSet.has(cid)).length === 0 && client.channelIds.filter((cid) => !channelIdSet.has(cid)).length === 0 && (
                <span className="text-xs text-[var(--color-text-muted)]">None assigned</span>
              )}</div>
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
              <div className="space-y-3">
                {mainChannels.map((main) => {
                  const children = subChannels.filter((s) => s.parentId === main.id);
                  return (
                    <div key={main.id}>
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{main.name}</span>
                      <div className="flex flex-wrap gap-2">
                        {children.length > 0 ? children.map((ch) => (
                          <button key={ch.id} type="button" onClick={() => toggleEditChannel(ch.id)}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${editForm.channelIds.includes(ch.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                            {ch.name}
                          </button>
                        )) : (
                          <button type="button" onClick={() => toggleEditChannel(main.id)}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${editForm.channelIds.includes(main.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                            {main.name}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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

          {/* ── Product Mapping Section (visible when PMF uploaded) ── */}
          {client.controlFiles.pmf && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Product Mapping</h3>
                  {productCount != null && productCount > 0 ? (
                    <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{productCount} products</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">Not mapped</span>
                  )}
                </div>
              </div>

              {mappingLoading ? (
                <p className="text-sm text-[var(--color-text-muted)]">Loading mapping...</p>
              ) : pmfHeaders.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No headers detected in PMF. Re-upload the PMF file.</p>
              ) : (
                <>
                  <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                    Map PMF columns to standard product fields. Article is required. {autoMatched.article && "(Auto-matched suggestions applied)"}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {([
                      { field: "article" as const, label: "Article *", required: true },
                      { field: "brand" as const, label: "Brand", required: false },
                      { field: "category" as const, label: "Category", required: false },
                      { field: "status" as const, label: "Status", required: false },
                      { field: "description" as const, label: "Description", required: false },
                      { field: "barcode" as const, label: "Barcode / EAN", required: false },
                    ]).map(({ field, label, required }) => (
                      <div key={field}>
                        <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">{label}</label>
                        <select
                          value={mapping[field] ?? ""}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))}
                          className={`w-full rounded-lg border px-3 py-2 text-sm ${required && !mapping[field] ? "border-amber-300" : "border-[var(--color-border)]"}`}
                        >
                          <option value="">— Not mapped —</option>
                          {pmfHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={saveProductMapping}
                      disabled={mappingSaving || !mapping.article}
                      className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
                    >
                      {mappingSaving ? "Saving..." : "Save & Build"}
                    </button>
                    {autoMatched.article && (
                      <button
                        onClick={() => setMapping({ ...autoMatched })}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] hover:bg-zinc-50"
                      >
                        Reset to Auto-Match
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
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
