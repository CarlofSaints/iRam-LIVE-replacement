import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClientById } from "@/lib/clientData";
import { refuseIfManualLoad } from "@/lib/dropboxControlFiles";
import { getTemporaryUploadLink } from "@/lib/dropbox";
import { resolveClientFolder, findControlFile, sqlSourceForKind } from "@/lib/dropboxControlFiles";
import { createSyncJob, fingerprint, type DropboxSyncJob } from "@/lib/dropboxSyncJob";
import { randomUUID } from "crypto";

export const maxDuration = 60;

/* Mint a direct upload URL that REPLACES one control file, and take the
   "before" reading of SQL at the same moment.

   The order matters and is the whole trick: the fingerprint of what SQL holds
   today is captured BEFORE the new file lands in Dropbox. Mark's process polls
   every couple of minutes, so taking the reading afterwards would risk
   capturing the already-updated data and then waiting forever for a change
   that had already happened.

   The commit terms live server-side in the minted link — path, replace-mode,
   and the rev. The browser only supplies bytes, so it cannot turn a replace
   into a new file or skip the conflict check. */
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission(req, "manage_control_files");
    const body = await req.json().catch(() => ({}));

    const clientId = String(body.clientId ?? "");
    const path = String(body.path ?? "");
    const rev = String(body.rev ?? "");
    if (!clientId || !path || !rev) {
      return Response.json(
        { error: "clientId, path and rev are all required — the rev is what makes this a replace." },
        { status: 400, headers: noCacheHeaders() },
      );
    }

    const client = await getClientById(clientId);
    if (!client) return Response.json({ error: "No such client." }, { status: 404, headers: noCacheHeaders() });
    const manual = refuseIfManualLoad(client);
    if (manual) return manual;

    const folder = await resolveClientFolder(client);
    if (!folder) {
      return Response.json({ error: "No Dropbox folder for this client." }, { status: 404, headers: noCacheHeaders() });
    }

    const file = await findControlFile(folder.path, path, client.dropboxFiles);
    if (!file) {
      return Response.json(
        { error: "That file is not in this client's Dropbox folder." },
        { status: 404, headers: noCacheHeaders() },
      );
    }

    /* Someone else saved between this person downloading and uploading. Say so
       now rather than letting Dropbox reject the bytes after a 20MB upload. */
    if (file.rev !== rev) {
      return Response.json(
        {
          error:
            `"${file.name}" has changed in Dropbox since you downloaded it, so it was not replaced. ` +
            `Download it again, redo your edit on the current version, and upload that.`,
          conflict: true,
        },
        { status: 409, headers: noCacheHeaders() },
      );
    }

    const sourceId = sqlSourceForKind(file.kind);
    const sqlClientName = (client.sqlClientName || client.name).trim();

    let beforeHash: string | null = null;
    let beforeRows: number | null = null;
    if (sourceId) {
      try {
        const fp = await fingerprint(sourceId, sqlClientName);
        beforeHash = fp.hash;
        beforeRows = fp.rows;
      } catch {
        /* Without a baseline the sync cannot be confirmed, but the save is
           still perfectly valid — degrade to "unverifiable" rather than
           blocking someone from fixing a file. */
        beforeHash = null;
      }
    }

    const url = await getTemporaryUploadLink(file.path, rev);

    const job: DropboxSyncJob = {
      id: randomUUID(),
      clientId,
      clientName: client.name,
      sqlClientName,
      filePath: file.path,
      fileName: file.name,
      sourceId: beforeHash === null ? null : sourceId,
      beforeHash,
      beforeRows,
      afterRows: null,
      startedAt: new Date().toISOString(),
      startedBy: session.name,
      syncedAt: null,
      state: "waiting",
      note: "Upload starting.",
    };
    await createSyncJob(job);

    return Response.json(
      {
        uploadUrl: url,
        jobId: job.id,
        fileName: file.name,
        verifiable: beforeHash !== null,
        beforeRows,
        reason:
          beforeHash !== null
            ? null
            : sourceId
              ? "SQL could not be read just now, so the update cannot be confirmed automatically."
              : "This file has no stored procedure behind it yet, so SQL cannot be watched for the change.",
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
