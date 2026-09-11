"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/useAuth";

/* Point a client at its Dropbox folder and its four control files, once.

   Every attempt to find this by name has failed, because a client is called
   three different things: the iRam record ("CLIPPA SALES (Pty) Ltd"), the SQL
   name ("CLIPPA SALES"), and whatever the Dropbox folder happens to be. The
   fix is not a cleverer match — a looser rule is how one client's edit gets
   written into another client's master file. It is to state it.

   So: browse to the folder, pick each file from what is actually in it. More
   admin, once per client, and afterwards there is nothing left to guess. */

interface Entry { name: string; path: string; size?: number; modified?: string }
interface Browse { path: string; root?: string; folders: Entry[]; files: Entry[]; error?: string }

const KINDS: { kind: string; label: string; feeds: string }[] = [
  { kind: "pmf", label: "Product Management (PMF)", feeds: "Product master — brands, categories, descriptions" },
  { kind: "links", label: "Product Links", feeds: "Article → Product ID. Gates every DISPO upload" },
  { kind: "ranging", label: "Range Management", feeds: "Ranging — drives Numerical Distribution" },
  { kind: "custom_sites", label: "Custom Store List", feeds: "Custom site list" },
];

function fmtSize(b?: number): string {
  if (!b) return "";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return Math.round(b / 1e3) + " KB";
  return b + " B";
}

export default function DropboxSetup({
  clientId,
  clientName,
  initialFolder,
  initialFiles,
  onSaved,
}: {
  clientId: string;
  clientName: string;
  initialFolder?: string;
  initialFiles?: Record<string, string>;
  onSaved: () => void;
}) {
  const [path, setPath] = useState(initialFolder || "");
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>(initialFiles || {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const open = useCallback(async (p: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await authFetch(`/api/dropbox/browse?path=${encodeURIComponent(p)}`);
      const d: Browse = await res.json();
      setBrowse(d);
      if (d.path) setPath(d.path);
      if (!res.ok && d.error) setMsg({ text: d.error, ok: false });
    } catch {
      setMsg({ text: "Network error reading Dropbox.", ok: false });
    }
    setLoading(false);
  }, []);

  // Open the saved folder if there is one, otherwise the control root.
  useEffect(() => { open(initialFolder || ""); }, [open, initialFolder]);

  function up() {
    const parent = path.replace(/\/[^/]+$/, "");
    open(parent || "/");
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await authFetch(`/api/clients/${clientId}`, {
        method: "PUT",
        body: JSON.stringify({ dropboxFolder: path, dropboxFiles: picked }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ text: "Saved. This client now points at that folder.", ok: true });
        onSaved();
      } else {
        setMsg({ text: d.error || `Could not save (${res.status})`, ok: false });
      }
    } catch {
      setMsg({ text: "Network error saving.", ok: false });
    }
    setSaving(false);
  }

  const atRoot = !!browse?.root && browse.path === browse.root;
  const chosen = KINDS.filter((k) => picked[k.kind]).length;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-[var(--color-text)]">Dropbox folder for {clientName}</h4>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Browse to this client&apos;s folder and pick each control file from what is actually in it.
          Set once — after that nothing is matched on a name, so a renamed folder or an oddly named
          file cannot quietly point at the wrong client.
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg border px-4 py-2 text-sm ${msg.ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Where we are ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          Folder path — or paste the address from the Dropbox website
        </label>
        <div className="flex flex-wrap gap-2">
          <input value={path} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); open(path); } }}
            placeholder="/OuterJoin/…/Support Tables/CLIENT FOLDER"
            className="min-w-[280px] flex-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs" />
          <button type="button" onClick={() => open(path)} disabled={loading}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50">
            {loading ? "Opening…" : "Open"}
          </button>
          <button type="button" onClick={up} disabled={loading || atRoot}
            title={atRoot ? "Already at the control root" : "Up one folder"}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40">
            ↑ Up
          </button>
        </div>
      </div>

      {/* ── Sub-folders, to click into ── */}
      {browse && browse.folders.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">
            Folders here ({browse.folders.length})
          </div>
          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white p-3">
            {browse.folders.map((f) => (
              <button key={f.path} type="button" onClick={() => open(f.path)}
                className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                {f.name}/
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── The four control files ── */}
      <div>
        <div className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">
          Spreadsheets in this folder ({browse?.files.length ?? 0}) — pick one per control file
        </div>
        {browse && browse.files.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No .xlsx files in this folder. Open the folder that actually holds this client&apos;s
            control files.
          </p>
        ) : (
          <div className="space-y-2">
            {KINDS.map((k) => (
              <div key={k.kind} className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text)]">{k.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{k.feeds}</div>
                  </div>
                  <select value={picked[k.kind] || ""}
                    onChange={(e) => setPicked((p) => {
                      const next = { ...p };
                      if (e.target.value) next[k.kind] = e.target.value; else delete next[k.kind];
                      return next;
                    })}
                    className="max-w-[340px] rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs">
                    {/* "Not in Dropbox" is a real answer — not every client has
                        all four, and a blank must not read as "unset by mistake". */}
                    <option value="">— not in Dropbox —</option>
                    {/* A name saved earlier that is no longer in the folder must
                        still show, or the select would silently display the
                        FIRST option and look like a different choice. */}
                    {picked[k.kind] && !browse?.files.some((f) => f.name === picked[k.kind]) && (
                      <option value={picked[k.kind]}>{picked[k.kind]} — no longer in this folder</option>
                    )}
                    {(browse?.files ?? []).map((f) => (
                      <option key={f.path} value={f.name}>
                        {f.name}{f.size ? ` · ${fmtSize(f.size)}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !path}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
          {saving ? "Saving…" : "Save Dropbox setup"}
        </button>
        <span className="text-xs text-[var(--color-text-muted)]">
          {chosen} of {KINDS.length} control files picked
        </span>
      </div>
    </div>
  );
}
