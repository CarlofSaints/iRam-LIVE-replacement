import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { auditParserVersions } from "@/lib/parserVersionAudit";

// Reads every client's sales ledger — can take a moment on a large store.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const report = await auditParserVersions();
    return Response.json(report, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
