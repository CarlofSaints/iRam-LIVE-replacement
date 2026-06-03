import { NextRequest } from "next/server";
import { getLogs } from "@/lib/activityLog";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_activity_log");
    return Response.json(await getLogs(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
