import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { computeStorageReport } from "@/lib/storageMeter";

// Listing every blob can take a moment on a large store.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const report = await computeStorageReport();
    return Response.json(report, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
