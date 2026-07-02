import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getIgnored, addIgnored, removeIgnored } from "@/lib/storeReportCodeIgnore";
import { addLog } from "@/lib/activityLog";

function summariseCodes(codes: string[], max = 20): string {
  if (codes.length <= max) return codes.join(", ");
  return `${codes.slice(0, max).join(", ")} +${codes.length - max} more`;
}

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
    const by = session.name || session.email;
    const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c)) : [];
    const result = await addIgnored(codes, by);
    if (codes.length) {
      addLog({
        userId: session.userId, userName: by,
        action: "Ignored store(s) (Site Code Check)",
        details: `Ignored ${codes.length}: ${summariseCodes(codes)}`,
        status: "success",
      }).catch(() => {});
    }
    return Response.json(payload(result), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const by = session.name || session.email;
    const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c)) : [];
    const result = await removeIgnored(codes);
    if (codes.length) {
      addLog({
        userId: session.userId, userName: by,
        action: "Restored ignored store(s) (Site Code Check)",
        details: `Restored ${codes.length}: ${summariseCodes(codes)}`,
        status: "success",
      }).catch(() => {});
    }
    return Response.json(payload(result), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
