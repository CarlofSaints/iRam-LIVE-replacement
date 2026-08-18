import { NextRequest } from "next/server";
import { requireRole, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import {
  getAllSalesLedgers,
  getSalesLedger,
  overwriteSalesLedger,
} from "@/lib/salesData";
import { listBlobs } from "@/lib/blob";
import { repairLedger, type LedgerRepairSummary } from "@/lib/priceSnapshotRepair";
import { acquireUploadLock, releaseUploadLock, lockMessage } from "@/lib/uploadLock";
import { addLog } from "@/lib/activityLog";

/* Pack-price snapshot sweep.

   GET  — dry run. Reads every ledger, reports how many rows carry a per-year
          price snapshot that is a CASE or PALLET price rather than a unit
          price. Writes nothing.
   POST — the same pass, applying the deletions. Needs ?confirm=repair.

   Why this exists at all is in lib/priceSnapshotRepair.ts. Short version: DISPO
   loads before `8f6014d` (30 Jun 2026) folded a SKU's per-UOM rows onto one
   ledger key, so the case price won, and mergeDispo snapshotted that as the
   year's price. VERIGREEN's same-month-LY value read R13.9m against a true
   R775k. Live prices heal on the next DISPO load; the year snapshots never do.

   Super admin only, and it takes the app-wide upload lock — it rewrites whole
   ledgers, so it must not run alongside a DISPO load. */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface LedgerResult extends LedgerRepairSummary {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  snapshotRows: number;   // rows carrying ANY per-year price at all
  error?: string;
}

/* How many rows carry a per-year price of any kind. Reported even when nothing
   is wrong, so "we looked and it was clean" is distinguishable from "we never
   looked" — the first sweep could not tell those apart, which is why a skipped
   ledger read as a successful run. */
function countSnapshotRows(rows: Record<string, unknown>[]): number {
  let n = 0;
  for (const r of rows) {
    if (Object.keys(r).some((k) => /^_(inclSP|promSP|nettCost)_\d{4}$/.test(k))) n++;
  }
  return n;
}

/* Find every ledger by BLOB PREFIX, not by `sales/{clientId}/index.json`.

   That index is a read-modify-write of one shared JSON — the same shape as the
   uploads index that silently lost entries under concurrent loads. A ledger
   missing from it is invisible, and on 17 Aug that is exactly what happened:
   the first sweep reported 52 ledgers, VERIGREEN/MAKRO was not among them, and
   its 2025 prices survived while the summary said the run had succeeded.
   The purge already sweeps by prefix for the same reason. */
async function findLedgers(onlyClientId?: string | null): Promise<{ clientId: string; channelId: string }[]> {
  const blobs = await listBlobs("sales/");
  const out: { clientId: string; channelId: string }[] = [];
  const seen = new Set<string>();
  for (const b of blobs) {
    const m = b.key.match(/(?:^|\/)sales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const [, clientId, channelId] = m;
    if (channelId === "index" || channelId.endsWith("-meta")) continue;   // not ledgers
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
  useSiblings = true,
): Promise<{ ledgers: LedgerResult[]; totals: Record<string, number> }> {
  const clients = await getClients();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  /* Names come from the per-client index when it has them — it is fine for
     LABELS, just not for deciding what exists. */
  const channelName = new Map<string, string>();
  for (const c of clients) {
    for (const meta of await getAllSalesLedgers(c.id)) {
      if (meta.channelName) channelName.set(`${c.id}/${meta.channelId}`, meta.channelName);
    }
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
      const rows = await getSalesLedger(cid, channelId);
      const summary = repairLedger(rows, { apply, useSiblings });
      // Only pay for a write when something actually changed.
      if (apply && summary.fieldsRemoved > 0) {
        await overwriteSalesLedger(cid, channelId, rows);
      }
      ledgers.push({ ...base, ...summary, snapshotRows: countSnapshotRows(rows) });
    } catch (err) {
      ledgers.push({
        ...base,
        rows: 0, rowsRepaired: 0, fieldsRemoved: 0, byField: {},
        liveSuspectRows: 0, liveSuspectUnits: 0, unknownRows: 0, unknownUnits: 0,
        siblingJudgedRows: 0, siblingRemovedFields: 0, samples: [], snapshotRows: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totals = ledgers.reduce(
    (acc, l) => ({
      ledgers: acc.ledgers + 1,
      failed: acc.failed + (l.error ? 1 : 0),
      rows: acc.rows + l.rows,
      rowsRepaired: acc.rowsRepaired + l.rowsRepaired,
      fieldsRemoved: acc.fieldsRemoved + l.fieldsRemoved,
      liveSuspectRows: acc.liveSuspectRows + l.liveSuspectRows,
      liveSuspectUnits: acc.liveSuspectUnits + l.liveSuspectUnits,
      unknownRows: acc.unknownRows + l.unknownRows,
      unknownUnits: acc.unknownUnits + l.unknownUnits,
      siblingJudgedRows: acc.siblingJudgedRows + l.siblingJudgedRows,
      siblingRemovedFields: acc.siblingRemovedFields + l.siblingRemovedFields,
      snapshotRows: acc.snapshotRows + l.snapshotRows,
    }),
    {
      ledgers: 0, failed: 0, rows: 0, rowsRepaired: 0, fieldsRemoved: 0,
      liveSuspectRows: 0, liveSuspectUnits: 0, unknownRows: 0, unknownUnits: 0,
      siblingJudgedRows: 0, siblingRemovedFields: 0, snapshotRows: 0,
    },
  );

  return { ledgers, totals };
}

export async function GET(req: NextRequest) {
  try {
    /* Seeing the damage is not the dangerous half, and the Data Health page is
       already gated on manage_clients — matching it keeps the scan button from
       403ing for the people who own that page. Applying stays super-admin. */
    requirePermission(req, "manage_clients");
    const q = new URL(req.url).searchParams;
    const clientId = q.get("clientId");
    // ?siblings=0 reproduces the original row-only logic, so the two can be
    // compared on real data instead of argued about.
    const useSiblings = q.get("siblings") !== "0";
    const started = Date.now();
    const { ledgers, totals } = await sweep(false, clientId, useSiblings);
    return Response.json(
      {
        mode: "preview",
        useSiblings,
        note:
          "Nothing was written. POST ?confirm=repair to delete the poisoned year snapshots. " +
          "liveSuspectRows are rows whose CURRENT price is the pack one — those heal when " +
          "that client's latest DISPO is re-loaded, not by this sweep.",
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
        { error: "Add ?confirm=repair to apply. GET this endpoint first to see what would change." },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    const clientId = url.searchParams.get("clientId");
    const useSiblings = url.searchParams.get("siblings") !== "0";

    /* Fails closed — an unreadable lock reads as busy, never as "go ahead".
       Rewriting a ledger under a concurrent DISPO load would lose that load. */
    const lock = await acquireUploadLock({
      userId: session.userId,
      userName: session.name,
      clientName: clientId ? `client ${clientId}` : "ALL CLIENTS",
      fileName: "pack-price snapshot repair",
    });
    if (!lock.ok) {
      return Response.json(
        { error: lockMessage(lock.heldBy), heldBy: lock.heldBy },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    const started = Date.now();
    try {
      const { ledgers, totals } = await sweep(true, clientId, useSiblings);
      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "repair_price_snapshots",
        details:
          `Removed ${totals.fieldsRemoved} pack-price snapshot(s) from ${totals.rowsRepaired} row(s) ` +
          `across ${totals.ledgers} ledger(s)${clientId ? " (single client)" : ""}. ` +
          `${totals.liveSuspectRows} row(s) still hold a pack-level CURRENT price and need a DISPO re-load. ` +
          `${totals.siblingRemovedFields} of the removals were only findable via the same product at another store.`,
        status: totals.failed > 0 ? "error" : "success",
      });
      return Response.json(
        {
          mode: "applied",
          useSiblings,
          seconds: Math.round((Date.now() - started) / 100) / 10,
          totals,
          ledgers,
        },
        { headers: noCacheHeaders() },
      );
    } finally {
      await releaseUploadLock(lock.lock.id);
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
