import { NextRequest } from "next/server";
import { requireRole, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedgerMeta, setSalesLedgerPeriod } from "@/lib/salesData";
import { getUploadIndex } from "@/lib/uploadData";
import { periodScore } from "@/lib/dispoSnapshot";
import { listBlobs } from "@/lib/blob";
import { acquireUploadLock, releaseUploadLock, lockMessage } from "@/lib/uploadLock";
import { addLog } from "@/lib/activityLog";
import type { UploadMeta } from "@/lib/types";

/* Ledger period-stamp repair.

   GET  — dry run. Reports every ledger whose stamp is BEHIND the newest DISPO
          actually loaded into it. Writes nothing.
   POST — restamps them. Needs ?confirm=repair.

   Why: until the guard added alongside this route, mergeDispo wrote the ledger
   stamp last-load-wins, so back-loading history dragged it backwards. One
   morning of Dec-2025 back-loads (25 Aug 2026, 45 files, MAKRO + WALMART) left
   23 of 52 live ledgers stamped Dec 2025 Wk4 over data running to Aug 2026.
   The guard stops it recurring; it does not repair what is already written.

   Not just a label: Reports resolves "Auto" off this stamp, and month-end
   builds its Phantom reference date and Numerical Distribution window from the
   resolved YEAR and MONTH.

   THE REPAIR ONLY EVER MOVES A STAMP FORWARD. A ledger stamped NEWER than any
   upload we can see is REPORTED and left alone — the uploads index has lost
   entries before (59afa4a), and "repair" must never become the thing that
   destroys the only correct value left.

   Super admin to apply, and it takes the app-wide upload lock so it cannot run
   against a live DISPO load. */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Verdict = "behind" | "correct" | "ahead" | "no loads" | "unstamped ledger" | "error";

interface LedgerResult {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  verdict: Verdict;
  stamp: string;            // what the ledger says now
  shouldBe: string;         // newest period actually loaded here
  monthsBehind: number;
  loads: number;            // DISPO loads found for this ledger
  newestLoad?: string;      // file + when + who, so a verdict can be checked
  repaired?: boolean;
  error?: string;
}

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (y?: number, m?: number, w?: number) =>
  y ? `${MON[m ?? 0] ?? m} ${y} Wk${w ?? "?"}` : "(unstamped)";

/* Whole months between two periods — the headline number. Weeks are ignored
   here on purpose: "8 months behind" is the thing worth reading in a list of
   fifty, and the exact week is already printed beside it. */
function monthGap(a: { y?: number; m?: number }, b: { y?: number; m?: number }): number {
  if (!a.y || !b.y) return 0;
  return (b.y - a.y) * 12 + ((b.m ?? 0) - (a.m ?? 0));
}

/* Find ledgers by BLOB PREFIX, not by the per-client index. That index is a
   read-modify-write of one shared JSON and has silently lost entries; a ledger
   missing from it would be invisible to this sweep and would read as "clean".
   Same reason the price-snapshot sweep and the client purge do it. */
