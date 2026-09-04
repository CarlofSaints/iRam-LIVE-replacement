import { NextRequest } from "next/server";
import { requireRole, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta, removeLedgerRows } from "@/lib/salesData";
import { getUploadById, deleteUpload } from "@/lib/uploadData";
import { acquireUploadLock, releaseUploadLock, lockMessage } from "@/lib/uploadLock";
import { addLog } from "@/lib/activityLog";

/* Undo a DISPO that was loaded against the WRONG CHANNEL.

   GET  — dry run. Says exactly which rows would go and writes nothing.
   POST — removes them. Needs confirm=remove AND expect=<the dry run's count>.

   Why this cannot be done with the existing delete: DELETE /api/uploads/[id]
   removes the upload RECORD and its raw blob and stops there. Ledger rows carry
   no upload id, so the rows that load merged stay exactly where they are — the
   record-only delete hides the evidence and leaves the wrong numbers in every
   report. Rows first, record second.

   The selector is (channelId, _vendor, _lastLoadedAt) and ALL THREE are
   required. A load stamps every one of its rows with the same _lastLoadedAt, so
   the pair is a precise fingerprint of one load; requiring the vendor as well
   means no single parameter can widen into "delete this ledger".

   First use: TRAMONTINA AFRICA, 4 Aug 2026. "Tramontina (12908-W4) MM.xlsx" —
   the MAKRO file — was uploaded into MASSBUILD at 10:10 and again into MAKRO,
   correctly, at 10:11. The 169 rows from the first upload stayed in the
   Massbuild ledger and were reported as Massbuild for a month: 24 of its 223
   Margin RISK lines, 98 of 761 OPPORTUNITY lines and 1,359 units of SOH.

   Nothing complained at load time because the vendor check is client-wide
   (12908 IS one of Tramontina's vendor numbers) and because the Excel-mangled
   site-code repair, scoped to the selected channel's store master, rewrote all
   26 Makro codes into Massbuild ones — M01 and M001 share the normalised key
   "m1" — so every site matched and the load logged a clean success. */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Selector {
  clientId: string;
  channelId: string;
  vendor: string;
  loadedAt: string;
  uploadId: string | null;
}

function readSelector(url: URL): { sel: Selector } | { error: string } {
  const clientId = (url.searchParams.get("clientId") || "").trim();
  const channelId = (url.searchParams.get("channelId") || "").trim();
  const vendor = (url.searchParams.get("vendor") || "").trim();
  const loadedAt = (url.searchParams.get("loadedAt") || "").trim();
  const uploadId = (url.searchParams.get("uploadId") || "").trim() || null;
  const missing = [
    !clientId && "clientId",
    !channelId && "channelId",
    !vendor && "vendor",
    !loadedAt && "loadedAt",
  ].filter(Boolean);
  if (missing.length) {
    return {
      error:
        `Missing ${missing.join(", ")}. All four are required: the selector is ` +
        `(channelId, vendor, loadedAt) so that no single parameter can widen ` +
        `into "delete this ledger". loadedAt is the rows' exact _lastLoadedAt.`,
    };
  }
  return { sel: { clientId, channelId, vendor, loadedAt, uploadId } };
}

const rowKey = (r: Record<string, unknown>): string =>
  `${String(r["Article"] ?? "").trim().toLowerCase()}|${String(r["Site"] ?? "").trim().toLowerCase()}`;

const matcher = (sel: Selector) => (r: Record<string, unknown>): boolean =>
  String(r["_vendor"] ?? "").trim() === sel.vendor &&
  String(r["_lastLoadedAt"] ?? "").trim() === sel.loadedAt;

