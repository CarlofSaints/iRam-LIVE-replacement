import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getUploadIndex } from "@/lib/uploadData";
import { getActiveClients } from "@/lib/clientData";
import { getStoreReportState } from "@/lib/storeReportState";
import { buildChecklist } from "@/lib/dispoChecklist";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_uploads");

    const [uploads, clients, state] = await Promise.all([
      getUploadIndex(),
      getActiveClients(),
      getStoreReportState(),
    ]);

    const result = buildChecklist(uploads, clients, state);
    return Response.json(result, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
