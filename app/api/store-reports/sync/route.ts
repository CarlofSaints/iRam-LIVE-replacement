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
      // Awaited for the same reason as the settings save below — a manual run
      // that sends real mail should leave a trace that actually gets written.
      await addLog({
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
    /* ⚠️ AWAITED, not fire-and-forget.
       This was `addLog(...).catch(() => {})`, and the entry never appeared: the
       response returns immediately, so the serverless function can be frozen
       before the blob write lands. It cost us the answer to a real question —
       the poller was found disabled on 14 Sep 2026, every rep had been missing
       their store report since the 11th, and there was no record of who turned
       it off or when, because this line had never once written.

       `enabled` here silently stops EVERY store report in the system. The few
       milliseconds this costs are worth less than knowing who changed it. */
    await addLog({
      userId: session.userId, userName: session.name,
      action: "Updated store-report sync settings",
      details:
        `enabled=${saved.enabled}, channels=${saved.channels.length}, throttle=${saved.minIntervalSeconds}s` +
        (body.enabled === false ? " — AUTO-SEND TURNED OFF; no rep will receive a store report until it is turned back on" : "") +
        (body.enabled === true ? " — auto-send turned on" : ""),
      status: "success",
    }).catch(() => {});
    return Response.json({ settings: saved }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
