import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { auditDescriptions } from "@/lib/descAudit";

// Reads every client's sales ledger — can take a moment on a large store.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const report = await auditDescriptions();
    return Response.json(report, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
