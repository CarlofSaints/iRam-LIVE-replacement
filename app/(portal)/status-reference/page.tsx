"use client";

import { useEffect, useState, FormEvent } from "react";
import { authFetch, useAuth } from "@/lib/useAuth";
import type { StatusDefinition, StatusClassification, Channel } from "@/lib/types";

const CLASSIFICATIONS: StatusClassification[] = ["POSITIVE", "NEGATIVE", "UNCLASSIFIED"];

function ClassBadge({ c }: { c: StatusClassification }) {
  const styles: Record<StatusClassification, string> = {
    POSITIVE: "bg-green-50 text-green-700 border border-green-200",
    NEGATIVE: "bg-red-50 text-red-700 border border-red-200",
    UNCLASSIFIED: "bg-amber-50 text-amber-700 border border-amber-200",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[c]}`}>
      {c}
    </span>
  );
}

export default function StatusReferencePage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [filter, setFilter] = useState<StatusClassification | "ALL">("ALL");
  const [search, setSearch] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ code: "", classification: "UNCLASSIFIED" as StatusClassification, description: "", notes: "" });
  const [addError, setAddError] = useState("");

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ classification: "UNCLASSIFIED" as StatusClassification, description: "", notes: "" });

  // Load channels on mount
  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/channels");
      if (res.ok) {
        const all: Channel[] = await res.json();
        const main = all.filter((c) => !c.parentId);
        setChannels(main);
        if (main.length > 0) setSelectedChannel(main[0].id);
      }
      setLoading(false);
    })();
  }, []);

  // Load statuses when channel changes
  useEffect(() => {
    if (!selectedChannel) return;
    (async () => {
      const res = await authFetch(`/api/status-definitions?channelId=${selectedChannel}`);
      if (res.ok) setStatuses(await res.json());
    })();
  }, [selectedChannel]);

  async function reload() {
    if (!selectedChannel) return;
    const res = await authFetch(`/api/status-definitions?channelId=${selectedChannel}`);
    if (res.ok) setStatuses(await res.json());
  }

  // Filter + search
  const filtered = statuses.filter((s) => {
    if (filter !== "ALL" && s.classification !== filter) return false;
    if (search && !s.code.toLowerCase().includes(search.toLowerCase()) && !s.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const unclassifiedCount = statuses.filter((s) => s.classification === "UNCLASSIFIED").length;

  // Add handler
  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.code.trim()) { setAddError("Status code is required"); return; }
    const res = await authFetch("/api/status-definitions", {
      method: "POST",
      body: JSON.stringify({ ...addForm, channelId: selectedChannel }),
    });
    if (!res.ok) { setAddError((await res.json()).error || "Failed to add"); return; }
    setShowAdd(false);
    setAddForm({ code: "", classification: "UNCLASSIFIED", description: "", notes: "" });
    reload();
  }

  // Edit handler
  async function handleEdit(id: string) {
    const res = await authFetch(`/api/status-definitions/${id}`, {
      method: "PUT",
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      setEditId(null);
      reload();
    }
  }

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm("Delete this status definition?")) return;
    await authFetch(`/api/status-definitions/${id}`, { method: "DELETE" });
    reload();
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>;
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Status Reference</h1>
          {unclassifiedCount > 0 && (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {unclassifiedCount} unclassified
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowAdd(!showAdd); setAddError(""); }}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
          >
            {showAdd ? "Cancel" : "+ Add Status"}
          </button>
        )}
      </div>

      {/* Channel tabs */}
      {channels.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSelectedChannel(ch.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                selectedChannel === ch.id
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:bg-zinc-50"
              }`}
            >
              {ch.name}
            </button>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd && isAdmin && (
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6">
          <form onSubmit={handleAdd} className="space-y-3">
            {addError && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{addError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Status Code (e.g. Z9)"
                value={addForm.code}
                onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
                required
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
              <select
                value={addForm.classification}
                onChange={(e) => setAddForm({ ...addForm, classification: e.target.value as StatusClassification })}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <input
              placeholder="Description"
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            <input
              placeholder="Notes (optional)"
              value={addForm.notes}
              onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
            >
              Create
            </button>
          </form>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Search statuses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm w-60"
        />
        <div className="flex gap-1.5">
          {(["ALL", ...CLASSIFICATIONS] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === c
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:bg-zinc-50"
              }`}
            >
              {c === "ALL" ? "All" : c.charAt(0) + c.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Unclassified banner */}
      {unclassifiedCount > 0 && selectedChannel && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>{unclassifiedCount}</strong> unclassified status{unclassifiedCount !== 1 ? "es" : ""} need attention in this channel.
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white">
        {!selectedChannel ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">Select a channel to view statuses.</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {statuses.length === 0 ? "No status definitions yet." : "No statuses match your filter."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                <th className="px-6 py-3">Status Code</th>
                <th className="px-6 py-3">Classification</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Notes</th>
                <th className="px-6 py-3">Source</th>
                {isAdmin && <th className="px-6 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0">
                  {editId === s.id ? (
                    <>
                      <td className="px-6 py-3 font-mono font-medium text-[var(--color-text)]">{s.code}</td>
                      <td className="px-6 py-3">
                        <select
                          value={editForm.classification}
                          onChange={(e) => setEditForm({ ...editForm, classification: e.target.value as StatusClassification })}
                          className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm"
                        >
                          {CLASSIFICATIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editForm.description}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm"
                          placeholder="Description"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm"
                          placeholder="Notes"
                        />
                      </td>
                      <td className="px-6 py-3">
                        {s.autoDetected && (
                          <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
                            auto-detected
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => handleEdit(s.id)} className="text-xs font-medium text-[var(--color-primary)] hover:underline">Save</button>
                          <button onClick={() => setEditId(null)} className="text-xs text-[var(--color-text-muted)] hover:underline">Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-mono font-medium text-[var(--color-text)]">{s.code}</td>
                      <td className="px-6 py-3"><ClassBadge c={s.classification} /></td>
                      <td className="px-6 py-3 text-[var(--color-text-muted)]">{s.description}</td>
                      <td className="px-6 py-3 text-[var(--color-text-muted)]">{s.notes || "—"}</td>
                      <td className="px-6 py-3">
                        {s.autoDetected && (
                          <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
                            auto-detected
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditId(s.id);
                                setEditForm({ classification: s.classification, description: s.description, notes: s.notes || "" });
                              }}
                              className="text-xs text-[var(--color-primary)] hover:underline"
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDelete(s.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                          </div>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