async function inspect(sel: Selector) {
  const rows = await getSalesLedger(sel.clientId, sel.channelId);
  const meta = await getSalesLedgerMeta(sel.clientId, sel.channelId);
  const hit = matcher(sel);

  const matched: Record<string, unknown>[] = [];
  const kept: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (hit(r)) matched.push(r);
    else kept.push(r);
  }

  /* A matched row whose Article|Site also exists among the rows we are keeping
     would mean this load OVERWROTE a real row rather than adding one — removing
     it would then delete data that belongs here. Zero is the safe answer, and
     the caller is told either way rather than finding out afterwards. */
  const keptKeys = new Set(kept.map(rowKey));
  const collisions = matched.filter((r) => keptKeys.has(rowKey(r)));

  return {
    ledgerRows: rows.length,
    ledgerVendor: meta?.vendorNumber ?? null,
    ledgerPeriod: meta?.reportYear
      ? `${meta.reportYear}-${String(meta.reportMonth ?? 0).padStart(2, "0")}Wk${meta.reportWeek ?? "?"}`
      : null,
    matched: matched.length,
    wouldKeep: kept.length,
    distinctSites: new Set(matched.map((r) => String(r["Site"] ?? ""))).size,
    distinctArticles: new Set(matched.map((r) => String(r["Article"] ?? ""))).size,
    collisionsWithKeptRows: collisions.length,
    sites: [...new Set(matched.map((r) => String(r["Site"] ?? "")))].sort(),
    sample: matched.slice(0, 5).map((r) => ({
      Site: r["Site"], Article: r["Article"], Vendor: r["Vendor"],
      SOH: r["SOH"], _vendor: r["_vendor"], _lastLoadedAt: r["_lastLoadedAt"],
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const url = new URL(req.url);
    const parsed = readSelector(url);
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400, headers: noCacheHeaders() });
    }
    const result = await inspect(parsed.sel);
    const upload = parsed.sel.uploadId ? await getUploadById(parsed.sel.uploadId) : null;
    return Response.json(
      {
        mode: "preview",
        note:
          "Nothing was written. POST with confirm=remove&expect=<matched> to apply. " +
          "collisionsWithKeptRows must be 0 — anything else means this load overwrote " +
          "rows that DO belong to this channel, and removing them would take real data with it.",
        selector: parsed.sel,
        upload: upload
          ? {
              id: upload.id, fileName: upload.fileName, channelName: upload.channelName,
              vendorNumber: upload.vendorNumber, rowCount: upload.rowCount,
              uploadDate: upload.uploadDate, uploadedBy: upload.uploadedByName ?? upload.uploadedBy,
            }
          : parsed.sel.uploadId ? "NOT FOUND" : null,
        ...result,
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
    if (url.searchParams.get("confirm") !== "remove") {
      return Response.json(
        { error: "Add confirm=remove to apply. GET this endpoint first to see what would go." },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    const expect = Number(url.searchParams.get("expect"));
    if (!Number.isInteger(expect) || expect <= 0) {
      return Response.json(
        {
          error:
            "expect=<row count> is required — the number the dry run reported. " +
            "A mismatch aborts before anything is written.",
        },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    const parsed = readSelector(url);
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400, headers: noCacheHeaders() });
    }
    const sel = parsed.sel;

    /* Fails closed, like the stamp repair: rewriting a ledger under a concurrent
       DISPO load would race that load's own write. */
    const lock = await acquireUploadLock({
      userId: session.userId,
      userName: session.name,
      clientName: `client ${sel.clientId}`,
      fileName: "wrong-channel load removal",
    });
    if (!lock.ok) {
      return Response.json(
        { error: lockMessage(lock.heldBy), heldBy: lock.heldBy },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    try {
      const before = await inspect(sel);
      if (before.collisionsWithKeptRows > 0) {
        return Response.json(
          {
            error:
              `${before.collisionsWithKeptRows} of the matched rows share an Article|Site with a row ` +
              `that is being kept, so this load overwrote real data rather than only adding to it. ` +
              `Removing them would delete rows that belong to this channel. Aborted.`,
            ...before,
          },
          { status: 409, headers: noCacheHeaders() },
        );
      }

      const upload = sel.uploadId ? await getUploadById(sel.uploadId) : null;
      if (sel.uploadId && !upload) {
        return Response.json(
          {
            error:
              `uploadId ${sel.uploadId} not found. Omit it, or correct it — removing rows ` +
              `while naming a record that does not exist is how the two get out of step.`,
          },
          { status: 404, headers: noCacheHeaders() },
        );
      }

      const removal = await removeLedgerRows(
        sel.clientId,
        sel.channelId,
        matcher(sel),
        expect,
        sel.uploadId ?? undefined,
      );

      // Rows are gone; now the record can go without hiding anything.
      if (sel.uploadId) await deleteUpload(sel.uploadId);

      const details =
        `Removed ${removal.removed} row(s) from ${sel.clientId}/${sel.channelId} left behind by a ` +
        `DISPO loaded against the wrong channel (vendor ${sel.vendor}, loaded ${sel.loadedAt}). ` +
        `Ledger ${removal.before} to ${removal.kept} rows.` +
        (upload
          ? ` Upload record ${upload.id} also deleted: "${upload.fileName}", ` +
            `${upload.channelName}/${upload.vendorNumber}, ${upload.rowCount} rows, ` +
            `loaded ${upload.uploadDate} by ${upload.uploadedByName ?? upload.uploadedBy}.`
          : "");

      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "remove_wrong_channel_load",
        details,
        status: "success",
      });

      return Response.json(
        { mode: "applied", selector: sel, ...removal, uploadRecordDeleted: sel.uploadId ?? null, details },
        { headers: noCacheHeaders() },
      );
    } finally {
      await releaseUploadLock(lock.lock);
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
