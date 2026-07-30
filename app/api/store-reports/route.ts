import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getUploadIndex } from "@/lib/uploadData";
import { getActiveClients } from "@/lib/clientData";
import { addLog } from "@/lib/activityLog";
import {
  getStoreReportState,
  toggleExclusion,
  armPeriod,
  disarmPeriod,
  periodKey,
} from "@/lib/storeReportState";
import { buildChecklist } from "@/lib/dispoChecklist";

export const dynamic = "force-dynamic";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (y: number, m: number, w: number) => `Wk${w} ${MON[m] ?? m} ${y}`;

interface Body {
  action?: "exclude" | "arm" | "disarm";
  year?: number;
  month?: number;
  week?: number;
  streamId?: string;
  excluded?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const body = (await req.json()) as Body;
    const { action, year, month, week } = body;

    if (!action || year == null || month == null || week == null) {
      return Response.json({ error: "action, year, month and week are required" }, { status: 400, headers: noCacheHeaders() });
    }

    if (action === "exclude") {
      if (!body.streamId) {
        return Response.json({ error: "streamId is required" }, { status: 400, headers: noCacheHeaders() });
      }
      const state = await toggleExclusion(year, month, week, body.streamId, !!body.excluded);
      addLog({
        userId: session.userId, userName: session.name,
        action: body.excluded ? "store_report_exclude_stream" : "store_report_include_stream",
        details: `${body.excluded ? "Excluded" : "Re-included"} stream ${body.streamId} for ${periodLabel(year, month, week)}`,
        status: "success",
      }).catch(() => {});
      return Response.json({ ok: true, state }, { headers: noCacheHeaders() });
    }

    if (action === "arm") {
      // Gate: a period is only armable when there are no outstanding streams
      // (every stream loaded or explicitly excluded) and at least one loaded.
      const [uploads, clients, state] = await Promise.all([
        getUploadIndex(), getActiveClients(), getStoreReportState(),
      ]);
      const { perPeriod } = buildChecklist(uploads, clients, state);
      const summary = perPeriod[periodKey(year, month, week)];
      if (!summary || !summary.armable) {
        const reason = !summary
          ? "no loads for that week"
          : summary.outstanding > 0
            ? `${summary.outstanding} stream(s) still outstanding — load or exclude them first`
            : "no DISPOs loaded for that week";
        return Response.json({ error: `Cannot arm: ${reason}.` }, { status: 400, headers: noCacheHeaders() });
      }
      const next = await armPeriod(year, month, week, session.userId);
      addLog({
        userId: session.userId, userName: session.name,
        action: "store_report_arm",
        details: `Armed store reports for ${periodLabel(year, month, week)} (${summary.loaded} loaded, ${summary.excluded} excluded)`,
        status: "success",
      }).catch(() => {});
      return Response.json({ ok: true, state: next }, { headers: noCacheHeaders() });
    }

    if (action === "disarm") {
      const next = await disarmPeriod(year, month, week);
      addLog({
        userId: session.userId, userName: session.name,
        action: "store_report_disarm",
        details: `Disarmed store reports for ${periodLabel(year, month, week)}`,
        status: "success",
      }).catch(() => {});
      return Response.json({ ok: true, state: next }, { headers: noCacheHeaders() });
    }

    return Response.json({ error: "Unknown action" }, { status: 400, headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
