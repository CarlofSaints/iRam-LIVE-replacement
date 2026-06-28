import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getCodeMap, setMapping, removeMapping } from "@/lib/storeReportCodeMap";
import { addLog } from "@/lib/activityLog";

// DISPO ↔ Perigee site-code mappings. manage_store_reports.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    return Response.json({ mappings: await getCodeMap() }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const { perigeeCode, dispoCode } = (await req.json().catch(() => ({}))) as { perigeeCode?: string; dispoCode?: string };
    if (!perigeeCode?.trim() || !dispoCode?.trim()) {
      return Response.json({ error: "perigeeCode and dispoCode are required" }, { status: 400, headers: noCacheHeaders() });
    }
    const mappings = await setMapping(perigeeCode, dispoCode, session.name);
    addLog({
      userId: session.userId, userName: session.name,
      action: "Linked store code", details: `Perigee ${perigeeCode.trim()} → DISPO ${dispoCode.trim()}`, status: "success",
    }).catch(() => {});
    return Response.json({ mappings }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const { perigeeCode } = (await req.json().catch(() => ({}))) as { perigeeCode?: string };
    if (!perigeeCode?.trim()) {
      return Response.json({ error: "perigeeCode is required" }, { status: 400, headers: noCacheHeaders() });
    }
    const mappings = await removeMapping(perigeeCode);
    addLog({
      userId: session.userId, userName: session.name,
      action: "Unlinked store code", details: `Removed mapping for Perigee ${perigeeCode.trim()}`, status: "success",
    }).catch(() => {});
    return Response.json({ mappings }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
