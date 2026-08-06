import { NextRequest } from "next/server";
import { previewPurge } from "@/lib/clientPurge";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";

// What a DELETE of this client would destroy. Read-only — deletes nothing.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Part of the delete flow — it enumerates exactly what deletion would
    // destroy, so it belongs with the delete permission, not with add/edit.
    await requirePermission(req, "delete_clients");
    const { id } = await params;
    const preview = await previewPurge(id);
    return Response.json(preview, { headers: noCacheHeaders() });
  } catch (err) {
    if (err instanceof Error && err.message === "Client not found") {
      return Response.json({ error: "Client not found" }, { status: 404, headers: noCacheHeaders() });
    }
    return handleAuthError(err);
  }
}
