import { NextRequest } from "next/server";
import { resolvePublicContext } from "@/lib/storeReportPublicAuth";
import { loadStoreReport, formatGeneratedAt } from "@/lib/storeReportLoad";
import { getPhantomCounts, phantomLineKey } from "@/lib/phantomCounts";
import { buildPhantomCountWorkbook, phantomSheetFileName, type CountMode } from "@/lib/phantomCountSheet";
import { getClients } from "@/lib/clientData";
import { getCamById } from "@/lib/camData";
import { sendPhantomCountEmail } from "@/lib/email";
import { parseEmailList, isEmail } from "@/lib/emailList";

/* PUBLIC endpoint — "Download" / "Email" on the Phantom list of the hosted /r page.

   The workbook is built from a SERVER-SIDE rebuild of the report (the same
   loadStoreReport the page itself is rendered from), not from lines posted by
   the browser. So what gets emailed is authoritative iRam data; the body can
   only choose the vendor, the mode and where an email goes.

   Body: { r, t?, d?, vendor: "all"|<vendor no>, mode: "empty"|"counts",
           oneSheet: boolean, action: "download"|"email", to?: string }        */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// This endpoint is PUBLIC (the /r page has no login), so the typed recipient
// list must be capped — uncapped, it is a usable way to send mail to anyone
// from our domain. Ten covers a store team.
const MAX_TYPED_RECIPIENTS = 10;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

    const resolved = await resolvePublicContext(body);
    if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status });
    const ctx = resolved.ctx;

    const action = body.action === "email" ? "email" : "download";
    const mode: CountMode = body.mode === "counts" ? "counts" : "empty";
    const oneSheet = body.oneSheet !== false;          // default: everything on one sheet
    const vendorSel = String(body.vendor ?? "all").trim();
    const allVendors = !vendorSel || vendorSel.toLowerCase() === "all";

    // Rebuild the report server-side — same call the /r page is rendered from.
    const loaded = await loadStoreReport({
      siteCode: ctx.site,
      clientIds: ctx.clientId ? [ctx.clientId] : undefined,
      year: ctx.year,
      month: ctx.month,
      week: ctx.week,
    });

    let lines = loaded.report.lines.filter((l) => l.flags.phantom);
    if (!allVendors) lines = lines.filter((l) => l.vendor === vendorSel);

    // Counts are read from OUR store, never from the request — the sheet has to
    // show what was actually captured, not what a caller says was captured.
    let counts: Record<string, number> = {};
    if (mode === "counts") {
      const file = await getPhantomCounts({
        siteCode: ctx.site,
        year: loaded.year, month: loaded.month, week: loaded.week,
      });
      for (const [key, c] of Object.entries(file.lines)) counts[key] = c.found;
      // Keep only counts for lines actually in this sheet.
      const wanted = new Set(lines.map((l) => phantomLineKey(l.clientId, l.article)));
      counts = Object.fromEntries(Object.entries(counts).filter(([k]) => wanted.has(k)));
    }

    const meta = {
      storeName: loaded.report.storeName,
      siteCode: loaded.report.siteCode,
      subChannel: loaded.report.subChannel,
      province: loaded.report.province,
      periodLabel: loaded.periodLabel,
      generatedAt: formatGeneratedAt(),
      vendorLabel: allVendors ? "ALL" : vendorSel,
      repName: ctx.repName || undefined,
      mode,
    };

    const buffer = await buildPhantomCountWorkbook(lines, meta, { oneSheet, counts });
    const filename = phantomSheetFileName(meta);

    if (action === "download") {
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // ── Email ───────────────────────────────────────────────────
    // Recipients: the store address the rep typed, the rep themselves, and the
    // CAM of every client on the sheet.
    const typed = String(body.to ?? "").trim();
    let typedList: string[] = [];
    if (typed) {
      const parsed = parseEmailList(typed, MAX_TYPED_RECIPIENTS);
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
      typedList = parsed.list;
    }

    const recipients = new Set<string>();
    for (const addr of typedList) recipients.add(addr.toLowerCase());
    if (ctx.repEmail && isEmail(ctx.repEmail)) recipients.add(ctx.repEmail.toLowerCase());

    const camNames: string[] = [];
    try {
      const clientIds = new Set(lines.map((l) => l.clientId));
      const clients = (await getClients()).filter((c) => clientIds.has(c.id));
      const camIds = [...new Set(clients.map((c) => c.camId).filter(Boolean) as string[])];
      for (const camId of camIds) {
        const cam = await getCamById(camId);
        if (cam?.active && cam.email && isEmail(cam.email)) {
          recipients.add(cam.email.toLowerCase());
          camNames.push([cam.name, cam.surname].filter(Boolean).join(" "));
        }
      }
    } catch (err) {
      // A CAM lookup failure must not stop the rep's own copy going out.
      console.error("phantom export: CAM lookup failed", err);
    }

    if (recipients.size === 0) {
      return Response.json(
        { error: "There's nobody to send to — enter a store email address to send this to." },
        { status: 400 },
      );
    }

    await sendPhantomCountEmail({
      to: [...recipients],
      storeName: loaded.report.storeName || loaded.report.siteCode,
      siteCode: loaded.report.siteCode,
      periodLabel: loaded.periodLabel,
      vendorLabel: meta.vendorLabel,
      repName: ctx.repName,
      lineCount: lines.length,
      countedCount: Object.keys(counts).length,
      mode,
      filename,
      content: buffer,
    });

    return Response.json(
      { sent: true, to: [...recipients], cams: camNames, lines: lines.length, filename },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("phantom export failed", err);
    const detail = err instanceof Error ? err.message : "";
    return Response.json(
      { error: detail ? `Could not build the sheet: ${detail}` : "Could not build the sheet. Please try again." },
      { status: 500 },
    );
  }
}
