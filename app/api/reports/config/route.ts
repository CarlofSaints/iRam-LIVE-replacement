import { NextRequest } from "next/server";
import { requireLogin, requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getReportConfig, saveReportConfig } from "@/lib/reportConfig";

export async function GET(req: NextRequest) {
  try {
    requireLogin(req);
    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId) {
      return Response.json({ error: "clientId required" }, { status: 400 });
    }
    const config = await getReportConfig(clientId);
    return Response.json(config, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requirePermission(req, "manage_clients");
    const body = await req.json();
    const { clientId, config } = body;
    if (!clientId || !config) {
      return Response.json(
        { error: "clientId and config required" },
        { status: 400 }
      );
    }
    await saveReportConfig(clientId, config);
    return Response.json({ ok: true }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
