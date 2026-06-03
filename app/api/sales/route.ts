import { NextRequest } from "next/server";
import { requireLogin, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta, getAllSalesLedgers } from "@/lib/salesData";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelId = url.searchParams.get("channelId");

    if (!clientId) {
      return Response.json(
        { error: "clientId is required" },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    // If channelId provided, return the merged sales data for that ledger
    if (channelId) {
      const [data, meta] = await Promise.all([
        getSalesLedger(clientId, channelId),
        getSalesLedgerMeta(clientId, channelId),
      ]);
      return Response.json({ data, meta }, { headers: noCacheHeaders() });
    }

    // Otherwise return all ledger metadata for this client (summary)
    const ledgers = await getAllSalesLedgers(clientId);
    return Response.json(ledgers, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
