import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders, AuthError } from "@/lib/auth";
import { addLog } from "@/lib/activityLog";
import {
  dropboxConfigGaps,
  getMetadata,
  getTemporaryUploadLink,
  writeSelfTestFile,
  deleteSelfTestFile,
  selfTestDir,
  dropboxPath,
  DROPBOX_SELF_TEST_DIR,
} from "@/lib/dropbox";
import { randomUUID } from "crypto";

/* Prove the Dropbox WRITE path works — without touching a client's file.

   The round trip makes three promises, and until this route existed none of
   them had ever actually been exercised against Dropbox. The upload code was
   built, typechecked and tested against a stub, and the only way to try it
   for real was to overwrite a live master file — which is precisely the thing
   nobody wants to do in order to find out whether overwriting works:

     1. an upload REPLACES the file in place — no "file (1).xlsx" alongside
     2. a stale rev is REFUSED, so two people cannot silently flatten each
        other on a shared account
     3. the rev moves, which is how the app knows the bytes really landed

   All of it runs inside <ROOT>/_APP_SELF_TEST_/ on a file this route creates
   and then removes. The lib helpers refuse any path outside that folder.

   Worth keeping rather than deleting after one green run: the Dropbox account
   is shared and its token can be revoked, or re-pointed at a different
   account, by anyone — and after that the write path is unproven again. This
   answers "is the replace still working" in a couple of seconds, safely. */

