import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { listStoresForClients } from "@/lib/storeReportLoad";

// Picker data for the store-report test tool: the client list + the stores that
// have DISPO data (optionally scoped to one client via ?clientId=).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const clientId = new URL(req.url).searchParams.get("clientId") || undefined;

    const [clients, stores] = await Promise.all([
      getClients(),
      listStoresForClients(clientId ? [clientId] : undefined),
    ]);

    return Response.json(
      {
        clients: clients.map((c) => ({
          id: c.id,
          name: c.name,
          flagged: !!c.sendConsolidatedStoreReports,
        })),
        stores,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
