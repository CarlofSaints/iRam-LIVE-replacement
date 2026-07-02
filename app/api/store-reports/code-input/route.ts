import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getCodeInput, mergeCodeInput, removeCodeInput, type CodeEntry } from "@/lib/storeReportCodeInput";
import { addLog } from "@/lib/activityLog";

// Keep a log detail readable — show the first few codes, then a "+N more" tail.
function summariseCodes(codes: string[], max = 20): string {
  if (codes.length <= max) return codes.join(", ");
  return `${codes.slice(0, max).join(", ")} +${codes.length - max} more`;
}

// Shared Site Code Check input list — readable/writable by anyone who can manage
// store reports, so multiple admins work off the same pasted list. The list is
// ADD-ONLY: pasting merges new stores in; it never overwrites what others have
// already pasted (so linking work is never wiped). Removal is explicit.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    return Response.json(await getCodeInput(), { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_store_reports");
    const by = session.name || session.email;
    const body = (await req.json().catch(() => ({}))) as {
      entries?: { code?: unknown; name?: unknown }[];
      removeCodes?: unknown[];
    };

    // Explicit removal of specific codes (Remove button).
    if (Array.isArray(body.removeCodes)) {
      const codes = body.removeCodes.map((c) => String(c));
      const input = await removeCodeInput(codes, by);
      if (codes.length) {
        addLog({
          userId: session.userId, userName: by,
          action: "Removed store(s) from Site Code list",
          details: `Removed ${codes.length}: ${summariseCodes(codes)}`,
          status: "success",
        }).catch(() => {});
      }
      return Response.json({ ...input, removed: codes.length }, { headers: noCacheHeaders() });
    }

    // Default = additive merge of a pasted list (never overwrites existing).
    const entries: CodeEntry[] = Array.isArray(body.entries)
      ? body.entries.map((e) => ({ code: String(e?.code ?? "").trim(), name: String(e?.name ?? "").trim() })).filter((e) => e.code)
      : [];
    const { input, added, skipped } = await mergeCodeInput(entries, by);
    if (entries.length) {
      addLog({
        userId: session.userId, userName: by,
        action: "Pasted store list (Site Code Check)",
        details: `${added.length} new added, ${skipped.length} already present (skipped)${added.length ? ` — added: ${summariseCodes(added)}` : ""}`,
        status: "success",
      }).catch(() => {});
    }
    return Response.json({ ...input, added, skipped }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
