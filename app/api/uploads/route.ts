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
  /* Who is loading, hoisted out of the try so the catch below can still name
     them. Set immediately after the permission check, which is the one thing
     that can throw BEFORE there is anyone to attribute a failure to. */
  let who: { userId: string; name: string } | null = null;
  /* The attempt's identity, hoisted for the same reason: a thrown error lands
     in the catch, outside the scope of everything that would name it. Both are
     filled in as soon as they are known, so a failure at any depth still says
     WHICH file, client, channel and period it was. */
  let logClient: { id: string; name: string } | null = null;
  let describeAttempt: () => string = () => "an upload";
  try {
    const session = await requirePermission(req, "upload_data");
    who = { userId: session.userId, name: session.name };

    const contentType = req.headers.get("content-type") || "";
    let buffer: Buffer;
    let fileName = "";
    let clientId: string | null;
    let channelId: string | null;
    let fileType: FileType | null;
    let reportYear: number | undefined;
    let reportMonth: number | undefined;
    let reportWeek: number | undefined;
    let force: boolean;

    /* ── Every refusal leaves a record ──────────────────────────────────────
       A refused load used to vanish completely. The upload INDEX holds
       successes only, and none of the early returns below wrote to the
       activity log, so "it wouldn't let me load it" left nothing at all to
       look at: no attempt, no reason, no file name, not even a timestamp. The
       loader's own screen keeps the message, but that screen is seen once by
       one person and is gone by the time anyone is asked about it.

       Every early return goes through refuse() so a new one cannot quietly
       skip the record, and the SENTENCE THE LOADER SAW is what gets logged —
       that is the only thing that reliably matches a support message ("it said
       the month wasn't in the dispo") to an attempt.

       Deliberately NOT written to the upload index: the DISPO checklist reads
       that index, and a refused load must never make a week look loaded. */
    let logChannelName = "";
    const periodLabel = () =>
      reportYear && reportMonth
        ? `Wk${reportWeek ?? "?"} ${MONTH_ABBR[reportMonth] ?? reportMonth} ${reportYear}`
        : "";
    describeAttempt = () =>
      `${fileType === "dispo" ? "DISPO" : fileType === "aged_stock" ? "Aged Stock file" : "file"} ` +
      `"${fileName || "(no file name)"}"` +
      (logClient ? ` for ${logClient.name}` : "") +
      (logChannelName ? ` / ${logChannelName}` : "") +
      (periodLabel() ? ` (${periodLabel()})` : "");

    async function refuse(
      httpStatus: number,
      body: Record<string, unknown> & { error: string },
      reason: string,
    ) {
      await addLog({
        userId: session.userId,
        userName: session.name,
        action: "upload_refused",
        details: `Refused ${describeAttempt()}. ${reason}. The loader was shown: "${body.error}"`,
        status: "error",
        ...(logClient ? { clientId: logClient.id, clientName: logClient.name } : {}),
      });
      return Response.json(body, { status: httpStatus, headers: noCacheHeaders() });
    }

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
        return refuse(400, { error: "Missing uploaded file reference" }, "The browser sent no reference to the uploaded file");
      }
      const r = await fetch(tempBlobUrl);
      if (!r.ok) {
        return refuse(400, { error: "Could not read the uploaded file — please try again" }, `The temporary upload could not be fetched back (HTTP ${r.status})`);
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
        return refuse(400, { error: "File, clientId, channelId, and fileType are required" }, "The form carried no file");
      }
      fileName = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    if (!clientId || !channelId || !fileType) {
      return refuse(
        400,
        { error: "File, clientId, channelId, and fileType are required" },
        `The request was incomplete (missing ${[!clientId && "client", !channelId && "channel", !fileType && "file type"].filter(Boolean).join(", ")})`,
      );
    }

    // A DISPO load must be stamped with the week it is for — the load checklist
    // buckets loads by (year, month, week), so a missing week can't be placed.
    if (fileType === "dispo" && (reportWeek === undefined || isNaN(reportWeek) || reportWeek < 1)) {
      return refuse(400, { error: "A report week is required for DISPO uploads" }, "No report week was chosen");
    }

    const client = await getClientById(clientId);
    if (!client) return refuse(404, { error: "Client not found" }, `Client id ${clientId} does not exist`);
    logClient = { id: client.id, name: client.name };

    const channel = await getChannelById(channelId);
    if (!channel) return refuse(404, { error: "Channel not found" }, `Channel id ${channelId} does not exist`);
    logChannelName = channel.name;

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
      /* Logged like any other refusal even though nobody did anything wrong:
         from the loader's side this is still "it wouldn't let me load it", and
         a run of these is the only visible sign that the team is queueing
         behind one another. */
      return refuse(
        409,
        { busy: true, error: lockMessage(acquired.heldBy) },
        `Another upload held the app-wide lock (${acquired.heldBy?.userName ?? "unknown user"}, ${acquired.heldBy?.fileName ?? "unknown file"})`,
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
          return refuse(
            400,
            {
              error: `Vendor number(s) ${bad.join(", ")} from file do not match client's vendor numbers (${client.vendorNumbers.join(", ")})`,
            },
            `File carries vendor(s) ${bad.join(", ")}, which are not on this client`,
          );
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
          /* The reason names the file's OWN months, because the usual cause is
             not a mis-picked month but a column header the parser could not
             read as a date — and then the months it DID find is the only clue
             that says so. */
          return refuse(
            400,
            {
              error: `You selected ${label(selected)}, but that month is not in this DISPO. ${availMsg} Pick the correct month/year (or upload the DISPO that actually contains ${label(selected)}).`,
            },
            `Selected ${label(selected)} is not among the months the parser read from the file` +
              (available.length ? ` (it found ${available.join(", ")})` : " (it found none at all)"),
          );
        }
      }

      // Resolve main channel (channelId should already be a main channel)
      const mainChannelId = channel.parentId ?? channel.id;
      const allChannels = await getChannels();
      const channelById = new Map(allChannels.map((c) => [c.id, c]));
      const mainRecord = channelById.get(mainChannelId) ?? channel;
      const mainChannelName = mainRecord.name;
      // Refusals from here on name the MAIN channel, which is the one the
      // loader picked and the one every message below talks about.
      logChannelName = mainChannelName;

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
        /* The scores go in the log, not just the response. This guard refuses
           a load nobody expected to be refused, so the first question is
           always "was it right?" — and that is answerable only from the
           numbers it judged on. See lib/channelFit.ts. */
        return refuse(
          400,
          { error: wrongChannelMessage(fit, mainChannelName), channelFit: fit },
          `Channel-fit check refused the file: of ${fit.siteCount} distinct site code(s), ` +
            `${fit.selected.exact} match ${fit.selected.label}` +
            (fit.rival ? ` and ${fit.rival.exact} match ${fit.rival.label}` : ""),
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

        /* The dialog is a decision put to a person, not an outcome — they can
           force it through or leave to fix the files. Walking away wrote
           nothing down, so an abandoned load looked exactly like a load nobody
           ever attempted. Logged as a warning, never a success: if they DO
           continue, the forced load logs its own "forced with …" line, and the
           two entries together are the whole story. */
        await addLog({
          userId: session.userId,
          userName: session.name,
          action: "upload_warned",
          details:
            `Held ${describeAttempt()} at the confirmation dialog: ${parts.join(" and ")}. ` +
            `Nothing was loaded — the loader either continues anyway or cancels to fix the files.`,
          status: "warning",
          clientId: client.id,
          clientName: client.name,
        });

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
      return refuse(400, { error: "Aged Stock parsing is not yet implemented" }, "Aged Stock loading is not built yet");
    }

    return refuse(400, { error: "Invalid file type" }, `File type "${fileType}" is not one this route can load`);
  } catch (err) {
    /* A THROWN failure is the worst case for diagnosis, and it was the one
       case with no record at all. Only "Could not find header row" reaches the
       loader intact; everything else — a corrupt workbook, an out-of-memory
       parse, a blob read that failed — is flattened to "Internal server error"
       by handleAuthError, with the real cause left in the Vercel logs where it
       ages out and nobody looks. Write it down here, the one place every
       unexpected failure passes through.

       Guarded on `who`: requirePermission throws before there is anyone to
       attribute this to, and an auth refusal is not an upload failure. Its own
       .catch keeps a logging problem from replacing the real error. */
    if (who) {
      const cause = err instanceof Error ? err.message : String(err);
      await addLog({
        userId: who.userId,
        userName: who.name,
        action: "upload_failed",
        details: `Loading ${describeAttempt()} failed with an error: ${cause}`,
        status: "error",
        ...(logClient ? { clientId: logClient.id, clientName: logClient.name } : {}),
      }).catch(() => {});
    }
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
