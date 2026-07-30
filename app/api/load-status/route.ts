import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { runLoadStatus } from "@/lib/loadStatus";
import { renderLoadStatusEmail } from "@/lib/loadStatusEmail";
import { addLog } from "@/lib/activityLog";

// GET  — compute the status without sending anything. `?preview=html` returns the
//        rendered email body so the checklist page can show exactly what goes out.
// POST — send it now. Optional { to: ["a@b.co"] } overrides the recipient list
//        (test send) instead of using every user flagged receiveLoadStatus.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "view_uploads");
    const status = await runLoadStatus({ send: false });
    if (new URL(req.url).searchParams.get("preview") === "html") {
      const { subject, html } = renderLoadStatusEmail({ name: session.name, status });
      return Response.json({ ...status, subject, html }, { headers: noCacheHeaders() });
    }
    return Response.json(status, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const body = await req.json().catch(() => ({}));
    const to = Array.isArray(body?.to)
      ? body.to.map((t: unknown) => String(t).trim()).filter(Boolean)
      : undefined;

    const result = await runLoadStatus({ send: true, to });

    if (result.recipients.length === 0) {
      return Response.json(
        { ...result, error: "No recipients — tick “Receive DISPO load status” on at least one user in Control Centre → Users." },
        { status: 400, headers: noCacheHeaders() },
      );
    }
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "send_load_status",
      details: `Sent DISPO load status to ${result.emailed}/${result.recipients.length} recipient(s) — ${result.outstandingVendors} vendor(s) outstanding`,
      status: result.failures.length > 0 ? "error" : "success",
    });
    return Response.json(result, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
