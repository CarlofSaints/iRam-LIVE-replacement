import { NextRequest } from "next/server";
import { getTrackingDay } from "@/lib/storeReportTracking";
import { upsertClaim, type ClaimInput } from "@/lib/storeReportClaims";

// PUBLIC claim endpoint — hit by the hosted /r page when a rep ticks / un-ticks a
// SKU (no auth; the page is public). The rep / store / period come from the send's
// TrackRecord (looked up by token) so they can't be spoofed; only the SKU detail
// is taken from the posted body. Beacon body (JSON):
//   { t, d, on, line: { clientId, clientName, article, barcode, description,
//                       categories[], soh, dros, daysCover, prst, statusClass,
//                       marginRiskRand, marginOppRand } }
export const dynamic = "force-dynamic";

function num(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

export async function POST(req: NextRequest) {
  // Best-effort; never surface an error to the public page.
  try {
    const body = await req.json().catch(() => null);
    if (!body) return new Response(null, { status: 204 });

    const token = String(body.t || "").trim();
    const day = String(body.d || "").trim();
    const on = !!body.on;
    const line = body.line || {};
    const article = String(line.article || "").trim();
    const clientId = String(line.clientId || "").trim();
    if (!token || !day || !article || !clientId) return new Response(null, { status: 204 });

    // Resolve the trusted send context from the tracking record.
    const records = await getTrackingDay(day);
    const track = records.find((r) => r.token === token);
    if (!track) return new Response(null, { status: 204 }); // unknown token — ignore

    const categories: string[] = Array.isArray(line.categories)
      ? line.categories.map((c: unknown) => String(c)).filter(Boolean)
      : [];

    const input: ClaimInput = {
      token,
      sendDay: day,
      repEmail: track.repEmail,
      repName: track.repName,
      siteCode: track.siteCode,
      storeName: track.store,
      channel: track.channel,
      year: track.year,
      month: track.month,
      week: track.week,
      test: track.test,
      clientId,
      clientName: String(line.clientName || ""),
      article,
      barcode: line.barcode ? String(line.barcode) : undefined,
      description: String(line.description || ""),
      categories,
      soh: num(line.soh) ?? 0,
      dros: num(line.dros),
      daysCover: line.daysCover === null ? null : num(line.daysCover),
      prst: line.prst ? String(line.prst) : undefined,
      statusClass: line.statusClass ? String(line.statusClass) : undefined,
      marginRiskRand: line.marginRiskRand === null ? null : num(line.marginRiskRand),
      marginOppRand: line.marginOppRand === null ? null : num(line.marginOppRand),
    };

    await upsertClaim(input, on);
  } catch (err) {
    console.error("store-report claim failed", err);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
