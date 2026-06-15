import { NextRequest } from "next/server";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";

export const maxDuration = 60;

// Returns the distinct sub-channels and categories present in the selected
// client/channels' ledgers — used to populate the Month-End report filters.
// Values match the fields the report groups by (_storeSubChannel, _category).
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "export_data");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelIdsParam = url.searchParams.get("channelIds");

    if (!clientId || !channelIdsParam) {
      return Response.json({ subChannels: [], categories: [] });
    }

    const channelIds = channelIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const ledgers = await Promise.all(channelIds.map((id) => getSalesLedger(clientId, id)));
    const allRows = ledgers.flat();

    if (allRows.length === 0) {
      return Response.json({ subChannels: [], categories: [] });
    }

    const enriched = await enrichLedger(allRows, clientId);
    const subs = new Set<string>();
    const cats = new Set<string>();
    for (const row of enriched.rows) {
      const sub = String(row["_storeSubChannel"] || row["_storeChannel"] || "").trim();
      const cat = String(row["_category"] || "").trim();
      if (sub) subs.add(sub);
      if (cat) cats.add(cat);
    }

    return Response.json(
      { subChannels: Array.from(subs).sort(), categories: Array.from(cats).sort() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
