import { NextRequest } from "next/server";
import { getUploadIndex, getUploadsByClient, addUpload } from "@/lib/uploadData";
import { getClientById } from "@/lib/clientData";
import { getChannelById } from "@/lib/channelData";
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

      // Validate vendor number (always hard-block — wrong vendor is never OK)
      if (result.vendorNumber && client.vendorNumbers.length > 0) {
        if (!client.vendorNumbers.includes(result.vendorNumber)) {
          return Response.json({
            error: `Vendor number ${result.vendorNumber} from file does not match client's vendor numbers (${client.vendorNumbers.join(", ")})`,
          }, { status: 400, headers: noCacheHeaders() });
        }
      }

      // Resolve main channel (channelId should already be a main channel)
      const mainChannelId = channel.parentId ?? channel.id;
      const mainChannelName = channel.parentId
        ? (await getChannelById(channel.parentId))?.name ?? channel.name
        : channel.name;

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
              });
            }
          }
        }
      }

      // ── Validate sites against store master ──
      const mergedStores = await getMergedStores();
      const channelStores = mergedStores.filter(
        (s) => s.channel.trim().toUpperCase() === mainChannelName.toUpperCase()
      );
      const knownSites = new Set(
        channelStores.map((s) => s.siteNum.trim().toLowerCase())
      );

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

      const hasWarnings = missingArticleDetails.length > 0 || missingSites.length > 0;

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
          emailPromises.push(
            sendMissingProductsEmail({
              to: recipients,
              clientName: client.name,
              channelName: mainChannelName,
              missingArticles: missingArticleDetails.map((d) => d.article),
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

        return Response.json(
          {
            needsConfirmation: true,
            warning: `${parts.join(" and ")} found. You can continue anyway or fix the files first.`,
            missingArticles: missingArticleDetails,
            missingSites,
          },
          { status: 200, headers: noCacheHeaders() },
        );
      }

      // ── Proceed with upload (main channel only) ──
      const upload = await addUpload(
        {
          clientId,
          clientName: client.name,
          channelId: mainChannelId,
          channelName: mainChannelName,
          fileType: "dispo",
          fileName: file.name,
          uploadDate: new Date().toISOString(),
          uploadedBy: session.userId,
          uploadedByName: session.name,
          vendorNumber: result.vendorNumber,
          period: result.dateColumns.join(", "),
          rowCount: result.totalRows,
          dateColumns: result.dateColumns,
          reportYear,
          reportMonth,
          reportWeek,
          status: "processed",
        },
        result.rows
      );

      // Merge into sales ledger using main channel ID
      const merge = await mergeDispo({
        clientId,
        clientName: client.name,
        channelId: mainChannelId,
        channelName: mainChannelName,
        vendorNumber: result.vendorNumber,
        rows: result.rows,
        dateColumns: result.dateColumns,
        uploadId: upload.id,
        reportYear,
        reportMonth,
        reportWeek,
      });

      const logSuffix = hasWarnings
        ? ` (forced with ${missingArticleDetails.length} missing articles, ${missingSites.length} missing sites)`
        : "";

      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "upload_dispo",
        details: `Uploaded DISPO for ${client.name} / ${mainChannelName} (${result.totalRows} rows, vendor ${result.vendorNumber}). Ledger merge: ${merge.inserted} new, ${merge.updated} updated, ${merge.unchanged} unchanged.${logSuffix}`,
        status: "success",
        clientId: client.id,
        clientName: client.name,
      });

      // Fire-and-forget: detect new status codes
      (async () => {
        try {
          const { upsertStatus, normalizeStatusCode } = await import("@/lib/statusData");
          const seen = new Set<string>();
          for (const row of result.rows) {
            const raw = String(row["Status"] ?? row["PR ST"] ?? "").trim();
            if (raw) seen.add(normalizeStatusCode(raw));
          }
          let newCount = 0;
          for (const code of seen) {
            const { isNew } = await upsertStatus({ code, channelId: mainChannelId, autoDetected: true });
            if (isNew) newCount++;
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
          id: upload.id,
          rowCount: result.totalRows,
          merge,
          ...(hasWarnings ? {
            warnings: {
              missingArticles: missingArticleDetails,
              missingSites,
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
