import { NextRequest } from "next/server";
import { del } from "@vercel/blob";
import { getUploadIndex, getUploadsByClient, addUpload } from "@/lib/uploadData";
import { getClientById } from "@/lib/clientData";
import { getChannelById, getChannels } from "@/lib/channelData";
import { parseDispo } from "@/lib/dispoParser";
import { mergeDispo, normalizeDateCol, type MergeResult } from "@/lib/salesData";
import { getLinksLookup, normalizeArticle } from "@/lib/linksLookup";
import { getMergedStores } from "@/lib/storeFileData";
import { normalizeSiteKey } from "@/lib/siteCode";
import { getCamById } from "@/lib/camData";
import { getUsers } from "@/lib/userData";
import { sendMissingProductsEmail, sendMissingStoresEmail, sendSupplyRouteEmail } from "@/lib/email";
import { scanSupplyRoutes, issueSheetRows } from "@/lib/supplyRoute";
import { buildPrincipalMap, resolveVendors, principalCoverage } from "@/lib/principalVendor";
import { getProductMaster } from "@/lib/productMasterData";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import { acquireUploadLock, releaseUploadLock, lockMessage, type UploadLock } from "@/lib/uploadLock";
import { PARSER_VERSION } from "@/lib/parserVersion";
import { buildChannelGroup } from "@/lib/channelGroup";
import { judgeChannelFit, wrongChannelMessage } from "@/lib/channelFit";
import type { FileType } from "@/lib/types";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Large DISPOs take real time to parse + merge. Give the function headroom so a
// big file finishes instead of timing out (which the browser sees as a failure).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
  // A large DISPO is uploaded by the browser straight to Blob, then this route
  // is called with JSON { blobUrl, ... }. We fetch + parse it, then delete the
  // temp blob (unless we're mid-confirmation and expect a follow-up force call).
  let tempBlobUrl: string | null = null;
  let keepBlob = false;
  // The WHOLE lock, not just its id — releasing needs our startedAt to tell a
  // real successor from a stale read. See lib/uploadLock.ts.
  let heldLock: UploadLock | null = null;
  try {
    const session = await requirePermission(req, "upload_data");

    const contentType = req.headers.get("content-type") || "";
    let buffer: Buffer;
    let fileName: string;
    let clientId: string | null;
    let channelId: string | null;
    let fileType: FileType | null;
    let reportYear: number | undefined;
    let reportMonth: number | undefined;
    let reportWeek: number | undefined;
    let force: boolean;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      tempBlobUrl = typeof body.blobUrl === "string" ? body.blobUrl : null;
      clientId = body.clientId ?? null;
      channelId = body.channelId ?? null;
      fileType = (body.fileType ?? null) as FileType | null;
      fileName = String(body.fileName || "upload.xlsx");
      reportYear = body.reportYear != null && body.reportYear !== "" ? Number(body.reportYear) : undefined;
      reportMonth = body.reportMonth != null && body.reportMonth !== "" ? Number(body.reportMonth) : undefined;
      reportWeek = body.reportWeek != null && body.reportWeek !== "" ? Number(body.reportWeek) : undefined;
      force = body.force === true || body.force === "true";
      if (!tempBlobUrl) {
        return Response.json({ error: "Missing uploaded file reference" }, { status: 400, headers: noCacheHeaders() });
      }
      const r = await fetch(tempBlobUrl);
      if (!r.ok) {
        return Response.json({ error: "Could not read the uploaded file — please try again" }, { status: 400, headers: noCacheHeaders() });
      }
      buffer = Buffer.from(await r.arrayBuffer());
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      clientId = formData.get("clientId") as string | null;
      channelId = formData.get("channelId") as string | null;
      fileType = formData.get("fileType") as FileType | null;
      reportYear = formData.get("reportYear") ? Number(formData.get("reportYear")) : undefined;
      reportMonth = formData.get("reportMonth") ? Number(formData.get("reportMonth")) : undefined;
      reportWeek = formData.get("reportWeek") ? Number(formData.get("reportWeek")) : undefined;
      force = formData.get("force") === "true";
      if (!file) {
        return Response.json({ error: "File, clientId, channelId, and fileType are required" }, { status: 400, headers: noCacheHeaders() });
      }
      fileName = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    if (!clientId || !channelId || !fileType) {
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

    // ── One upload at a time, app-wide ──
    // Taken BEFORE parsing (the expensive part) and held until this request
    // finishes, including the needsConfirmation round-trip's early return —
    // the lock is released in the finally, so a user reading a warning dialog
    // never blocks the rest of the team. See lib/uploadLock.ts for why.
    const acquired = await acquireUploadLock({
      userId: session.userId,
      userName: session.name,
      clientName: client.name,
      fileName,
    });
    if (!acquired.ok) {
      // Nothing was processed, so keep the browser-uploaded temp blob — the
      // retry reuses it instead of pushing 20MB up the wire a second time.
      keepBlob = true;
      return Response.json(
        { busy: true, error: lockMessage(acquired.heldBy) },
        { status: 409, headers: noCacheHeaders() },
      );
    }
    heldLock = acquired.lock;

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

      // ── Validate the selected period is actually IN the file ──
      // The loader stamps each DISPO with the month it is for (year/month/week),
      // and the load checklist trusts that stamp. But a DISPO only carries the
      // months present as sales columns inside it — if someone stamps "July" on a
      // file whose newest column is June, the checklist shows July loaded while
      // the report has no July data. Hard-block that mismatch here so the stamp
      // can never diverge from the data. (Only when a month is actually chosen.)
      if (reportYear != null && !isNaN(reportYear) && reportMonth != null && !isNaN(reportMonth)) {
        const fileMonths = new Set<string>();
        for (const dc of result.dateColumns) {
          const norm = normalizeDateCol(dc);
          if (norm) fileMonths.add(norm);
        }
        const selected = `${String(reportMonth).padStart(2, "0")}-${reportYear}`;
        if (!fileMonths.has(selected)) {
          const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const label = (mmYYYY: string) => {
            const [mm, yyyy] = mmYYYY.split("-");
            return `${MON[parseInt(mm, 10)] ?? mm} ${yyyy}`;
          };
          const available = [...fileMonths]
            .sort((a, b) => {
              const [am, ay] = a.split("-");
              const [bm, by] = b.split("-");
              return (Number(ay) * 100 + Number(am)) - (Number(by) * 100 + Number(bm));
            })
            .map(label);
          const availMsg = available.length
            ? `This DISPO contains: ${available.join(", ")}.`
            : `This DISPO contains no recognizable monthly sales columns.`;
          return Response.json({
            error: `You selected ${label(selected)}, but that month is not in this DISPO. ${availMsg} Pick the correct month/year (or upload the DISPO that actually contains ${label(selected)}).`,
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
      // Shared with the REPORT side (lib/channelGroup) on purpose: rows split
      // out here are only visible there if both build the same group.
      const acceptChannels = buildChannelGroup(mainChannelId, allChannels);
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

      /* ── Is this file even for the channel that was picked? ──
         BEFORE the site repair below, and that order is the whole point: the
         repair folds "M01" onto "M001", so once it has run a Makro file looks
         like a clean Massbuild one and every later check agrees. Judged on the
         RAW codes, and only ever refuses when another channel claims nearly the
         whole file while this one claims almost none of it — a genuinely
         Excel-mangled file matches nothing anywhere and still loads.
         See lib/channelFit.ts for the incident this exists for. */
      const fit = judgeChannelFit(
        result.rows.map((r) => r["Site"]),
        mainChannelId,
        allChannels,
        mergedStores,
      );
      if (fit.wrongChannel) {
        return Response.json(
          { error: wrongChannelMessage(fit, mainChannelName), channelFit: fit },
          { status: 400, headers: noCacheHeaders() },
        );
      }

      const siteChannel = new Map<string, { id: string; name: string }>();
      // Canonical store code by normalized key, so a DISPO site that Excel
      // mangled into a Rand value ("R001" → "R1" / "R 1.00") can be repaired to
      // the store master's real code before matching. Scoped to this load's
      // channel group, exactly like siteChannel. Keys that map to more than one
      // distinct store code are ambiguous (e.g. a master with both "R1" and
      // "R001") and are skipped so we never repair a site to the wrong store.
      const canonicalSiteByKey = new Map<string, string>();
      const ambiguousSiteKeys = new Set<string>();
      for (const s of mergedStores) {
        const owner = acceptByName.get(s.channel.trim().toUpperCase());
        if (owner && s.siteNum) {
          siteChannel.set(s.siteNum.trim().toLowerCase(), owner);
          const key = normalizeSiteKey(s.siteNum);
          if (key) {
            const existing = canonicalSiteByKey.get(key);
            if (existing === undefined) canonicalSiteByKey.set(key, s.siteNum.trim());
            else if (existing.toLowerCase() !== s.siteNum.trim().toLowerCase()) ambiguousSiteKeys.add(key);
          }
        }
      }
      const knownSites = new Set(siteChannel.keys());

      // Repair Excel-mangled site codes in place against the store master before
      // anything reads Site — so the corrected code flows through missing-site
      // detection, the channel/vendor split, the ledger key (Article|Site) and
      // store enrichment alike, with no change needed in those consumers.
      let sitesRepaired = 0;
      for (const row of result.rows) {
        const current = String(row["Site"] ?? "").trim();
        if (!current) continue;
        const key = normalizeSiteKey(current);
        if (!key || ambiguousSiteKeys.has(key)) continue;
        const canonical = canonicalSiteByKey.get(key);
        if (canonical && canonical.toLowerCase() !== current.toLowerCase()) {
          row["Site"] = canonical;
          sitesRepaired++;
        }
      }

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

        // Keep the temp blob so the follow-up "force" call can re-read it.
        keepBlob = true;

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
      /* Re-decide each row's vendor with the PMF in hand. The parser can only
         guess for a DC line — it inherits the article's vendor from a numeric
         row, else takes the file's dominant vendor, which is a coin toss once
         a file carries more than one vendor. The PMF's Principal says outright
         which vendor owns the SKU, so it wins over both guesses. Rows that
         STILL had to be guessed are counted, so a half-filled PMF can't
         quietly look like it is working. */
      const pmfProducts = await getProductMaster(client.id);
      const principalMap = buildPrincipalMap(pmfProducts, client.vendorNumbers ?? []);
      const coverage = principalCoverage(pmfProducts, client.vendorNumbers ?? []);
      const vendorRes = resolveVendors(
        result.rows, linksLookup, principalMap, result.vendorNumber,
      );

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

      const mergeTotals = { inserted: 0, updated: 0, unchanged: 0, snapshotsApplied: 0, snapshotsSkipped: 0 };
      type PerChannel = { channel: string; vendor: string; rows: number } & MergeResult;
      const perChannel: PerChannel[] = [];

      /* Groups whose SNAPSHOT fields or LEDGER PERIOD this load was not allowed
         to move, because the ledger already holds a newer DISPO. Both are
         correct outcomes for a back-load, and both used to be invisible from
         the UI — a held-back load looked exactly like an accepted one, which is
         how 45 back-loads on 25 Aug 2026 walked 23 ledgers back eight months
         with nobody noticing. */
      const heldBack: { channel: string; vendor: string; ledgerPeriod: string; skipped: number; stampAccepted: boolean }[] = [];
      let firstUploadId = "";
      for (const g of groupList) {
        const upload = await addUpload(
          {
            clientId,
            clientName: client.name,
            channelId: g.channel.id,
            channelName: g.channel.name,
            fileType: "dispo",
            fileName,
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
        mergeTotals.snapshotsApplied += merge.snapshotsApplied;
        mergeTotals.snapshotsSkipped += merge.snapshotsSkipped;
        if (!merge.stampAccepted || merge.snapshotsSkipped > 0) {
          const lp = merge.ledgerPeriod;
          heldBack.push({
            channel: g.channel.name,
            vendor: g.vendor,
            ledgerPeriod: lp.reportYear
              ? `Wk${lp.reportWeek ?? "?"} ${MONTH_ABBR[lp.reportMonth ?? 0] ?? lp.reportMonth} ${lp.reportYear}`
              : "an unstamped load",
            skipped: merge.snapshotsSkipped,
            stampAccepted: merge.stampAccepted,
          });
        }
        perChannel.push({ channel: g.channel.name, vendor: g.vendor, rows: g.rows.length, ...merge });
      }

      const logSuffix = hasWarnings
        ? ` (forced with ${missingArticleDetails.length} missing articles, ${missingSites.length} missing sites)`
        : "";
      const splitSuffix = perChannel.length > 1
        ? ` Split by channel×vendor: ${perChannel.map((p) => `${p.channel}/${p.vendor} ${p.rows}`).join(", ")}.`
        : "";
      /* Say it in the LOG as well as the dialog. The dialog is seen once by
         one person; the log is what anyone reconstructing "why does this
         client report the wrong week" actually reads. */
      const heldBackSuffix = heldBack.length > 0
        ? ` Held back: ${heldBack.map((h) => `${h.channel}/${h.vendor} — ledger already holds ${h.ledgerPeriod}` + (h.skipped > 0 ? `, ${h.skipped} stock snapshot(s) not updated` : "") + (h.stampAccepted ? "" : ", report period unchanged")).join("; ")}.`
        : "";
      const repairSuffix = sitesRepaired > 0
        ? ` Repaired ${sitesRepaired} Excel-mangled site code(s) against the store master.`
        : "";
      const vendorLabel = result.vendorNumbers.length ? result.vendorNumbers.join("/") : result.vendorNumber;

      /* How the quantity columns were read. A DISPO that writes 1,525 as
         "1.525" understates sales a thousandfold, so both the rescale AND the
         "we saw it but could not prove it" case have to be on the record. */
      const thousandsSuffix = result.thousands.notes.length > 0
        ? ` ${result.thousands.notes.join(" ")}`
        : "";

      /* Which read path produced these numbers. On the record because a reload
         that ran minutes before a parser fix went live looks identical to one
         that ran after it — see lib/parserVersion.ts. */
      const parserSuffix = ` Parser v${PARSER_VERSION}.`;

      /* How each row's vendor was decided. "guessed" is the number that
         matters: it is rows the PMF could not answer for, which in a
         multi-vendor file may be attributed to the wrong vendor. */
      const vc = vendorRes.counts;
      const vendorSuffix = ` Vendor from: ${vc.cell} file, ${vc.pmf} PMF principal, ${vc.inherited} same-article, ${vc.fallback + vc.none} guessed.` +
        ` PMF principals: ${coverage.usable} of ${coverage.total} SKU(s) carry a usable vendor number` +
        (coverage.withPrincipal > coverage.usable
          ? ` (${coverage.withPrincipal - coverage.usable} more have a value that is not one of this client's vendor numbers).`
          : ".") +
        (vendorRes.conflicts.length > 0
          ? ` ⚠ ${vendorRes.conflicts.length} SKU(s) where the PMF principal disagrees with the DISPO's vendor.`
          : "");

      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "upload_dispo",
        details: `Uploaded DISPO for ${client.name} / ${mainChannelName} (${result.totalRows} rows, vendor(s) ${vendorLabel}). Ledger merge: ${mergeTotals.inserted} new, ${mergeTotals.updated} updated, ${mergeTotals.unchanged} unchanged.${splitSuffix}${repairSuffix}${thousandsSuffix}${parserSuffix}${vendorSuffix}${heldBackSuffix}${logSuffix}`,
        status: "success",
        clientId: client.id,
        clientName: client.name,
      });

      /* Vendor × Source of Supply check. These lines load normally — the data
         is fine — but the customer's ordering setup means they will never turn
         into an order, so the CAM and the loader get the list to take back to
         the customer. Fire-and-forget: never fail an otherwise good upload. */
      (async () => {
        try {
          const nameBySite = new Map<string, string>();
          for (const s of mergedStores) {
            if (s.siteNum && s.storeName) nameBySite.set(normalizeSiteKey(s.siteNum), s.storeName);
          }
          const scan = scanSupplyRoutes(
            result.rows,
            (site) => nameBySite.get(normalizeSiteKey(site)) ?? "",
          );
          if (scan.mismatches.length === 0) return;

          const recipients = [session.email];
          if (client.camId) {
            const cam = await getCamById(client.camId);
            if (cam?.email && !recipients.includes(cam.email)) recipients.push(cam.email);
          }

          const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const periodLabel = reportYear && reportMonth
            ? `Wk${reportWeek ?? "?"} ${MON[reportMonth] ?? reportMonth} ${reportYear}`
            : "this load";

          await sendSupplyRouteEmail({
            to: recipients,
            clientName: client.name,
            channelName: mainChannelName,
            periodLabel,
            uploaderName: session.name,
            rows: issueSheetRows(scan.mismatches),
            blankCount: scan.blank,
            siteCount: new Set(scan.mismatches.map((m) => m.siteNum)).size,
          });

          await addLog({
            userId: session.userId,
            userName: session.name,
            action: "supply_route_alert",
            details: `${scan.mismatches.length} vendor/source-of-supply mismatch(es) across ${new Set(scan.mismatches.map((m) => m.siteNum)).size} store(s) in ${client.name} / ${mainChannelName}. Emailed ${recipients.join(", ")}.`,
            status: "success",
            clientId: client.id,
            clientName: client.name,
          });
        } catch (e) {
          // A failed alert must never look like a failed load, but it must not
          // vanish either — the activity log is where it surfaces.
          await addLog({
            userId: session.userId,
            userName: session.name,
            action: "supply_route_alert",
            details: `Supply-route check failed for ${client.name}: ${e instanceof Error ? e.message : String(e)}`,
            status: "error",
            clientId: client.id,
            clientName: client.name,
          }).catch(() => {});
        }
      })();

      // Fire-and-forget: verify rep action-claims against this fresh DISPO
      // (e.g. a claimed Phantom write-off should show SOH → 0). Best-effort;
      // never fail the upload. Uses the full parsed file so every site/article
      // in the load is available regardless of channel×vendor split.
      (async () => {
        try {
          const { verifyClaimsAgainstDispo } = await import("@/lib/storeReportVerify");
          const v = await verifyClaimsAgainstDispo({ clientId, rows: result.rows });
          if (v.checked > 0) {
            await addLog({
              userId: session.userId,
              userName: session.name,
              action: "verify_action_claims",
              details: `Verified ${v.checked} rep action-claim(s) for ${client.name} against the new DISPO: ${v.consistent} consistent, ${v.suspect} suspect, ${v.inconclusive} inconclusive.`,
              status: "success",
              clientId: client.id,
              clientName: client.name,
            });
          }
        } catch { /* never fail the upload */ }
      })();

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
          ...(result.thousands.notes.length > 0
            ? { numberFormat: { notes: result.thousands.notes, cellsRescaled: result.thousands.cellsRescaled } }
            : {}),
          ...(perChannel.length > 1 ? { perChannel } : {}),
          ...(heldBack.length > 0 ? { heldBack } : {}),
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
  } finally {
    // Release on EVERY exit — success, validation error, thrown parse error,
    // and the needsConfirmation early return. Anything else strands the whole
    // team behind this request until the lock's TTL expires.
    if (heldLock) await releaseUploadLock(heldLock);

    // Clean up the browser-uploaded temp blob once we're done with it. Skipped
    // when we returned needsConfirmation (the follow-up force call re-reads it).
    if (tempBlobUrl && !keepBlob) {
      try { await del(tempBlobUrl); } catch { /* best-effort cleanup */ }
    }
  }
}
