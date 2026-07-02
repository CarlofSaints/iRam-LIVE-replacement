import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getCodeInput, mergeCodeInput, removeCodeInput, type CodeEntry } from "@/lib/storeReportCodeInput";

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
      const input = await removeCodeInput(body.removeCodes.map((c) => String(c)), by);
      return Response.json({ ...input, removed: body.removeCodes.length }, { headers: noCacheHeaders() });
    }

    // Default = additive merge of a pasted list (never overwrites existing).
    const entries: CodeEntry[] = Array.isArray(body.entries)
      ? body.entries.map((e) => ({ code: String(e?.code ?? "").trim(), name: String(e?.name ?? "").trim() })).filter((e) => e.code)
      : [];
    const { input, added, skipped } = await mergeCodeInput(entries, by);
    return Response.json({ ...input, added, skipped }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