async function findLedgers(onlyClientId?: string | null): Promise<{ clientId: string; channelId: string }[]> {
  const blobs = await listBlobs("sales/");
  const out: { clientId: string; channelId: string }[] = [];
  const seen = new Set<string>();
  for (const b of blobs) {
    const m = b.key.match(/(?:^|\/)sales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const [, clientId, channelId] = m;
    if (channelId === "index" || channelId.endsWith("-meta")) continue;
    if (onlyClientId && clientId !== onlyClientId) continue;
    const k = `${clientId}/${channelId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ clientId, channelId });
  }
  return out;
}

async function sweep(
  apply: boolean,
  onlyClientId?: string | null,
): Promise<{ ledgers: LedgerResult[]; totals: Record<string, number> }> {
  const clients = await getClients();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const channelName = new Map<string, string>();
  for (const c of clients) {
    for (const meta of await getAllSalesLedgers(c.id)) {
      if (meta.channelName) channelName.set(`${c.id}/${meta.channelId}`, meta.channelName);
    }
  }

  /* Every DISPO load the app recorded, grouped to the ledger it merged into.
     Only `processed` counts — an errored upload never reached mergeDispo, so
     letting it set a period would invent one. */
  const byLedger = new Map<string, UploadMeta[]>();
  const byId = new Map<string, UploadMeta>();
  for (const u of await getUploadIndex()) {
    byId.set(u.id, u);
    if (u.fileType !== "dispo" || u.status !== "processed") continue;
    const k = `${u.clientId}/${u.channelId}`;
    const arr = byLedger.get(k) ?? [];
    arr.push(u);
    byLedger.set(k, arr);
  }

  const ledgers: LedgerResult[] = [];

  for (const { clientId: cid, channelId } of await findLedgers(onlyClientId)) {
    const base = {
      clientId: cid,
      clientName: clientName.get(cid) ?? `(unknown client ${cid})`,
      channelId,
      channelName: channelName.get(`${cid}/${channelId}`) ?? channelId,
    };
    try {
      const meta = await getSalesLedgerMeta(cid, channelId);
      if (!meta) {
        ledgers.push({
          ...base, verdict: "error", stamp: "-", shouldBe: "-",
          monthsBehind: 0, loads: 0, error: "no meta blob",
        });
        continue;
      }

      /* Union of "uploads recorded against this client+channel" and "upload ids
         this ledger says it merged". Either list alone can be short: the index
         has lost appends, and mergedUploadIds predates some loads. */
      const candidates = new Map<string, UploadMeta>();
      for (const u of byLedger.get(`${cid}/${channelId}`) ?? []) candidates.set(u.id, u);
      for (const id of meta.mergedUploadIds ?? []) {
        const u = byId.get(id);
        if (u && u.fileType === "dispo" && u.status === "processed") candidates.set(u.id, u);
      }

      let newest: UploadMeta | null = null;
      for (const u of candidates.values()) {
        if (!u.reportYear) continue;
        if (
          !newest ||
          periodScore(u.reportYear, u.reportMonth, u.reportWeek) >
            periodScore(newest.reportYear, newest.reportMonth, newest.reportWeek)
        ) {
          newest = u;
        }
      }

      const cur = periodScore(meta.reportYear, meta.reportMonth, meta.reportWeek);
      const top = newest ? periodScore(newest.reportYear, newest.reportMonth, newest.reportWeek) : 0;

      const row: LedgerResult = {
        ...base,
        verdict: "correct",
        stamp: label(meta.reportYear, meta.reportMonth, meta.reportWeek),
        shouldBe: newest ? label(newest.reportYear, newest.reportMonth, newest.reportWeek) : "-",
        monthsBehind: newest
          ? monthGap({ y: meta.reportYear, m: meta.reportMonth }, { y: newest.reportYear, m: newest.reportMonth })
          : 0,
        loads: candidates.size,
        newestLoad: newest
          ? `${newest.fileName} — ${(newest.uploadDate ?? "").slice(0, 16).replace("T", " ")} by ${newest.uploadedByName || "?"}`
          : undefined,
      };

      if (top === 0) row.verdict = "no loads";
      else if (cur === 0) row.verdict = "unstamped ledger";
      else if (cur > top) row.verdict = "ahead";
      else if (cur < top) row.verdict = "behind";

      // Only "behind" and "unstamped" are repairable, and both move FORWARD.
      if (apply && newest && (row.verdict === "behind" || row.verdict === "unstamped ledger")) {
        await setSalesLedgerPeriod(cid, channelId, {
          reportYear: newest.reportYear,
          reportMonth: newest.reportMonth,
          reportWeek: newest.reportWeek,
        });
        row.repaired = true;
      }

      ledgers.push(row);
    } catch (err) {
      ledgers.push({
        ...base, verdict: "error", stamp: "-", shouldBe: "-", monthsBehind: 0, loads: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const count = (v: Verdict) => ledgers.filter((l) => l.verdict === v).length;
  const totals = {
    ledgers: ledgers.length,
    behind: count("behind"),
    correct: count("correct"),
    ahead: count("ahead"),
    unstamped: count("unstamped ledger"),
    noLoads: count("no loads"),
    failed: count("error"),
    repaired: ledgers.filter((l) => l.repaired).length,
    worstMonthsBehind: ledgers.reduce((n, l) => Math.max(n, l.monthsBehind), 0),
  };

  // Worst first — a fifty-row list is unreadable in ledger order.
  ledgers.sort((a, b) => b.monthsBehind - a.monthsBehind || a.clientName.localeCompare(b.clientName));

  return { ledgers, totals };
}

export async function GET(req: NextRequest) {
  try {
    // Seeing the damage is the safe half — matches the price-snapshot sweep.
    requirePermission(req, "manage_clients");
    const q = new URL(req.url).searchParams;
    const started = Date.now();
    const { ledgers, totals } = await sweep(false, q.get("clientId"));
    return Response.json(
      {
        mode: "preview",
        note:
          "Nothing was written. POST with confirm=repair to restamp the ledgers marked behind. " +
          "A verdict of ahead means the ledger claims a NEWER period than any upload on record — " +
          "that is left alone deliberately (the uploads index has lost entries before) and is " +
          "worth a look.",
        seconds: Math.round((Date.now() - started) / 100) / 10,
        totals,
        ledgers,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireRole(req, "super_admin");
    const url = new URL(req.url);
    if (url.searchParams.get("confirm") !== "repair") {
      return Response.json(
        { error: "Add confirm=repair to apply. GET this endpoint first to see what would change." },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    const clientId = url.searchParams.get("clientId");

    /* Fails closed. Restamping under a concurrent DISPO load would race that
       load's own meta write. */
    const lock = await acquireUploadLock({
      userId: session.userId,
      userName: session.name,
      clientName: clientId ? `client ${clientId}` : "ALL CLIENTS",
      fileName: "ledger period-stamp repair",
    });
    if (!lock.ok) {
      return Response.json(
        { error: lockMessage(lock.heldBy), heldBy: lock.heldBy },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    const started = Date.now();
    try {
      const { ledgers, totals } = await sweep(true, clientId);
      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "repair_ledger_stamps",
        details:
          `Restamped ${totals.repaired} of ${totals.ledgers} ledger(s)${clientId ? " (single client)" : ""} ` +
          `to the newest DISPO period actually loaded into them. ` +
          `${totals.ahead} ledger(s) claim a period NEWER than any upload on record and were left alone.`,
        status: totals.failed > 0 ? "error" : "success",
      });
      return Response.json(
        { mode: "applied", seconds: Math.round((Date.now() - started) / 100) / 10, totals, ledgers },
        { headers: noCacheHeaders() },
      );
    } finally {
      await releaseUploadLock(lock.lock);
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
