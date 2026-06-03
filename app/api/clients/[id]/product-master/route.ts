import { NextRequest } from "next/server";
import { requireLogin, requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { getProductMaster, buildProductMaster } from "@/lib/productMasterData";
import { addLog } from "@/lib/activityLog";

/**
 * GET — returns the structured product master array for this client.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireLogin(req);
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const master = await getProductMaster(id);
    return Response.json(
      { products: master, count: master.length },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

/**
 * POST — force rebuild the product master from raw PMF + mapping.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const result = await buildProductMaster(id);

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "rebuild_product_master",
      details: `Rebuilt product master for ${client.name} — ${result.count} products`,
      status: "success",
    });

    return Response.json(
      { success: true, count: result.count },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
