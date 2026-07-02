"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { authFetch, useAuth, usePermissions } from "@/lib/useAuth";
import SearchSelect from "@/components/SearchSelect";

// Loose code compare (mirrors the server) + light name-similarity ranking
// (Bravo-style: normalise, then shared-token + substring score).
const looseCode = (s: string) => String(s ?? "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
const normName = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
function nameScore(query: string, candName: string): number {
  const q = normName(query), n = normName(candName);
  if (!q || !n) return 0;
  const nSet = new Set(n.split(" ").filter(Boolean));
  let s = q.split(" ").filter(Boolean).filter((t) => nSet.has(t)).length;
  if (n.includes(q) || q.includes(n)) s += 2;
  return s;
}

interface ClientOpt { id: string; name: string; flagged: boolean }
interface StoreOpt { siteCode: string; siteName: string; subChannel: string }
interface SendResult {
  to: string;
  store: string;
  clients: string[];
  counts: Record<string, number>;
  totalActions: number;
  totalProducts: number;
  reportUrl: string;
}

// Human labels for run-outcome statuses (mirrors OUTCOME_LABELS in storeReportRunner).
const STATUS_LABELS: Record<string, string> = {
  "sent": "Sent",
  "would-send": "Would send",
  "skipped-duplicate": "Already sent today",
  "skipped-no-data": "No actions to report",
  "skipped-no-mapping": "Site not in loaded data / unmapped",
  "skipped-no-sitecode": "Visit had no site code",
  "skipped-no-email": "Rep has no email",
  "skipped-channel": "Channel not in allow-list",
  "failed": "Failed",
};

const CARD_LABELS: [string, string][] = [
  ["oos", "Out of Stock"],
  ["lowCover", "Low Stock Cover"],
  ["phantom", "Phantom"],
  ["status", "Status"],
  ["marginRisk", "Margin Risk"],
  ["marginOpp", "Margin Opportunity"],
];

interface SyncSettings { enabled: boolean; channels: string[]; minIntervalSeconds: number; lastRun?: { at: string; ok: boolean; visitsSeen: number; sent: number; skipped: number; failed: number; reasons?: Record<string, number>; message?: string } }
interface RunOutcome { siteCode: string; repEmail: string; store: string; status: string; actions?: number; detail?: string }
interface RunResult { ok: boolean; armedPeriod: string | null; visitsSeen: number; sent: number; skipped: number; failed: number; dryRun: boolean; outcomes: RunOutcome[]; message?: string }
interface EngSummary { channel: string; sent: number; opened: number; used: number }
interface EngDetail { store: string; siteCode: string; channel: string; repName: string; repEmail: string; sentAt: string; opened: boolean; used: boolean; cardClicks: number; distinctCards: string[]; test: boolean }
interface EngResult { day: string; summary: EngSummary[]; totalSent: number; detail: EngDetail[] }
interface CodeRow { code: string; name?: string; status: "match" | "linked" | "format-diff" | "no-match"; dispoCode?: string; dispoName?: string; reason?: string }
interface CodeMapping { perigeeCode: string; dispoCode: string }
interface DispoOnly { code: string; name?: string }
interface DispoClaim { by: string; via: "match" | "format-diff" | "linked" }
interface DispoCandidate { code: string; name?: string; claim?: DispoClaim | null }
interface CodeCheck { checked: number; matched: number; linked: number; formatDiff: number; noMatch: number; dispoCodeCount: number; dispoOnlyCount: number; results: CodeRow[]; dispoOnly: DispoOnly[]; dispoAll?: DispoCandidate[]; mappings: CodeMapping[] }
type CodeFilter = "all" | "match" | "linked" | "format-diff" | "no-match";

export default function StoreReportsTestPage() {
  const { can } = usePermissions();
  const { user } = useAuth();
  const canManage = can("manage_store_reports");
  const isSuperAdmin = user?.role === "super_admin";

  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [siteCode, setSiteCode] = useState<string>("");
  const [loadingStores, setLoadingStores] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);

  // Load clients + stores (scoped to the selected client).
  async function loadStores(forClient: string) {
    setLoadingStores(true);
    setError("");
    try {
      const qs = forClient ? `?clientId=${encodeURIComponent(forClient)}` : "";
      const res = await authFetch(`/api/store-reports/stores${qs}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setClients(d.clients || []);
        setStores(d.stores || []);
        if (d.stores?.length && !d.stores.some((s: StoreOpt) => s.siteCode === siteCode)) {
          setSiteCode(d.stores[0].siteCode);
        }
      } else {
        setError(d.error || "Failed to load stores");
      }
    } catch {
      setError("Network error");
    }
    setLoadingStores(false);
  }

  useEffect(() => { loadStores(""); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (clients.length) loadStores(clientId); /* eslint-disable-next-line */ }, [clientId]);

  const previewUrl = useMemo(() => {
    if (!siteCode) return "";
    const p = new URLSearchParams({ site: siteCode });
    if (clientId) p.set("clientId", clientId);
    return `/r?${p.toString()}`;
  }, [siteCode, clientId]);

  async function sendTest() {
    if (!siteCode) return;
    setSending(true);
    setError("");
    setResult(null);
    try {
      const res = await authFetch("/api/store-reports/test", {
        method: "POST",
        body: JSON.stringify({ siteCode, clientId: clientId || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setResult(d as SendResult);
      else setError(d.error || "Send failed");
    } catch {
      setError("Network error");
    }
    setSending(false);
  }

  // ── Sync settings (super-admin) ──
  const [sync, setSync] = useState<SyncSettings | null>(null);
  const [channelsText, setChannelsText] = useState("");
  const [proxyOk, setProxyOk] = useState<boolean | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function loadSync() {
    try {
      const res = await authFetch("/api/store-reports/sync");
      if (res.ok) {
        const d = await res.json();
        setSync(d.settings);
        setChannelsText((d.settings.channels || []).join("\n"));
        setProxyOk(!!d.proxyConfigured);
      }
    } catch { /* ignore */ }
  }
  useEffect(() => { if (isSuperAdmin) loadSync(); /* eslint-disable-next-line */ }, [isSuperAdmin]);

  async function saveSync(next: Partial<SyncSettings>) {
    setSyncBusy(true); setSyncMsg(""); setRunResult(null);
    try {
      const res = await authFetch("/api/store-reports/sync", {
        method: "POST",
        body: JSON.stringify({
          action: "save",
          enabled: next.enabled ?? sync?.enabled,
          channels: channelsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          minIntervalSeconds: next.minIntervalSeconds ?? sync?.minIntervalSeconds ?? 0,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setSync(d.settings); setSyncMsg("Saved"); setTimeout(() => setSyncMsg(""), 2500); }
      else setSyncMsg(d.error || "Save failed");
    } catch { setSyncMsg("Network error"); }
    setSyncBusy(false);
  }

  async function runSync(dry: boolean) {
    setSyncBusy(true); setSyncMsg(""); setRunResult(null);
    try {
      const res = await authFetch("/api/store-reports/sync", {
        method: "POST",
        body: JSON.stringify({ action: dry ? "dryrun" : "run" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setRunResult(d as RunResult); loadSync(); }
      else setSyncMsg(d.error || "Run failed");
    } catch { setSyncMsg("Network error"); }
    setSyncBusy(false);
  }

  // ── Engagement / detail log ──
  const todayStr = new Date().toLocaleDateString("en-CA");
  const [engDay, setEngDay] = useState(todayStr);
  const [eng, setEng] = useState<EngResult | null>(null);
  const [engBusy, setEngBusy] = useState(false);
  const [engMsg, setEngMsg] = useState("");

  async function loadEng(day: string) {
    setEngBusy(true); setEngMsg("");
    const empty: EngResult = { day, summary: [], totalSent: 0, detail: [] };
    try {
      const res = await authFetch(`/api/store-reports/engagement?day=${encodeURIComponent(day)}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) setEng(d);
      else { setEng(empty); setEngMsg(d.error || `Couldn't load engagement (${res.status})`); }
    } catch {
      setEng(empty);
      setEngMsg("Network error loading engagement");
    }
    setEngBusy(false);
  }
  useEffect(() => { if (canManage) loadEng(engDay); /* eslint-disable-next-line */ }, [engDay, canManage]);

  async function sendDigest(send: boolean) {
    setEngBusy(true); setEngMsg("");
    try {
      const res = await authFetch("/api/store-reports/engagement", {
        method: "POST", body: JSON.stringify({ day: engDay, send }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setEngMsg(send ? `Digest sent to ${d.recipients?.length ?? 0} manager(s)` : `Preview: ${d.totalSent} sent, ${d.recipients?.length ?? 0} manager recipient(s)`);
      else setEngMsg(d.error || "Failed");
    } catch { setEngMsg("Network error"); }
    setEngBusy(false);
    setTimeout(() => setEngMsg(""), 4000);
  }

  // ── Site code check ──
  const [codeText, setCodeText] = useState("");
  const [codeRes, setCodeRes] = useState<CodeCheck | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState("");
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all");
  const [linkFor, setLinkFor] = useState<string | null>(null);   // perigee code being linked
  const [linkSearch, setLinkSearch] = useState("");              // candidate search text
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set()); // looseCode keys ticked for bulk remove
  const [codeSyncMsg, setCodeSyncMsg] = useState("");            // "list updated by …" notice from the live poll
  // The shared list text we last agreed with the server. The poll compares the
  // server's text against this to detect ANOTHER admin's change (vs our own
  // saves). codeTextRef holds the latest editor value for the poll's closure.
  const syncedTextRef = useRef("");
  const codeTextRef = useRef("");
  codeTextRef.current = codeText;
  const checkCodesRef = useRef<((text?: string, persist?: boolean) => Promise<void>) | null>(null);

  // The pasted list is stored SERVER-SIDE so every admin works off the same list
  // (localStorage is only a fast local fallback). Load the shared list on mount,
  // fall back to localStorage if the server has nothing yet, then auto-check.
  const CODE_LS = "storeReportCodeText";
  useEffect(() => {
    (async () => {
      let text = "";
      try {
        const res = await authFetch("/api/store-reports/code-input");
        if (res.ok) { const d = await res.json().catch(() => ({})); text = String(d?.text ?? ""); }
      } catch { /* ignore */ }
      if (!text.trim()) { try { text = localStorage.getItem(CODE_LS) || ""; } catch { /* ignore */ } }
      syncedTextRef.current = text;  // baseline for the live poll
      if (text.trim()) { setCodeText(text); checkCodes(text, false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live poll — pick up another admin's changes to the shared list while we work.
  // Only ADOPT a server change when we have no unsaved local edits (codeText ===
  // syncedTextRef); otherwise just flag it so we never clobber the editor.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await authFetch("/api/store-reports/code-input");
        if (!res.ok) return;
        const d = await res.json().catch(() => ({}));
        const serverText = String(d?.text ?? "");
        if (serverText === syncedTextRef.current) return;            // unchanged / our own save
        if (codeTextRef.current !== syncedTextRef.current) {         // we have unsaved local edits
          setCodeSyncMsg((prev) => prev.startsWith("Another admin") ? prev : "Another admin updated the list — your local edits aren't synced yet.");
          return;
        }
        syncedTextRef.current = serverText;
        setCodeText(serverText);
        if (serverText.trim()) checkCodesRef.current?.(serverText, false); else setCodeRes(null);
        setCodeSyncMsg(d?.updatedBy ? `List updated by ${d.updatedBy}` : "List updated by another admin");
        setTimeout(() => setCodeSyncMsg(""), 5000);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the shared list to the server so other admins see the same thing.
  async function saveCodeInput(text: string) {
    syncedTextRef.current = text;  // our own save — don't let the poll treat it as external
    try { await authFetch("/api/store-reports/code-input", { method: "POST", body: JSON.stringify({ text }) }); }
    catch { /* ignore — localStorage still holds a local copy */ }
  }

  // Parse each line into { code, name } — Excel two-column paste is tab-separated;
  // also accept comma/semicolon. First column = code, the rest = store name.
  function parseEntries(text: string): { code: string; name: string }[] {
    return text.split(/\r?\n/).map((line) => {
      const m = line.match(/^([^\t,;]+)[\t,;]+(.*)$/);
      if (m) return { code: m[1].trim(), name: m[2].trim() };
      return { code: line.trim(), name: "" };
    }).filter((e) => e.code);
  }

  async function checkCodes(text: string = codeText, persist: boolean = true) {
    const entries = parseEntries(text);
    if (!entries.length) { setCodeErr("Paste some site codes first"); return; }
    try { localStorage.setItem(CODE_LS, text); } catch { /* ignore */ }
    if (persist) saveCodeInput(text);  // share with other admins (skip on mount load)
    setCodeBusy(true); setCodeErr(""); setCodeRes(null); setLinkFor(null); setCodeSyncMsg("");
    try {
      const res = await authFetch("/api/store-reports/code-check", {
        method: "POST", body: JSON.stringify({ entries }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setCodeRes(d as CodeCheck);
      else setCodeErr(d.error || "Check failed");
    } catch { setCodeErr("Network error"); }
    setCodeBusy(false);
  }
  checkCodesRef.current = checkCodes;  // keep the live poll calling the latest checkCodes

  // Export the full mapping (every status, not just the filtered view) to Excel
  // so duplicate Perigee stores can be spotted (sort by DISPO match → two Perigee
  // codes resolving to the same DISPO store are flagged "DUPLICATE").
  async function exportMapping() {
    if (!codeRes) return;
    const XLSX = await import("xlsx");
    const statusLabel: Record<CodeRow["status"], string> = {
      match: "Match", linked: "Linked", "format-diff": "Format diff", "no-match": "No match",
    };
    // Count how many Perigee rows resolve to each DISPO store (code or, failing
    // that, name) so we can flag duplicates.
    const dispoCounts = new Map<string, number>();
    for (const r of codeRes.results) {
      const key = looseCode(r.dispoCode || "") || normName(r.dispoName || "");
      if (key) dispoCounts.set(key, (dispoCounts.get(key) || 0) + 1);
    }
    const rows = codeRes.results.map((r) => {
      const key = looseCode(r.dispoCode || "") || normName(r.dispoName || "");
      return {
        "Perigee Code": r.code,
        "Perigee Name": r.name || "",
        "Status": statusLabel[r.status],
        "DISPO Code": r.dispoCode || "",
        "DISPO Name": r.dispoName || "",
        "Duplicate DISPO match": key && (dispoCounts.get(key) || 0) > 1 ? "DUPLICATE" : "",
        "Note": r.reason || "",
      };
    });
    const wb = XLSX.utils.book_new();
    const wsResults = XLSX.utils.json_to_sheet(rows);
    wsResults["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 14 }, { wch: 32 }, { wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsResults, "Mapping");
    if (codeRes.dispoOnly?.length) {
      const wsCand = XLSX.utils.json_to_sheet(codeRes.dispoOnly.map((c) => ({ "DISPO Code": c.code, "DISPO Name": c.name || "" })));
      wsCand["!cols"] = [{ wch: 14 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(wb, wsCand, "Unmatched DISPO stores");
    }
    XLSX.writeFile(wb, "site-code-mapping.xlsx");
  }

  async function saveLink(perigeeCode: string, dispoCode: string) {
    if (!dispoCode.trim()) return;
    setCodeBusy(true); setCodeErr("");
    try {
      const res = await authFetch("/api/store-reports/code-map", {
        method: "POST", body: JSON.stringify({ perigeeCode, dispoCode }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setCodeErr(d.error || "Link failed"); }
      else { setLinkFor(null); setLinkSearch(""); await checkCodes(); }
    } catch { setCodeErr("Network error"); }
    setCodeBusy(false);
  }

  // Reassign a DISPO store from one Perigee code to another: unlink the store's
  // current manual link, then link it to the code we're editing.
  async function reassignLink(oldPerigee: string, newPerigee: string, dispoCode: string) {
    if (!dispoCode.trim()) return;
    setCodeBusy(true); setCodeErr("");
    try {
      await authFetch("/api/store-reports/code-map", { method: "DELETE", body: JSON.stringify({ perigeeCode: oldPerigee }) });
      const res = await authFetch("/api/store-reports/code-map", { method: "POST", body: JSON.stringify({ perigeeCode: newPerigee, dispoCode }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setCodeErr(d.error || "Reassign failed"); }
      else { setLinkFor(null); setLinkSearch(""); await checkCodes(); }
    } catch { setCodeErr("Network error"); }
    setCodeBusy(false);
  }

  // Remove one or more Perigee stores from the pasted list entirely (e.g. DC /
  // online / closed that you don't need). Edits the textarea + re-checks.
  function removeFromList(codes: string | string[]) {
    const drop = new Set((Array.isArray(codes) ? codes : [codes]).map(looseCode));
    const text = codeText.split(/\r?\n/).filter((line) => {
      const m = line.match(/^([^\t,;]+)[\t,;]+/);
      const c = (m ? m[1] : line).trim();
      return c && !drop.has(looseCode(c));
    }).join("\n");
    setCodeText(text);
    setSelectedCodes(new Set());
    try { localStorage.setItem(CODE_LS, text); } catch { /* ignore */ }
    checkCodes(text);
  }

  // Toggle a single row's tickbox (keyed by loose code).
  function toggleSelect(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      const k = looseCode(code);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // Rows currently shown given the active card filter (drives select-all + map).
  const visibleRows = useMemo(
    () => (codeRes?.results || []).filter((r) => codeFilter === "all" || r.status === codeFilter),
    [codeRes, codeFilter]
  );
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedCodes.has(looseCode(r.code)));
  function toggleSelectAllVisible() {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleRows.forEach((r) => next.delete(looseCode(r.code)));
      else visibleRows.forEach((r) => next.add(looseCode(r.code)));
      return next;
    });
  }

  async function unlink(perigeeCode: string) {
    setCodeBusy(true); setCodeErr("");
    try {
      const res = await authFetch("/api/store-reports/code-map", {
        method: "DELETE", body: JSON.stringify({ perigeeCode }),
      });
      if (res.ok) await checkCodes();
    } catch { setCodeErr("Network error"); }
    setCodeBusy(false);
  }

  if (!canManage) {
    return <div className="p-8 text-sm text-[var(--color-text-muted)]">You don&apos;t have access to store reports.</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-[var(--color-text)]">Store Reports — Test</h1>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Pick a client and store, then preview the live action-list page or email the summary to yourself
        (uses the most recently loaded week). Sends to your own address only.
      </p>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Client</span>
            <SearchSelect
              value={clientId}
              onChange={setClientId}
              options={clients.map((c) => ({ value: c.id, label: `${c.name}${c.flagged ? "  ✓" : ""}` }))}
              allLabel="All flagged clients"
              searchLabel="clients"
              widthClass="w-full"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Store {loadingStores && <span className="font-normal normal-case">(loading…)</span>}
            </span>
            <SearchSelect
              value={siteCode}
              onChange={setSiteCode}
              disabled={loadingStores || stores.length === 0}
              options={stores.map((s) => ({
                value: s.siteCode,
                label: `${s.siteName ? `${s.siteName} — ${s.siteCode}` : s.siteCode}${s.subChannel ? ` (${s.subChannel})` : ""}`,
              }))}
              allLabel={stores.length === 0 ? "No stores with data" : "Select a store…"}
              searchLabel="stores"
              widthClass="w-full"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={previewUrl || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!siteCode}
            onClick={(e) => { if (!siteCode) e.preventDefault(); }}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              siteCode
                ? "border-[var(--color-border)] text-[var(--color-text)] hover:border-zinc-400"
                : "border-zinc-200 text-zinc-300 cursor-not-allowed"}`}>
            Preview report ↗
          </a>
          <button
            onClick={sendTest}
            disabled={!siteCode || sending}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
            {sending ? "Sending…" : "Send test to me"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-semibold text-green-800">
            ✓ Sent to {result.to} — {result.store}
          </p>
          <p className="mt-1 text-xs text-green-700">
            {result.totalActions} items to action · {result.totalProducts} products · clients: {result.clients.join(", ") || "—"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CARD_LABELS.map(([k, label]) => (
              <span key={k} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-text)] border border-green-200">
                {label}: <b>{result.counts?.[k] ?? 0}</b>
              </span>
            ))}
          </div>
          <a href={result.reportUrl} target="_blank" rel="noreferrer"
            className="mt-3 inline-block text-xs font-semibold text-[var(--color-primary)] underline">
            Open the hosted report ↗
          </a>
        </div>
      )}

      {/* ── Site code check ── */}
      <div className="mt-10">
        <h2 className="mb-1 text-lg font-bold text-[var(--color-text)]">Site Code Check</h2>
        <p className="mb-3 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Paste from your Perigee store list — <b>code and name</b> (copy both columns straight from Excel; one store
          per line). Each is matched against the DISPO codes, with the DISPO store name shown so you can confirm
          ambiguous ones by name before any live visits.
        </p>
        {codeErr && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{codeErr}</div>}
        {codeSyncMsg && <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">🔄 {codeSyncMsg}</div>}
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-5">
          <textarea
            value={codeText}
            onChange={(e) => { setCodeText(e.target.value); try { localStorage.setItem(CODE_LS, e.target.value); } catch { /* ignore */ } }}
            rows={5}
            placeholder={"S117\tGreenstone\nMW35\tWoodmead\n..."}
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-mono" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => checkCodes()} disabled={codeBusy}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
              {codeBusy ? "Checking…" : "Check codes"}
            </button>
            {codeRes && (
              <button onClick={exportMapping}
                className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400">
                ⬇ Export to Excel
              </button>
            )}
          </div>

          {codeRes && (
            <div className="mt-5">
              {/* Cards = filters */}
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                {([
                  ["all", `All ${codeRes.checked}`, "bg-zinc-50 text-[var(--color-text)] border-[var(--color-border)]"],
                  ["match", `✓ Match ${codeRes.matched}`, "bg-green-50 text-green-700 border-green-200"],
                  ["linked", `🔗 Linked ${codeRes.linked}`, "bg-blue-50 text-blue-700 border-blue-200"],
                  ["format-diff", `~ Format diff ${codeRes.formatDiff}`, "bg-amber-50 text-amber-700 border-amber-200"],
                  ["no-match", `✗ No match ${codeRes.noMatch}`, "bg-red-50 text-red-700 border-red-200"],
                ] as [CodeFilter, string, string][]).map(([key, label, cls]) => (
                  <button key={key} onClick={() => setCodeFilter(key)}
                    className={`rounded-md px-2.5 py-1 font-medium border ${cls} ${codeFilter === key ? "ring-2 ring-[var(--color-primary)] ring-offset-1" : ""}`}>
                    {label}
                  </button>
                ))}
                <span className="rounded-md bg-zinc-50 px-2.5 py-1 font-medium text-[var(--color-text-muted)] border border-[var(--color-border)]">{codeRes.dispoCodeCount} DISPO codes</span>
              </div>

              {selectedCodes.size > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-red-700">{selectedCodes.size} selected</span>
                  <button onClick={() => removeFromList(Array.from(selectedCodes))} disabled={codeBusy}
                    className="rounded-md bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    Remove selected
                  </button>
                  <button onClick={() => setSelectedCodes(new Set())} className="font-medium text-[var(--color-text-muted)] hover:underline">Clear selection</button>
                </div>
              )}

              <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible}
                          title="Select all shown" className="h-3.5 w-3.5 align-middle accent-[var(--color-primary)]" />
                      </th>
                      <th className="px-3 py-2 text-left">Perigee code</th>
                      <th className="px-3 py-2 text-left">Perigee name</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">DISPO code</th>
                      <th className="px-3 py-2 text-left">DISPO name</th>
                      <th className="px-3 py-2 text-left">Action / note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      // Search ALL callable DISPO stores (dispoAll) so a store
                      // already used by another code still shows up (annotated),
                      // falling back to the unmatched-only list for old payloads.
                      const candSource: DispoCandidate[] = codeRes.dispoAll?.length
                        ? codeRes.dispoAll
                        : (codeRes.dispoOnly || []).map((c) => ({ ...c, claim: null }));
                      const candidates = candSource
                        .filter((c) => { const q = linkSearch.trim().toLowerCase(); return !q || (c.code + " " + (c.name || "")).toLowerCase().includes(q); })
                        .map((c) => ({ ...c, _s: nameScore(r.name || "", c.name || "") }))
                        .sort((a, b) => b._s - a._s || (a.name || a.code).localeCompare(b.name || b.code))
                        .slice(0, 60);
                      return (
                      <Fragment key={i}>
                        <tr className="border-t border-zinc-100 align-top">
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selectedCodes.has(looseCode(r.code))} onChange={() => toggleSelect(r.code)}
                              className="h-3.5 w-3.5 align-middle accent-[var(--color-primary)]" />
                          </td>
                          <td className="px-3 py-2 font-mono">{r.code}</td>
                          <td className="px-3 py-2">{r.name || ""}</td>
                          <td className="px-3 py-2">
                            <span className={
                              r.status === "match" ? "text-green-600 font-semibold"
                                : r.status === "linked" ? "text-blue-600 font-semibold"
                                : r.status === "format-diff" ? "text-amber-600 font-semibold"
                                : "text-red-600 font-semibold"}>
                              {r.status === "match" ? "✓ match" : r.status === "linked" ? "🔗 linked" : r.status === "format-diff" ? "~ format diff" : "✗ no match"}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono">{r.dispoCode || ""}</td>
                          <td className="px-3 py-2">{r.dispoName || ""}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {r.status === "linked" ? (
                                <button onClick={() => unlink(r.code)} disabled={codeBusy} className="font-medium text-red-600 hover:underline disabled:opacity-50">Unlink</button>
                              ) : (r.status === "no-match" || r.status === "format-diff") ? (
                                <button onClick={() => { setLinkFor(linkFor === r.code ? null : r.code); setLinkSearch(""); }} className="rounded border border-[var(--color-border)] px-2 py-1 font-medium text-[var(--color-text)] hover:border-zinc-400">
                                  {linkFor === r.code ? "Close" : "🔗 Link"}
                                </button>
                              ) : null}
                              <button onClick={() => removeFromList(r.code)} disabled={codeBusy} title="Remove from list" className="font-medium text-[var(--color-text-muted)] hover:text-red-600 hover:underline disabled:opacity-50">Remove</button>
                              {r.reason && r.status !== "linked" && <span className="text-[var(--color-text-muted)]">{r.reason}</span>}
                            </div>
                          </td>
                        </tr>
                        {linkFor === r.code && (
                          <tr className="bg-blue-50/60">
                            <td colSpan={7} className="px-3 py-3">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-[var(--color-text)]">Link <span className="font-mono">{r.code}</span>{r.name ? ` — ${r.name}` : ""} to a DISPO store:</span>
                                <input autoFocus value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} placeholder="Search store name or code…"
                                  className="w-64 rounded border border-[var(--color-border)] px-2 py-1 text-xs" />
                                <button onClick={() => { setLinkFor(null); setLinkSearch(""); }} className="text-xs text-[var(--color-text-muted)] hover:underline">Cancel</button>
                              </div>
                              <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white">
                                {candidates.length === 0 ? (
                                  <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">No stores{linkSearch.trim() ? " for that search" : ""}.</div>
                                ) : candidates.map((c) => {
                                  const claimedByOther = c.claim && looseCode(c.claim.by) !== looseCode(r.code);
                                  const viaLabel = c.claim?.via === "linked" ? "linked" : c.claim?.via === "format-diff" ? "format diff" : "in list";
                                  return (
                                  <div key={c.code} className="border-b border-zinc-100 last:border-b-0">
                                    <button
                                      onClick={() => {
                                        if (claimedByOther && !window.confirm(`${c.code} is already used by ${c.claim!.by}. Link ${r.code} to it as well? Both Perigee codes will then point at the same DISPO store.`)) return;
                                        saveLink(r.code, c.code);
                                      }}
                                      disabled={codeBusy}
                                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-blue-50 disabled:opacity-50">
                                      <span>
                                        <span className="font-mono">{c.code}</span> — {c.name || <span className="text-[var(--color-text-muted)]">(no name)</span>}
                                        {claimedByOther && (
                                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">already used by {c.claim!.by} ({viaLabel})</span>
                                        )}
                                      </span>
                                      {c._s > 0 && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">name match</span>}
                                    </button>
                                    {claimedByOther && c.claim!.via === "linked" && (
                                      <div className="px-3 pb-1.5">
                                        <button onClick={() => reassignLink(c.claim!.by, r.code, c.code)} disabled={codeBusy}
                                          className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50">
                                          ↳ Unlink {c.claim!.by} and link {r.code} here instead
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ); })}
                              </div>
                              {linkSearch.trim() && !candidates.some((c) => looseCode(c.code) === looseCode(linkSearch)) && (
                                <button onClick={() => saveLink(r.code, linkSearch.trim())} disabled={codeBusy} className="mt-2 text-xs font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50">
                                  Link to typed code &quot;{linkSearch.trim()}&quot;
                                </button>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ); })}
                  </tbody>
                </table>
              </div>
              {codeRes.dispoOnly.length > 0 && (
                <details className="mt-3 text-xs text-[var(--color-text-muted)]">
                  <summary className="cursor-pointer">Unmatched, unlinked DISPO stores you could link to ({codeRes.dispoOnlyCount}) — excludes DC / online / closed</summary>
                  <div className="mt-2 break-words">{codeRes.dispoOnly.map((c) => c.name ? `${c.code} (${c.name})` : c.code).join("  ·  ")}</div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sync (auto-trigger) — super admin only ── */}
      {isSuperAdmin && (
        <div className="mt-10">
          <h2 className="mb-1 text-lg font-bold text-[var(--color-text)]">Auto-send (check-in trigger)</h2>
          <p className="mb-4 max-w-2xl text-sm text-[var(--color-text-muted)]">
            A scheduled job runs every 3 minutes: it reads today&apos;s Massmart check-ins and emails each store&apos;s
            consolidated report to the rep — using each client&apos;s latest loaded data, once per store + rep per day.
            No arming needed; this toggle is the only on/off.
          </p>

          {proxyOk === false && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              SQL proxy not configured (SQL_PROXY_URL / SQL_PROXY_API_KEY). The trigger can&apos;t read check-ins until that&apos;s set.
            </div>
          )}
          {syncMsg && <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-[var(--color-text)]">{syncMsg}</div>}

          {sync && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">Auto-send enabled</div>
                  <div className="text-xs text-[var(--color-text-muted)]">Master switch for the scheduled job.</div>
                </div>
                <button
                  onClick={() => saveSync({ enabled: !sync.enabled })}
                  disabled={syncBusy}
                  className={`relative h-7 w-12 rounded-full transition-colors ${sync.enabled ? "bg-[var(--color-primary)]" : "bg-zinc-300"} disabled:opacity-50`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${sync.enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>

              <label className="mt-6 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Channel allow-list (one per line)</span>
                <textarea
                  value={channelsText}
                  onChange={(e) => setChannelsText(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-mono"
                  placeholder="Makro&#10;BWH&#10;..." />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Only check-ins on these Perigee channels trigger a report (matched ignoring case / spaces / dashes).</span>
              </label>

              <label className="mt-4 block max-w-xs">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Min seconds between runs (throttle)</span>
                <input
                  type="number" min={0}
                  value={sync.minIntervalSeconds}
                  onChange={(e) => setSync({ ...sync, minIntervalSeconds: Number(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">0 = run every time the cron fires (every 3 min).</span>
              </label>

              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => saveSync({})} disabled={syncBusy}
                  className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
                  {syncBusy ? "Saving…" : "Save settings"}
                </button>
                <button onClick={() => runSync(true)} disabled={syncBusy}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
                  Dry run (preview)
                </button>
                <button onClick={() => runSync(false)} disabled={syncBusy}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  Run now (sends!)
                </button>
              </div>

              {sync.lastRun && (
                <div className="mt-4 text-xs text-[var(--color-text-muted)]">
                  <div>
                    Last run {new Date(sync.lastRun.at).toLocaleString("en-GB")} — {sync.lastRun.ok ? "OK" : "error"} ·
                    {" "}{sync.lastRun.visitsSeen} visits · {sync.lastRun.sent} sent · {sync.lastRun.skipped} skipped · {sync.lastRun.failed} failed
                    {sync.lastRun.message ? ` · ${sync.lastRun.message}` : ""}
                  </div>
                  {sync.lastRun.reasons && Object.keys(sync.lastRun.reasons).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(sync.lastRun.reasons)
                        .sort((a, b) => b[1] - a[1])
                        .map(([label, count]) => (
                          <span key={label} className="rounded-md border border-[var(--color-border)] bg-zinc-50 px-2 py-0.5">
                            {label}: <b className="text-[var(--color-text)]">{count}</b>
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {runResult && (
            <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-white p-5">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {runResult.dryRun ? "Dry run" : "Run"} — day: {runResult.armedPeriod || "none"} · {runResult.visitsSeen} visits ·
                {" "}{runResult.sent} sent · {runResult.skipped} skipped · {runResult.failed} failed
                {runResult.message ? ` · ${runResult.message}` : ""}
              </p>
              {(() => {
                const reasons = runResult.outcomes.reduce<Record<string, number>>((acc, o) => {
                  if (o.status === "sent" || o.status === "would-send") return acc;
                  acc[o.status] = (acc[o.status] ?? 0) + 1;
                  return acc;
                }, {});
                const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
                return entries.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <span className="font-semibold">Skipped/failed because:</span>
                    {entries.map(([status, count]) => (
                      <span key={status} className="rounded-md border border-[var(--color-border)] bg-zinc-50 px-2 py-0.5">
                        {STATUS_LABELS[status] ?? status}: <b className="text-[var(--color-text)]">{count}</b>
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              {runResult.outcomes.length > 0 && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 text-[var(--color-text-muted)]">
                      <tr><th className="px-3 py-2 text-left">Store</th><th className="px-3 py-2 text-left">Rep</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
                    </thead>
                    <tbody>
                      {runResult.outcomes.map((o, i) => (
                        <tr key={i} className="border-t border-zinc-100">
                          <td className="px-3 py-1.5">{o.store || o.siteCode}</td>
                          <td className="px-3 py-1.5">{o.repEmail || "—"}</td>
                          <td className="px-3 py-1.5">{STATUS_LABELS[o.status] ?? o.status}{o.detail ? ` — ${o.detail}` : ""}</td>
                          <td className="px-3 py-1.5 text-right">{o.actions ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Engagement / detail log ── */}
      <div className="mt-10">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--color-text)]">Engagement</h2>
          <div className="flex items-center gap-2">
            <input type="date" value={engDay} onChange={(e) => setEngDay(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm" />
            <button onClick={() => loadEng(engDay)} disabled={engBusy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] hover:border-zinc-400 disabled:opacity-50">
              {engBusy ? "…" : "Refresh"}
            </button>
            {isSuperAdmin && (
              <>
                <button onClick={() => sendDigest(false)} disabled={engBusy}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:border-zinc-400 disabled:opacity-50">
                  Preview digest
                </button>
                <button onClick={() => sendDigest(true)} disabled={engBusy}
                  className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-40">
                  Send digest now
                </button>
              </>
            )}
          </div>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Who&apos;s actually using the reports. <b>Opened</b> = email opened or page viewed; <b>Used</b> = clicked more than one KPI card.
        </p>
        {engMsg && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{engMsg}</div>}

        {eng && (
          <>
            {/* Per-channel summary */}
            <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Channel</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Sent</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Opened</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {eng.summary.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--color-text-muted)]">No reports sent on this day.</td></tr>
                  ) : eng.summary.map((s) => (
                    <tr key={s.channel} className="border-t border-zinc-100">
                      <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">{s.channel}</td>
                      <td className="px-4 py-2.5 text-center">{s.sent}</td>
                      <td className="px-4 py-2.5 text-center">{s.opened} <span className="text-[var(--color-text-muted)]">({s.sent ? Math.round((s.opened / s.sent) * 100) : 0}%)</span></td>
                      <td className="px-4 py-2.5 text-center">{s.used} <span className="text-[var(--color-text-muted)]">({s.sent ? Math.round((s.used / s.sent) * 100) : 0}%)</span></td>
                    </tr>
                  ))}
                </tbody>
                {eng.summary.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[var(--color-border)] bg-zinc-50 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-center">{eng.totalSent}</td>
                      <td className="px-4 py-2.5 text-center">{eng.summary.reduce((a, s) => a + s.opened, 0)}</td>
                      <td className="px-4 py-2.5 text-center">{eng.summary.reduce((a, s) => a + s.used, 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Detail log */}
            {eng.detail.length > 0 && (
              <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Store</th>
                      <th className="px-3 py-2 text-left font-semibold">Channel</th>
                      <th className="px-3 py-2 text-left font-semibold">Rep</th>
                      <th className="px-3 py-2 text-center font-semibold">Opened</th>
                      <th className="px-3 py-2 text-center font-semibold">Used</th>
                      <th className="px-3 py-2 text-center font-semibold">Cards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eng.detail.map((d, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        <td className="px-3 py-1.5">{d.store}{d.test && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">test</span>}</td>
                        <td className="px-3 py-1.5">{d.channel}</td>
                        <td className="px-3 py-1.5">{d.repName || d.repEmail}</td>
                        <td className="px-3 py-1.5 text-center">{d.opened ? "✓" : "—"}</td>
                        <td className="px-3 py-1.5 text-center">{d.used ? <span className="font-semibold text-green-600">✓</span> : "—"}</td>
                        <td className="px-3 py-1.5 text-center">{d.distinctCards.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
