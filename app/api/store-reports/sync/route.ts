import { NextRequest } from "next/server";
import { requirePermission, requireRole, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getSyncSettings, saveSyncSettings, DEFAULT_CHANNELS } from "@/lib/storeReportSync";
import { runStoreReportSync } from "@/lib/storeReportRunner";
import { isProxyConfigured } from "@/lib/sqlProxy";
import { addLog } from "@/lib/activityLog";

// Sync Settings + manual "Run now" / dry-run. Super-admin only for changes;
// reading is allowed to anyone who can manage store reports.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const settings = await getSyncSettings();
    return Response.json(
      { settings, defaultChannels: DEFAULT_CHANNELS, proxyConfigured: isProxyConfigured() },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireRole(req, "super_admin");
    const body = (await req.json().catch(() => ({}))) as {
      action?: "save" | "run" | "dryrun";
      enabled?: boolean;
      channels?: string[];
      minIntervalSeconds?: number;
    };

    if (body.action === "run" || body.action === "dryrun") {
      const dryRun = body.action === "dryrun";
      const result = await runStoreReportSync({ force: true, dryRun, origin: req.nextUrl.origin });
      addLog({
        userId: session.userId, userName: session.name,
        action: dryRun ? "Store-report sync dry run" : "Store-report sync run now",
        details: `armed=${result.armedPeriod ?? "none"} visits=${result.visitsSeen} sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`,
        status: result.ok ? "success" : "error",
      }).catch(() => {});
      return Response.json(result, { headers: noCacheHeaders() });
    }

    // Default = save settings
    const saved = await saveSyncSettings({
      enabled: body.enabled,
      channels: body.channels,
      minIntervalSeconds: body.minIntervalSeconds,
    });
    addLog({
      userId: session.userId, userName: session.name,
      action: "Updated store-report sync settings",
      details: `enabled=${saved.enabled}, channels=${saved.channels.length}, throttle=${saved.minIntervalSeconds}s`,
      status: "success",
    }).catch(() => {});
    return Response.json({ settings: saved }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
