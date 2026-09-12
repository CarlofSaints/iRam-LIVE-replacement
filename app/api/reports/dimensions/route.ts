import { NextRequest } from "next/server";
import { requirePermission, handleAuthError } from "@/lib/auth";
import { getSalesLedger } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getClientById } from "@/lib/clientData";
import { buildVendorOptions } from "@/lib/vendorScope";

export const maxDuration = 60;

// Returns the distinct sub-channels, categories and VENDORS present in the
// selected client/channels' ledgers — used to populate the Month-End and
// Vital Signs report filters. Values match the fields the report groups by
// (_storeSubChannel, _category, _vendor).
//
// The vendor list is built from the ROWS of the selected channels, not from
// the client's declared vendorNumbers: a number is only meaningful within its
// own channel (VERIGREEN is 9677 on MAKRO and 1544 on MASSBUILD), so a
// declared-list picker would offer options that return an empty report.
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "export_data");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelIdsParam = url.searchParams.get("channelIds");

    if (!clientId || !channelIdsParam) {
      return Response.json({ subChannels: [], categories: [], vendors: [], rowsWithoutVendor: 0 });
    }

    const channelIds = channelIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const ledgers = await Promise.all(channelIds.map((id) => getSalesLedger(clientId, id)));
    const allRows = ledgers.flat();

    if (allRows.length === 0) {
      return Response.json({ subChannels: [], categories: [], vendors: [], rowsWithoutVendor: 0 });
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

    // Vendors present in these rows, named where a row can name them safely.
    // Declared order first so the picker does not reshuffle between runs.
    const client = await getClientById(clientId);
    const vendorScope = buildVendorOptions(enriched.rows, client?.vendorNumbers);

    return Response.json(
      {
        subChannels: Array.from(subs).sort(),
        categories: Array.from(cats).sort(),
        vendors: vendorScope.vendors,
        rowsWithoutVendor: vendorScope.rowsWithoutVendor,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
