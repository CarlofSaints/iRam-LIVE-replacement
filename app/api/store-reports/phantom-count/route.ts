import { NextRequest } from "next/server";
import { resolvePublicContext } from "@/lib/storeReportPublicAuth";
import { savePhantomCounts } from "@/lib/phantomCounts";

/* PUBLIC endpoint — the hosted /r page posts here when a rep types into a
   "Stock Found" box on a Phantom line. No auth: the page is public, and the
   store/period it may write to is fixed by the SIGNED report link (see
   lib/storeReportPublicAuth.ts), so a caller can't write counts against a store
   they weren't sent.

   The page posts the FULL set of counts it is holding, not a delta, and each
   entry carries the timestamp it was typed. That means a dropped or reordered
   beacon can't lose a count, and the server merges per line by timestamp so two
   reps counting the same store keep each other's work.

   Body: { r, t?, d?, counts: [ { clientId, clientName, vendor, article,
                                  description, found: number|null, at } ] }     */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

    const resolved = await resolvePublicContext(body);
    if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status });
    const ctx = resolved.ctx;

    if (ctx.year == null || ctx.month == null || ctx.week == null) {
      return Response.json({ error: "This report link has no period — reopen the report from your email." }, { status: 400 });
    }

    const raw = Array.isArray(body.counts) ? body.counts : [];
    const now = new Date().toISOString();
    const incoming = raw
      .map((e: Record<string, unknown>) => {
        const article = String(e.article ?? "").trim();
        const clientId = String(e.clientId ?? "").trim();
        if (!article || !clientId) return null;
        // `found` is a genuine decimal (metres of rope, kg, part-packs). Only a
        // real, finite, non-negative number counts; null is an explicit clear.
        let found: number | null = null;
        if (e.found !== null && e.found !== undefined && e.found !== "") {
          const n = Number(e.found);
          if (!isFinite(n) || n < 0) return null;
          found = n;
        }
        const at = String(e.at ?? "").trim() || now;
        return {
          clientId,
          clientName: String(e.clientName ?? ""),
          vendor: String(e.vendor ?? ""),
          article,
          description: String(e.description ?? ""),
          found,
          at,
          repEmail: ctx.repEmail || undefined,
          repName: ctx.repName || undefined,
        };
      })
      .filter(Boolean) as Array<Parameters<typeof savePhantomCounts>[1][number]>;

    if (!incoming.length) return Response.json({ saved: 0 }, { headers: { "Cache-Control": "no-store" } });

    const file = await savePhantomCounts(
      { siteCode: ctx.site, storeName: ctx.track?.store, year: ctx.year, month: ctx.month, week: ctx.week },
      incoming,
    );

    return Response.json(
      { saved: incoming.length, held: Object.keys(file.lines).length, updatedAt: file.updatedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // The rep needs to know a count did NOT save — never swallow this into a 204.
    console.error("phantom count save failed", err);
    return Response.json({ error: "Could not save your counts. Please try again." }, { status: 500 });
  }
}
