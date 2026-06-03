import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { getControlFileData } from "@/lib/controlFileData";

/**
 * GET — returns array of column names found in the stored raw PMF data.
 * Used by the mapping UI to populate dropdown options.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requirePermission(req, "manage_control_files");
    const { id } = await params;

    const client = await getClientById(id);
    if (!client) {
      return Response.json(
        { error: "Client not found" },
        { status: 404, headers: noCacheHeaders() }
      );
    }

    const rawRows = await getControlFileData<Record<string, unknown>>(
      id,
      "pmf"
    );
    const headers =
      rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

    return Response.json({ headers }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
