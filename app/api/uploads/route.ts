import { NextRequest } from "next/server";
import { getUploadIndex, getUploadsByClient, addUpload } from "@/lib/uploadData";
import { getClientById } from "@/lib/clientData";
import { getChannelById, getChannels } from "@/lib/channelData";
import { parseDispo } from "@/lib/dispoParser";
import { mergeDispo } from "@/lib/salesData";
import { getLinksLookup, normalizeArticle } from "@/lib/linksLookup";
import { getMergedStores } from "@/lib/storeFileData";
import { getCamById } from "@/lib/camData";
import { getUsers } from "@/lib/userData";
import { sendMissingProductsEmail, sendMissingStoresEmail } from "@/lib/email";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import type { FileType } from "@/lib/types";

export interface MissingArticleDetail {
  article: string;
  articleDesc: string;
  vendProd: string;
  barcode: string;
}

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    if (clientId) {
      return Response.json(await getUploadsByClient(clientId), { headers: noCacheHeaders() });
    }
    return Response.json(await getUploadIndex(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "upload_data");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const channelId = formData.get("channelId") as string | null;
    const fileType = formData.get("fileType") as FileType | null;
    const reportYear = formData.get("reportYear") ? Number(formData.get("reportYear")) : undefined;
    const reportMonth = formData.get("reportMonth") ? Number(formData.get("reportMonth")) : undefined;
    const reportWeek = formData.get("reportWeek") ? Number(formData.get("reportWeek")) : undefined;
    const force = formData.get("force") === "true";

    if (!file || !clientId || !channelId || !fileType) {
      return Response.json({ error: "File, clientId, channelId, and fileType are required" }, { status: 400, headers: noCacheHeaders() });
    }

    // A DISPO load must be stamped with the week it is for — the load checklist
    // buckets loads by (year, month, week), so a missing week can't be placed.
    if (fileType === "dispo" && (reportWeek === undefined || isNaN(reportWeek) || reportWeek < 1)) {
      return Response.json({ error: "A report week is required for DISPO uploads" }, { status: 400, headers: noCacheHeaders() });
    }

    const client = await getClientById(clientId);
    if (!client) return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });

    const channel = await getChannelById(channelId);
    if (!channel) return Response.json({ error: "Channel not found" }, { status: 404, headers: noCacheHeaders() });

    const buffer = Buffer.from(await file.arrayBuffer());

    if (fileType === "dispo") {
      const result = parseDispo(buffer);

      // Validate vendor numbers (always hard-block — wrong vendor is never OK).
      // A DISPO can carry several real vendors; check EVERY distinct numeric
      // vendor in the file (DC codes like "D102" are excluded by the parser).
      if (client.vendorNumbers.length > 0 && result.vendorNumbers.length > 0) {
        const bad = result.vendorNumbers.filter((v) => !client.vendorNumbers.includes(v));
        if (bad.length > 0) {
          return Response.json({
            error: `Vendor number(s) ${bad.join(", ")} from file do not match client's vendor numbers (${client.vendorNumbers.join(", ")})`,
          }, { status: 400, headers: noCacheHeaders() });
        }
      }

      // Resolve main channel (channelId should already be a main channel)
      const mainChannelId = channel.parentId ?? channel.id;
      const allChannels = await getChannels();
      const channelById = new Map(allChannels.map((c) => [c.id, c]));
      const mainRecord = channelById.get(mainChannelId) ?? channel;
      const mainChannelName = mainRecord.name;

      // ── Companion-channel group ──
      // A main channel's DISPO export can carry sites belonging to companion
      // channels (e.g. the Makro export also contains Walmart sites). Build the
      // group of channels whose store masters we validate against and route rows
      // into. The link is treated bidirectionally so loading from either side
      // (Makro or Walmart) splits the file correctly.
      const groupIds = new Set<string>([mainChannelId]);
      for (const cid of mainRecord.companionChannelIds ?? []) groupIds.add(cid);
      for (const c of allChannels) {
        if (!c.parentId && c.companionChannelIds?.includes(mainChannelId)) groupIds.add(c.id);
      }
      const acceptChannels = [...groupIds]
        .map((gid) => channelById.get(gid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, name: c.name }));
      const acceptByName = new Map<string, { id: string; name: string }>();
      for (const c of acceptChannels) acceptByName.set(c.name.trim().toUpperCase(), c);

      // ── Validate articles against LINKS ──
      const linksLookup = await getLinksLookup(clientId);
      const missingArticleDetails: MissingArticleDetail[] = [];

      if (linksLookup.size > 0) {
        const seenArticles = new Set<string>();
        for (const row of result.rows) {
          const raw = String(row["Article"] ?? "").trim();
          const normalized = normalizeArticle(raw);
          if (normalized && !seenArticles.has(normalized)) {
            seenArticles.add(normalized);
            if (!linksLookup.has(normalized)) {
              missingArticleDetails.push({
                article: raw,
                articleDesc: String(row["Article Desc"] ?? "").trim(),
                vendProd: String(row["Vendor Prod Code"] ?? "").trim(),
                barcode: String(row["Barcode"] ?? "").trim(),
              });
            }
          }
        }
      }

      // ── Validate sites against the group's store master(s) ──
      // Map each known site to the channel that owns it (so rows can later be
      // split per site's own channel). A site is "known" if it appears in any
      // accept channel's store master.
      const mergedStores = await getMergedStores();
      const siteChannel = new Map<string, { id: string; name: string }>();
      for (const s of mergedStores) {
        const owner = acceptByName.get(s.channel.trim().toUpperCase());
        if (owner && s.siteNum) siteChannel.set(s.siteNum.trim().toLowerCase(), owner);
      }
      const knownSites = new Set(siteChannel.keys());

      const missingSites: string[] = [];
      const seenSites = new Set<string>();
      for (const row of result.rows) {
        const site = String(row["Site"] ?? "").trim();
        if (site && !seenSites.has(site.toLowerCase())) {
          seenSites.add(site.toLowerCase());
          if (knownSites.size > 0 && !knownSites.has(site.toLowerCase())) {
            missingSites.push(site);
          }
        }
      }

      const hasWarnings =
        missingArticleDetails.length > 0 ||
        missingSites.length > 0 ||
        result.collisions.length > 0;

      // ── If warnings exist and user hasn't confirmed, return for confirmation ──
      if (hasWarnings && !force) {
        // Send notification emails
        const emailPromises: Promise<unknown>[] = [];

        if (missingArticleDetails.length > 0) {
          const recipients = [session.email];
          if (client.camId) {
            const cam = await getCamById(client.camId);
            if (cam?.email && !recipients.includes(cam.email)) {
              recipients.push(cam.email);
            }
          }
          // Plus anyone who maintains control files (LINKS/PMF) and opted in,
          // even if they aren't this client's CAM (e.g. Nicolas).
          const productAlertUsers = await getUsers();
          for (const u of productAlertUsers) {
            if (u.receiveProductAlerts && u.email && !recipients.includes(u.email)) {
              recipients.push(u.email);
            }
          }
          emailPromises.push(
            sendMissingProductsEmail({
              to: recipients,
              clientName: client.name,
              channelName: mainChannelName,
              missingArticles: missingArticleDetails,
              uploaderName: session.name,
            })
          );
        }

        if (missingSites.length > 0) {
          const recipients = [session.email];
          const users = await getUsers();
          for (const u of users) {
            if (u.receiveStoreAlerts && u.email && !recipients.includes(u.email)) {
              recipients.push(u.email);
            }
          }
          emailPromises.push(
            sendMissingStoresEmail({
              to: recipients,
              clientName: client.name,
              channelName: mainChannelName,
              missingSites,
              uploaderName: session.name,
            })
          );
        }

        await Promise.allSettled(emailPromises);

        const parts: string[] = [];
        if (missingArticleDetails.length > 0) parts.push(`${missingArticleDetails.length} unrecognized article(s)`);
        if (missingSites.length > 0) parts.push(`${missingSites.length} unknown store(s)`);
        if (result.collisions.length > 0) parts.push(`${result.collisions.length} column-mapping conflict(s)`);

        return Response.json(
          {
            needsConfirmation: true,
            warning: `${parts.join(" and ")} found. You can continue anyway or fix the files first.`,
            missingArticles: missingArticleDetails,
            missingSites,
            collisions: result.collisions,
          },
          { status: 200, headers: noCacheHeaders() },
        );
      }

      // ── Proceed: split rows by each site's owning channel, then upload +
      //    merge each group into its own channel ledger. With no companions
      //    (or all sites in the primary channel) this collapses to a single
      //    group = the main channel, exactly as before. Sites not found in any
      //    store master fall to the primary main channel.
      // Group by (owning channel × vendor). Splitting per vendor gives each real
      // vendor its own upload record + ledger stamp, so the DISPO checklist shows
      // BOTH vendor streams loaded and stale-row tracking stays per-vendor. Each
      // row's vendor was resolved by the parser (DC lines already carry their
      // article's real vendor). With a single vendor this collapses to one group.
      const primary = { id: mainChannelId, name: mainChannelName };
      const groups = new Map<string, { channel: { id: string; name: string }; vendor: string; rows: Record<string, unknown>[] }>();
      for (const row of result.rows) {
        const site = String(row["Site"] ?? "").trim().toLowerCase();
        const owner = (site && siteChannel.get(site)) || primary;
        const vendor = String(row["_vendor"] ?? "").trim() || result.vendorNumber;
        const gk = `${owner.id}|${vendor}`;
        let g = groups.get(gk);
        if (!g) { g = { channel: owner, vendor, rows: [] }; groups.set(gk, g); }
        g.rows.push(row);
      }
      const groupList = [...groups.values()].filter((g) => g.rows.length > 0);

      const mergeTotals = { inserted: 0, updated: 0, unchanged: 0 };
      const perChannel: { channel: string; vendor: string; rows: number; inserted: number; updated: number; unchanged: number }[] = [];
      let firstUploadId = "";
      for (const g of groupList) {
        const upload = await addUpload(
          {
            clientId,
            clientName: client.name,
            channelId: g.channel.id,
            channelName: g.channel.name,
            fileType: "dispo",
            fileName: file.name,
            uploadDate: new Date().toISOString(),
            uploadedBy: session.userId,
            uploadedByName: session.name,
            vendorNumber: g.vendor,
            period: result.dateColumns.join(", "),
            rowCount: g.rows.length,
            dateColumns: result.dateColumns,
            reportYear,
            reportMonth,
            reportWeek,
            status: "processed",
          },
          g.rows
        );
        if (!firstUploadId) firstUploadId = upload.id;

        const merge = await mergeDispo({
          clientId,
          clientName: client.name,
          channelId: g.channel.id,
          channelName: g.channel.name,
          vendorNumber: g.vendor,
          rows: g.rows,
          dateColumns: result.dateColumns,
          uploadId: upload.id,
          reportYear,
          reportMonth,
          reportWeek,
        });
        mergeTotals.inserted += merge.inserted;
        mergeTotals.updated += merge.updated;
        mergeTotals.unchanged += merge.unchanged;
        perChannel.push({ channel: g.channel.name, vendor: g.vendor, rows: g.rows.length, ...merge });
      }

      const logSuffix = hasWarnings
        ? ` (forced with ${missingArticleDetails.length} missing articles, ${missingSites.length} missing sites)`
        : "";
      const splitSuffix = perChannel.length > 1
        ? ` Split by channel×vendor: ${perChannel.map((p) => `${p.channel}/${p.vendor} ${p.rows}`).join(", ")}.`
        : "";
      const vendorLabel = result.vendorNumbers.length ? result.vendorNumbers.join("/") : result.vendorNumber;

      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "upload_dispo",
        details: `Uploaded DISPO for ${client.name} / ${mainChannelName} (${result.totalRows} rows, vendor(s) ${vendorLabel}). Ledger merge: ${mergeTotals.inserted} new, ${mergeTotals.updated} updated, ${mergeTotals.unchanged} unchanged.${splitSuffix}${logSuffix}`,
        status: "success",
        clientId: client.id,
        clientName: client.name,
      });

      // Fire-and-forget: detect new status codes, attributed to each split
      // group's own channel so Walmart codes attach to Walmart, etc.
      (async () => {
        try {
          const { upsertStatus, normalizeStatusCode } = await import("@/lib/statusData");
          let newCount = 0;
          for (const g of groupList) {
            const seen = new Set<string>();
            for (const row of g.rows) {
              const raw = String(row["Status"] ?? row["PR ST"] ?? "").trim();
              if (raw) seen.add(normalizeStatusCode(raw));
            }
            for (const code of seen) {
              const { isNew } = await upsertStatus({ code, channelId: g.channel.id, autoDetected: true });
              if (isNew) newCount++;
            }
          }
          if (newCount > 0) {
            await addLog({
              userId: session.userId,
              userName: session.name,
              action: "auto_detect_statuses",
              details: `Auto-detected ${newCount} new status code(s) for ${mainChannelName}`,
              status: "success",
            });
          }
        } catch { /* never fail the upload */ }
      })();

      return Response.json(
        {
          success: true,
          id: firstUploadId,
          rowCount: result.totalRows,
          merge: mergeTotals,
          ...(perChannel.length > 1 ? { perChannel } : {}),
          ...(hasWarnings ? {
            warnings: {
              missingArticles: missingArticleDetails,
              missingSites,
              collisions: result.collisions,
            },
          } : {}),
        },
        { headers: noCacheHeaders() },
      );
    }

    if (fileType === "aged_stock") {
      return Response.json({ error: "Aged Stock parsing is not yet implemented" }, { status: 400, headers: noCacheHeaders() });
    }

    return Response.json({ error: "Invalid file type" }, { status: 400, headers: noCacheHeaders() });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Could not find header row")) {
      return Response.json({ error: err.message }, { status: 400, headers: noCacheHeaders() });
    }
    return handleAuthError(err);
  }
}