export const maxDuration = 60;

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const steps: Step[] = [];
  const add = (name: string, ok: boolean, detail: string): boolean => {
    steps.push({ name, ok, detail });
    return ok;
  };
  const finish = () =>
    Response.json(
      { ok: steps.length > 0 && steps.every((s) => s.ok), folder: selfTestDir(), steps, elapsedMs: Date.now() - startedAt },
      { headers: noCacheHeaders() },
    );

  let scratchPath = "";
  /* Only true once the seed actually landed. Without it a failed seed still
     ran the delete, which then reported "could not delete — remove it by
     hand" for a file that was never created, on top of the real error. */
  let created = false;
  let session: Awaited<ReturnType<typeof requirePermission>>;

  try {
    session = await requirePermission(req, "view_sql_pilot");
  } catch (err) {
    return handleAuthError(err);
  }

  try {
    const gaps = await dropboxConfigGaps();
    if (gaps.length) {
      add("Dropbox is configured", false, `Missing: ${gaps.join(", ")}`);
      return finish();
    }

    /* A name nobody could mistake for a real control file, and unique per run
       so two people testing at once cannot collide. */
    const fileName = `roundtrip-${randomUUID()}.txt`;
    // Under the CONTROL ROOT — selfTestDir() carries it. A bare
    // dropboxPath(DROPBOX_SELF_TEST_DIR, …) points at the team root instead.
    scratchPath = dropboxPath(selfTestDir(), fileName);

    const first = Buffer.from(
      `iRam LIVE Dropbox round-trip self test\ncreated ${new Date().toISOString()}\nversion 1 — safe to delete\n`,
      "utf8",
    );
    const second = Buffer.from(
      `iRam LIVE Dropbox round-trip self test\nreplaced ${new Date().toISOString()}\nversion 2 — this line proves the replace landed\n`,
      "utf8",
    );
    const third = Buffer.from("version 3 — this write MUST be refused\n", "utf8");

    // ── 1. Seed a scratch file ────────────────────────────────────────────
    const seeded = await writeSelfTestFile(scratchPath, first);
    created = true;
    add("Create a scratch file", !!seeded.rev, `${seeded.path} · rev ${seeded.rev} · ${seeded.size} bytes`);
    const revOne = seeded.rev;

    // ── 2. Replace it through the SAME link the browser uses ──────────────
    /* Not a direct upload: this is files/get_temporary_upload_link with the
       commit terms fixed server-side, which is the exact mechanism the
       Dropbox tab uses — the real workbooks run past Vercel's ~4.5MB body cap
       and cannot go through an API route at all. */
    const uploadUrl = await getTemporaryUploadLink(scratchPath, revOne);
    const put = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(second),
      cache: "no-store",
    });
    const putText = await put.text().catch(() => "");
    if (
      !add(
        "Replace it with a temporary upload link",
        put.ok,
        put.ok
          ? `Dropbox accepted the bytes (${put.status})`
          : `Dropbox refused it (${put.status}) ${putText.slice(0, 200)}`,
      )
    ) {
      // Everything below reads the result of this write, so stop here.
      return await cleanupAndFinish();
    }

    // ── 3. Same path, new rev, new size ───────────────────────────────────
    const after = await getMetadata(scratchPath);
    const samePath = after.path.toLowerCase() === scratchPath.toLowerCase();
    add(
      "It replaced the file in place",
      samePath,
      samePath
        ? `Still ${after.path} — Dropbox did not write a copy alongside`
        : `Dropbox wrote "${after.path}" instead — a SECOND COPY was created`,
    );
    add(
      "The rev moved, so the bytes really landed",
      after.rev !== revOne,
      after.rev !== revOne
        ? `rev ${revOne} → ${after.rev} · ${seeded.size} → ${after.size} bytes`
        : `rev is still ${revOne} — the upload did not land`,
    );

    // ── 4. A stale rev must be REFUSED ────────────────────────────────────
    /* The safety property the whole integration rests on. The account is
       shared, so two people are one Dropbox user; if a stale rev were
       accepted, whoever saved first would be erased with no trace of who did
       it. Minting a link against the OLD rev is allowed — the commit is where
       Dropbox has to say no. */
    const staleUrl = await getTemporaryUploadLink(scratchPath, revOne);
    const stale = await fetch(staleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(third),
      cache: "no-store",
    });
    const staleText = await stale.text().catch(() => "");
    add(
      "A stale rev is refused, not merged",
      !stale.ok,
      !stale.ok
        ? `Dropbox refused it (${stale.status})${staleText.includes("conflict") ? " — conflict" : ""}`
        : "Dropbox ACCEPTED a write against an old rev — one person's save would silently overwrite another's",
    );

    // The refused write must also have changed nothing.
    const untouched = await getMetadata(scratchPath);
    add(
      "The refused write changed nothing",
      untouched.rev === after.rev,
      untouched.rev === after.rev ? `Still rev ${after.rev}` : `rev moved to ${untouched.rev} — the refused write landed anyway`,
    );

    return await cleanupAndFinish();
  } catch (err) {
    if (err instanceof AuthError) return handleAuthError(err);
    add("Self test ran to the end", false, err instanceof Error ? err.message : String(err));
    return await cleanupAndFinish();
  }

  /* Cleanup is part of building the response, not a `finally` — Response.json
     serialises its argument on the spot, so a step pushed from `finally` would
     never reach the caller. */
  async function cleanupAndFinish(): Promise<Response> {
    if (scratchPath && created) {
      try {
        await deleteSelfTestFile(scratchPath);
        add("Remove the scratch file", true, `Deleted ${scratchPath}`);
      } catch (e) {
        /* Reported, never thrown: a scratch file left behind is worth knowing
           about, but it must not turn a passing write test into a failure. */
        add(
          "Remove the scratch file",
          false,
          `Could not delete ${scratchPath} — remove it by hand. ${e instanceof Error ? e.message : ""}`,
        );
      }
    }
    const passed = steps.filter((s) => s.ok).length;
    await addLog({
      userId: session.userId,
      userName: session.name,
      action: "dropbox_self_test",
      details: `Ran the Dropbox round-trip self test in ${selfTestDir()} — ${passed}/${steps.length} checks passed.`,
      status: passed === steps.length ? "success" : "error",
    }).catch(() => {});
    return finish();
  }
}
