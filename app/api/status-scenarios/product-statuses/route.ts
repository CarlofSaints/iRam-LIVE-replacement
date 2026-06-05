import { NextRequest } from "next/server";
import { requireLogin, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getProductMaster } from "@/lib/productMasterData";

/**
 * GET /api/status-scenarios/product-statuses
 * Returns distinct product status values from ALL clients' PMFs.
 */
export async function GET(req: NextRequest) {
  try {
    requireLogin(req);

    const clients = await getClients();
    const statusSet = new Set<string>();

    // Load all clients' product masters in parallel
    const masters = await Promise.all(
      clients.filter((c) => c.active && c.controlFiles?.pmf).map((c) => getProductMaster(c.id))
    );

    for (const products of masters) {
      for (const p of products) {
        const s = (p.status ?? "").trim().toUpperCase();
        if (s) statusSet.add(s);
      }
    }

    const statuses = Array.from(statusSet).sort();
    return Response.json(statuses, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
