import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getIgnored, addIgnored, removeIgnored } from "@/lib/storeReportCodeIgnore";

// Shared "Ignore for now" list for the Site Code Check — parks stores we can't
// map yet (channel not loaded, etc.) so they leave the main grid without being
// deleted. Readable/writable by anyone who can manage store reports.
export const dynamic = "force-dynamic";

function payload(list: Awaited<ReturnType<typeof getIgnored>>) {
  return { ignored: list, codes: list.map((i) => i.code) };
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    return Response.json(payload(await getIgnored()), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c)) : [];
    return Response.json(payload(await addIgnored(codes, session.name || session.email)), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c)) : [];
    return Response.json(payload(await removeIgnored(codes)), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
