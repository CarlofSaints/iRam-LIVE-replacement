import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getUploadLock, forceClearUploadLock, lockMessage } from "@/lib/uploadLock";
import { addLog } from "@/lib/activityLog";

/* Manual control over the app-wide upload lock.
   Uploads run one at a time so they cannot overwrite each other's sales rows.
   That gate has to have a way out: if a load ever strands the lock, every
   person in the business is blocked until it expires, and the only recourse
   was to wait. Anyone who may upload can look at it and clear a dead one. */

export const dynamic = "force-dynamic";

/** Who holds the lock right now (expired holders read as free). */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "upload_data");
    const lock = await getUploadLock();
    return Response.json(
      { lock, message: lock ? lockMessage(lock) : null },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}

/** Clear it. Guarded so nobody can kill a load that is genuinely running. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requirePermission(req, "upload_data");

    // A live holder is a real upload mid-flight — clearing it would let a
    // second load start against the same half-written ledger, which is the
    // exact data loss the lock exists to prevent. Only super admins may
    // override, and only deliberately.
    const live = await getUploadLock();
    const force = new URL(req.url).searchParams.get("force") === "true";
    if (live && !(force && session.role === "super_admin")) {
      return Response.json(
        {
          error: `Not cleared — that upload is still running. ${lockMessage(live)}`,
          lock: live,
        },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    const cleared = await forceClearUploadLock();
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "upload_lock_cleared",
      details: cleared
        ? `Cleared a stuck upload lock held by ${cleared.userName} (${cleared.clientName} — ${cleared.fileName}, started ${cleared.startedAt})`
        : "Cleared the upload lock (nothing was holding it)",
    });

    return Response.json({ success: true, cleared }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
