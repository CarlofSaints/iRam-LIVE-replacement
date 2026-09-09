import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { checkSyncJob, SYNC_TIMEOUT_MS } from "@/lib/dropboxSyncJob";

export const maxDuration = 60;

/* "Is it safe to export yet?"

   Saving to Dropbox does not update SQL — Mark's process polls every couple of
   minutes and carries the change across. Between those two moments a report
   looks completely normal and silently contains the OLD data, which is the
   failure this endpoint exists to prevent.

   One poll = one comparison of the client's rows against the fingerprint taken
   before the file was replaced. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_control_files");

    const id = req.nextUrl.searchParams.get("job") || "";
    if (!id) {
      return Response.json({ error: "job is required." }, { status: 400, headers: noCacheHeaders() });
    }

    const job = await checkSyncJob(id);
    if (!job) {
      return Response.json({ error: "No such sync job." }, { status: 404, headers: noCacheHeaders() });
    }

    const elapsedMs = Date.now() - new Date(job.startedAt).getTime();
    return Response.json(
      {
        state: job.state,
        note: job.note,
        fileName: job.fileName,
        clientName: job.clientName,
        startedAt: job.startedAt,
        startedBy: job.startedBy,
        syncedAt: job.syncedAt,
        beforeRows: job.beforeRows,
        afterRows: job.afterRows,
        elapsedMs,
        timeoutMs: SYNC_TIMEOUT_MS,
        safeToExport: job.state === "synced",
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
