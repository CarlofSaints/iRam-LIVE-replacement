"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { authFetch, useAuth } from "@/lib/useAuth";
import UploadZone from "@/components/UploadZone";
import type { Client, Channel, CAM, ControlFileType, UploadMeta, ProductFieldMapping, LinksFieldMapping } from "@/lib/types";
import type { ReportConfig } from "@/lib/reportConfig";

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
  const { user } = useAuth();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const [client, setClient] = useState<Client | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cams, setCams] = useState<CAM[]>([]);
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"details" | "control" | "uploads" | "logo">("details");
  const [logo, setLogo] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
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

  // Links mapping state
  const [linksHeaders, setLinksHeaders] = useState<string[]>([]);
  const [linksMapping, setLinksMapping] = useState<Partial<LinksFieldMapping>>({});
  const [linksAutoMatched, setLinksAutoMatched] = useState<Partial<LinksFieldMapping>>({});
  const [linkCount, setLinkCount] = useState<number | null>(null);
  const [linksMappingLoading, setLinksMappingLoading] = useState(false);
  const [linksMappingSaving, setLinksMappingSaving] = useState(false);

  // Report config state
  const [rcOos, setRcOos] = useState(2);
  const [rcAlert, setRcAlert] = useState(300);
  const [rcOtoMultipliers, setRcOtoMultipliers] = useState<Record<string, number>>({});
  const [rcCategories, setRcCategories] = useState<string[]>([]);
  const [rcSpUrl, setRcSpUrl] = useState("");
  const [rcSaving, setRcSaving] = useState(false);

  async function load() {
    const t = Date.now();
    const [cRes, chRes, camRes, uRes, logoRes] = await Promise.all([
      authFetch(`/api/clients/${id}?t=${t}`),
      authFetch(`/api/channels?t=${t}`),
      authFetch("/api/cams"),
      authFetch(`/api/uploads?clientId=${id}`),
      authFetch(`/api/clients/${id}/logo?t=${t}`),
    ]);
    if (cRes.ok) setClient(await cRes.json());
    if (chRes.ok) setChannels(await chRes.json());
    if (camRes.ok) setCams(await camRes.json());
    if (uRes.ok) setUploads(await uRes.json());
    if (logoRes.ok) { const d = await logoRes.json(); setLogo(d?.dataUrl ?? null); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      setToast("Image too large (max 1.5MB)"); setTimeout(() => setToast(""), 3000); return;
    }
    setLogoBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const res = await authFetch(`/api/clients/${id}/logo`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }),
      });
      if (res.ok) { setLogo(dataUrl); setToast("Logo uploaded"); }
      else { const er = await res.json().catch(() => ({})); setToast(er.error || "Upload failed"); }
    } catch {
      setToast("Upload failed");
    }
    setTimeout(() => setToast(""), 3000);
    setLogoBusy(false);
  }

  async function handleLogoDelete() {
    setLogoBusy(true);
    const res = await authFetch(`/api/clients/${id}/logo`, { method: "DELETE" });
    if (res.ok) { setLogo(null); setToast("Logo removed"); }
    setTimeout(() => setToast(""), 3000);
    setLogoBusy(false);
  }

  // Load product mapping data when client is loaded and has PMF
  const hasPmf = !!client?.controlFiles?.pmf;
  useEffect(() => {
    if (hasPmf) {
      loadProductMapping();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPmf]);

  // Load links mapping data when client is loaded and has LINKS
  const hasLinks = !!client?.controlFiles?.links;
  useEffect(() => {
    if (hasLinks) {
      loadLinksMapping();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLinks]);

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
      // Optimistically update client state so UI reflects the upload immediately
      // (avoids stale blob CDN reads from load())
      setClient((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          controlFiles: {
            ...prev.controlFiles,
            [type]: {
              fileName: file.name,
              uploadedAt: new Date().toISOString(),
              uploadedBy: "You",
              rowCount: json.rowCount ?? 0,
            },
          },
        };
      });
      // Background refresh for accurate data (may still be stale briefly)
      load();
      if (type === "pmf") {
        await loadProductMapping();
        if (json.productMasterCount != null) {
          setProductCount(json.productMasterCount);
        }
      }
      if (type === "links") {
        await loadLinksMapping();
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
    if (!mapping.clientProductId) {
      setToast("Client Product ID mapping is required");
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

  // ── Links Mapping ──

  async function loadLinksMapping() {
    setLinksMappingLoading(true);
    try {
      const res = await authFetch(`/api/clients/${id}/links-mapping`);
      if (res.ok) {
        const data = await res.json();
        setLinksHeaders(data.headers ?? []);
        setLinksAutoMatched(data.autoMatched ?? {});
        setLinksMapping(data.mapping ?? data.autoMatched ?? {});
        if (data.linkCount != null) setLinkCount(data.linkCount);
      } else {
        console.error("links-mapping GET failed:", res.status);
      }
    } catch (err) {
      console.error("loadLinksMapping error:", err);
    }
    setLinksMappingLoading(false);
  }

  async function saveLinksMapping() {
    if (!linksMapping.article || !linksMapping.clientProductId) {
      setToast("Both Article and Client Product ID are required");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setLinksMappingSaving(true);
    const res = await authFetch(`/api/clients/${id}/links-mapping`, {
      method: "PUT",
      body: JSON.stringify({ mapping: linksMapping }),
    });
    if (res.ok) {
      const data = await res.json();
      setLinkCount(data.linkCount ?? 0);
      setToast(`Links mapping saved — ${data.linkCount} article links`);
      setTimeout(() => setToast(""), 4000);
    } else {
      setToast("Failed to save links mapping");
      setTimeout(() => setToast(""), 3000);
    }
    setLinksMappingSaving(false);
  }

  // Load report config + categories from product master
  useEffect(() => {
    if (!id || !isAdmin) return;
    (async () => {
      const [cfgRes, pmRes] = await Promise.all([
        authFetch(`/api/reports/config?clientId=${id}`),
        authFetch(`/api/clients/${id}/product-master`),
      ]);
      if (cfgRes.ok) {
        const cfg: ReportConfig = await cfgRes.json();
        setRcOos(cfg.dscBrackets.oosThreshold);
        setRcAlert(cfg.dscBrackets.alertThreshold);
        setRcOtoMultipliers(cfg.otoMultipliers ?? {});
        setRcSpUrl(cfg.spUrls?.vital_signs ?? "");
      }
      if (pmRes.ok) {
        const pmData = await pmRes.json();
        const products: { category?: string }[] = pmData.products ?? [];
        const cats = [...new Set(
          products.map((p) => p.category?.trim()).filter((c): c is string => !!c)
        )].sort();
        setRcCategories(cats);
      }
    })();
  }, [id, isAdmin]);

  async function saveReportConfig() {
    setRcSaving(true);
    const config: ReportConfig = {
      dscBrackets: { oosThreshold: rcOos, alertThreshold: rcAlert },
      otoMultipliers: rcOtoMultipliers,
      spUrls: { vital_signs: rcSpUrl },
    };
    const res = await authFetch("/api/reports/config", {
      method: "PUT",
      body: JSON.stringify({ clientId: id, config }),
    });
    if (res.ok) {
      setToast("Report settings saved");
    } else {
      setToast("Failed to save report settings");
    }
    setTimeout(() => setToast(""), 3000);
    setRcSaving(false);
  }

  async function handleControlFileDelete(type: ControlFileType) {
    if (!confirm(`Delete ${CF_LABELS[type]}?`)) return;
    const res = await authFetch(`/api/clients/${id}/control-files/${type}`, { method: "DELETE" });
    if (res.ok) {
      setToast(`${CF_LABELS[type]} removed`);
      setTimeout(() => setToast(""), 3000);
      // Optimistically clear from state
      setClient((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          controlFiles: { ...prev.controlFiles, [type]: null },
        };
      });
      if (type === "pmf") {
        setPmfHeaders([]);
        setAutoMatched({});
        setMapping({});
        setProductCount(null);
      }
      if (type === "links") {
        setLinksHeaders([]);
        setLinksAutoMatched({});
        setLinksMapping({});
        setLinkCount(null);
      }
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
        {(["details", "control", "uploads", "logo"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
            {t === "details" ? "Details" : t === "control" ? "Control Files" : t === "uploads" ? "Uploads" : "Logo"}
          </button>
        ))}
      </div>

      {tab === "logo" && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
          <h3 className="mb-1 text-lg font-semibold text-[var(--color-text)]">Client Logo</h3>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            Shown on the Month-End report cover (Menu) sheet. PNG / JPG / GIF, max ~1.5MB.
          </p>
          {logo ? (
            <div className="mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="Client logo" className="max-h-32 rounded border border-[var(--color-border)] bg-white p-2" />
            </div>
          ) : (
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">No logo uploaded.</p>
          )}
          {isAdmin && (
            <div className="flex items-center gap-3">
              <label className="cursor-pointer rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">
                {logoBusy ? "Uploading…" : logo ? "Replace Logo" : "Upload Logo"}
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
                  onChange={handleLogoUpload} disabled={logoBusy} />
              </label>
              {logo && (
                <button onClick={handleLogoDelete} disabled={logoBusy}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-zinc-50">
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
              <div className="mt-1 flex flex-wrap gap-1">{(() => {
                const clientMains = mainChannels.filter(
                  (main) =>
                    client.channelIds.includes(main.id) ||
                    subChannels.some(
                      (sub) => sub.parentId === main.id && client.channelIds.includes(sub.id)
                    )
                );
                if (clientMains.length === 0) return <span className="text-xs text-[var(--color-text-muted)]">None assigned</span>;
                return clientMains.map((ch) => (
                  <span key={ch.id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{ch.name}</span>
                ));
              })()}</div>
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
                  const mainSelected = editForm.channelIds.includes(main.id);
                  return (
                    <div key={main.id} className="rounded-lg border border-[var(--color-border)] p-3">
                      <button type="button" onClick={() => toggleEditChannel(main.id)}
                        className={`mb-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${mainSelected ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border)] text-[var(--color-text)] hover:border-zinc-400"}`}>
                        {main.name}
                      </button>
                      {children.length > 0 && (
                        <div className="flex flex-wrap gap-2 pl-2 border-l-2 border-[var(--color-border)]">
                          {children.map((ch) => (
                            <button key={ch.id} type="button" onClick={() => toggleEditChannel(ch.id)}
                              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${editForm.channelIds.includes(ch.id) ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-zinc-400"}`}>
                              {ch.name}
                            </button>
                          ))}
                        </div>
                      )}
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
              <React.Fragment key={type}>
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
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

                {/* Product Mapping — renders right after the PMF card */}
                {type === "pmf" && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">Product Mapping</h3>
                        {!client.controlFiles.pmf ? (
                          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">Upload PMF first</span>
                        ) : productCount != null && productCount > 0 ? (
                          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{productCount} products</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">Not mapped</span>
                        )}
                      </div>
                    </div>

                    {!client.controlFiles.pmf ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Upload a PMF file above to enable product field mapping.</p>
                    ) : mappingLoading ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Loading mapping...</p>
                    ) : pmfHeaders.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">No headers detected. Remove and re-upload the PMF file.</p>
                    ) : (
                      <>
                        <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                          Map PMF columns to standard product fields. Client Product ID is required. {autoMatched.clientProductId && "(Auto-matched suggestions applied)"}
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          {([
                            { field: "clientProductId" as const, label: "Client Product ID *", required: true },
                            { field: "brand" as const, label: "Brand", required: false },
                            { field: "category" as const, label: "Category", required: false },
                            { field: "subCategory" as const, label: "Sub Category", required: false },
                            { field: "status" as const, label: "Status", required: false },
                            { field: "description" as const, label: "Description", required: false },
                            { field: "barcode" as const, label: "Barcode / EAN", required: false },
                          ]).map(({ field, label, required }) => (
                            <div key={field}>
                              <label htmlFor={`mapping-${field}`} className="mb-1 block text-xs font-medium text-[var(--color-text)]">{label}</label>
                              <select
                                id={`mapping-${field}`}
                                name={`mapping-${field}`}
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
                            disabled={mappingSaving || !mapping.clientProductId}
                            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
                          >
                            {mappingSaving ? "Saving..." : "Save & Build"}
                          </button>
                          {autoMatched.clientProductId && (
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

                {/* Links Mapping — renders right after the LINKS card */}
                {type === "links" && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">Links Mapping</h3>
                        {!client.controlFiles.links ? (
                          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">Upload Links first</span>
                        ) : linkCount != null && linkCount > 0 ? (
                          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{linkCount} article links</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">Not mapped</span>
                        )}
                      </div>
                    </div>

                    {!client.controlFiles.links ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Upload a Links file above to enable article mapping.</p>
                    ) : linksMappingLoading ? (
                      <p className="text-sm text-[var(--color-text-muted)]">Loading mapping...</p>
                    ) : linksHeaders.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">No headers detected. Remove and re-upload the Links file.</p>
                    ) : (
                      <>
                        <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                          Map which Links columns contain the Article (channel-specific) and Client Product ID (global, links to PMF). Both are required. {linksAutoMatched.article && linksAutoMatched.clientProductId && "(Auto-matched suggestions applied)"}
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          {([
                            { field: "article" as const, label: "Article *" },
                            { field: "clientProductId" as const, label: "Client Product ID *" },
                          ]).map(({ field, label }) => (
                            <div key={field}>
                              <label htmlFor={`links-mapping-${field}`} className="mb-1 block text-xs font-medium text-[var(--color-text)]">{label}</label>
                              <select
                                id={`links-mapping-${field}`}
                                name={`links-mapping-${field}`}
                                value={linksMapping[field] ?? ""}
                                onChange={(e) => setLinksMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))}
                                className={`w-full rounded-lg border px-3 py-2 text-sm ${!linksMapping[field] ? "border-amber-300" : "border-[var(--color-border)]"}`}
                              >
                                <option value="">— Not mapped —</option>
                                {linksHeaders.map((h) => (
                                  <option key={h} value={h}>{h}</option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                          <button
                            onClick={saveLinksMapping}
                            disabled={linksMappingSaving || !linksMapping.article || !linksMapping.clientProductId}
                            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
                          >
                            {linksMappingSaving ? "Saving..." : "Save Mapping"}
                          </button>
                          {linksAutoMatched.article && linksAutoMatched.clientProductId && (
                            <button
                              onClick={() => setLinksMapping({ ...linksAutoMatched })}
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
              </React.Fragment>
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

      {/* Report Settings — admin only */}
      {isAdmin && (
        <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">Report Settings</h3>
          <div className="mb-5">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">DSC Brackets</span>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">OOS Threshold (below = &quot;Out of Stock&quot;)</label>
                <input type="number" value={rcOos} onChange={(e) => setRcOos(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Alert Threshold (at/above = &quot;ALERT&quot;)</label>
                <input type="number" value={rcAlert} onChange={(e) => setRcAlert(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
          <div className="mb-5">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">OTO Multipliers (per Category)</span>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              OTO Value = multiplier &times; RP. Default is 1 if not set.
            </p>
            {rcCategories.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">No categories found — upload and map a PMF file first.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {rcCategories.map((cat) => {
                  const key = cat.toLowerCase();
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <label className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]" title={cat}>{cat}</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={rcOtoMultipliers[key] ?? ""}
                        placeholder="1"
                        onChange={(e) => {
                          const val = e.target.value;
                          setRcOtoMultipliers((prev) => {
                            const next = { ...prev };
                            if (val === "" || val === "0") {
                              delete next[key];
                            } else {
                              next[key] = Number(val);
                            }
                            return next;
                          });
                        }}
                        className="w-20 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-right text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="mb-5">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">SharePoint URLs</span>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">Vital Signs SP Folder URL</label>
              <input type="text" value={rcSpUrl} onChange={(e) => setRcSpUrl(e.target.value)} placeholder="https://..."
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={saveReportConfig} disabled={rcSaving}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
            {rcSaving ? "Saving..." : "Save Report Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
