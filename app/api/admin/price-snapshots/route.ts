import { NextRequest } from "next/server";
import { requireRole, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import {
  getAllSalesLedgers,
  getSalesLedger,
  overwriteSalesLedger,
} from "@/lib/salesData";
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
  error?: string;
}

async function sweep(
  apply: boolean,
  onlyClientId?: string | null,
): Promise<{ ledgers: LedgerResult[]; totals: Record<string, number> }> {
  const clients = await getClients();
  const targets = onlyClientId ? clients.filter((c) => c.id === onlyClientId) : clients;

  const ledgers: LedgerResult[] = [];

  for (const client of targets) {
    const metas = await getAllSalesLedgers(client.id);
    for (const meta of metas) {
      const base = {
        clientId: client.id,
        clientName: client.name,
        channelId: meta.channelId,
        channelName: meta.channelName,
      };
      try {
        const rows = await getSalesLedger(client.id, meta.channelId);
        const summary = repairLedger(rows, { apply });
        // Only pay for a write when something actually changed.
        if (apply && summary.fieldsRemoved > 0) {
          await overwriteSalesLedger(client.id, meta.channelId, rows);
        }
        ledgers.push({ ...base, ...summary });
      } catch (err) {
        ledgers.push({
          ...base,
          rows: 0, rowsRepaired: 0, fieldsRemoved: 0, byField: {},
          liveSuspectRows: 0, unknownRows: 0, samples: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
      unknownRows: acc.unknownRows + l.unknownRows,
    }),
    { ledgers: 0, failed: 0, rows: 0, rowsRepaired: 0, fieldsRemoved: 0, liveSuspectRows: 0, unknownRows: 0 },
  );

  return { ledgers, totals };
}

export async function GET(req: NextRequest) {
  try {
    /* Seeing the damage is not the dangerous half, and the Data Health page is
       already gated on manage_clients — matching it keeps the scan button from
       403ing for the people who own that page. Applying stays super-admin. */
    requirePermission(req, "manage_clients");
    const clientId = new URL(req.url).searchParams.get("clientId");
    const started = Date.now();
    const { ledgers, totals } = await sweep(false, clientId);
    return Response.json(
      {
        mode: "preview",
        note:
          "Nothing was written. POST ?confirm=repair to delete the poisoned year snapshots. " +
          "liveSuspectRows are rows whose CURRENT price is the pack one — those heal when " +
          "that client's latest DISPO is re-loaded, not by this sweep.",
        seconds: Math.round((Date.now() - started) / 100) / 10,
        totals,
        ledgers: ledgers.filter((l) => l.fieldsRemoved > 0 || l.liveSuspectRows > 0 || l.error),
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
      const { ledgers, totals } = await sweep(true, clientId);
      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "repair_price_snapshots",
        details:
          `Removed ${totals.fieldsRemoved} pack-price snapshot(s) from ${totals.rowsRepaired} row(s) ` +
          `across ${totals.ledgers} ledger(s)${clientId ? " (single client)" : ""}. ` +
          `${totals.liveSuspectRows} row(s) still hold a pack-level CURRENT price and need a DISPO re-load.`,
        status: totals.failed > 0 ? "error" : "success",
      });
      return Response.json(
        {
          mode: "applied",
          seconds: Math.round((Date.now() - started) / 100) / 10,
          totals,
          ledgers: ledgers.filter((l) => l.fieldsRemoved > 0 || l.liveSuspectRows > 0 || l.error),
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
