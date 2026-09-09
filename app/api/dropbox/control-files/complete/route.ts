import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getMetadata } from "@/lib/dropbox";
import { getSyncJob, createSyncJob } from "@/lib/dropboxSyncJob";
import { addLog } from "@/lib/activityLog";

/* Called once the browser has finished pushing bytes to Dropbox.

   It re-reads the file's metadata rather than trusting the browser's word.
   The point is to confirm the file was REPLACED: a changed rev on the same
   path is the proof. A different path would mean Dropbox wrote a copy
   alongside, which is exactly the second-iteration problem this whole
   integration exists to remove. */
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const body = await req.json().catch(() => ({}));

    const jobId = String(body.jobId ?? "");
    const previousRev = String(body.previousRev ?? "");
    const job = jobId ? await getSyncJob(jobId) : null;
    if (!job) {
      return Response.json({ error: "No such sync job." }, { status: 404, headers: noCacheHeaders() });
    }

    const meta = await getMetadata(job.filePath);

    if (previousRev && meta.rev === previousRev) {
      return Response.json(
        {
          error:
            `"${job.fileName}" still shows the version you downloaded, so the upload did not land. ` +
            `Nothing was changed in Dropbox — try again.`,
        },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    job.note = "Saved to Dropbox. Waiting for the sync to carry it into SQL.";
    await createSyncJob(job);

    /* Dropbox cannot say who did this — the account is shared — so this log is
       the only record that ties the change to a person. */
    await addLog({
      userId: session.userId, userName: session.name,
      action: "dropbox_file_replaced",
      details:
        `Replaced "${job.fileName}" in Dropbox for ${job.clientName} ` +
        `(rev ${previousRev || "?"} → ${meta.rev}, ${meta.size} bytes).`,
      status: "success",
    });

    return Response.json(
      { ok: true, rev: meta.rev, size: meta.size, jobId: job.id, verifiable: !!job.sourceId },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
