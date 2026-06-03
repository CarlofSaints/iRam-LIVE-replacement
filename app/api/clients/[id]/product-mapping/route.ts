import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { getRawPmfData } from "@/lib/controlFileData";
import {
  getProductMapping,
  saveProductMapping,
  buildProductMaster,
  autoMatchHeaders,
} from "@/lib/productMasterData";
import { addLog } from "@/lib/activityLog";
import type { ProductFieldMapping } from "@/lib/types";

/**
 * GET — returns current mapping + detected PMF headers + auto-match suggestions.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const [mapping, rawRows] = await Promise.all([
      getProductMapping(id),
      getRawPmfData(id),
    ]);

    const headers =
      rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
    const autoMatched = headers.length > 0 ? autoMatchHeaders(headers) : {};

    return Response.json(
      { mapping, headers, autoMatched },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

/**
 * PUT — saves mapping, then auto-runs buildProductMaster(), returns master count.
 */
export async function PUT(
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

    const body = (await req.json()) as { mapping: ProductFieldMapping };

    if (!body.mapping || !body.mapping.clientProductId) {
      return Response.json(
        { error: "Client Product ID field mapping is required" },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    await saveProductMapping(id, body.mapping);
    const result = await buildProductMaster(id);

    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "save_product_mapping",
      details: `Saved product mapping for ${client.name} — ${result.count} products built`,
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
