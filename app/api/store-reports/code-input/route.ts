import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getCodeInput, setCodeInput } from "@/lib/storeReportCodeInput";

// Shared Site Code Check input list — readable/writable by anyone who can manage
// store reports, so multiple admins work off the same pasted list.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    return Response.json(await getCodeInput(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    const saved = await setCodeInput(String(body.text ?? ""), session.name || session.email);
    return Response.json(saved, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
