import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { loadStoreReport, formatGeneratedAt } from "@/lib/storeReportLoad";
import { renderStoreReportEmail } from "@/lib/storeReportEmail";
import { sendStoreReportEmail } from "@/lib/email";
import { addLog } from "@/lib/activityLog";

// Sends a one-off store-report email to the logged-in user (Outlook rendering
// test). Real data, no SQL proxy needed — reads DISPO data from Blob + Resend.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const body = (await req.json().catch(() => ({}))) as {
      siteCode?: string;
      clientId?: string;
      year?: number;
      month?: number;
      week?: number;
    };

    const siteCode = (body.siteCode || "").trim();
    if (!siteCode) {
      return Response.json({ error: "siteCode is required" }, { status: 400, headers: noCacheHeaders() });
    }

    const loaded = await loadStoreReport({
      siteCode,
      clientIds: body.clientId ? [body.clientId] : undefined,
      year: body.year,
      month: body.month,
      week: body.week,
    });

    if (loaded.report.clients.length === 0) {
      return Response.json(
        { error: `No DISPO data found for site "${siteCode}". Check the site code (and that the client has data loaded).` },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    const params = new URLSearchParams({
      site: siteCode,
      year: String(loaded.year),
      month: String(loaded.month),
      week: String(loaded.week),
    });
    if (body.clientId) params.set("clientId", body.clientId);
    const reportUrl = `${req.nextUrl.origin}/r?${params.toString()}`;

    const html = renderStoreReportEmail(loaded.report, {
      repName: session.name || "there",
      periodLabel: loaded.periodLabel,
      reportUrl,
      generatedAt: formatGeneratedAt(),
      version: "iRam LIVE",
    });

    const store = loaded.report.storeName || siteCode;
    await sendStoreReportEmail({
      to: session.email,
      subject: `[TEST] Store Report — ${store} — ${loaded.periodLabel}`,
      html,
    });

    addLog({
      userId: session.userId,
      userName: session.name,
      action: "Sent test store report",
      details: `Store: ${store} (${siteCode}), ${loaded.report.totalActions} actions, to ${session.email}`,
      status: "success",
    }).catch(() => {});

    return Response.json(
      {
        ok: true,
        to: session.email,
        store,
        clients: loaded.report.clients.map((c) => c.clientName),
        counts: loaded.report.counts,
        totalActions: loaded.report.totalActions,
        totalProducts: loaded.report.totalProducts,
        reportUrl,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
