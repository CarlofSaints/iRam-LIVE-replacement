/* Copy every blob from iRam LIVE's PUBLIC store into a new PRIVATE store.

   A store's public/private mode is fixed when it is created, so the only way
   to close the public store is to copy everything into a private one and
   point the app at it. Pathnames are kept exactly (live/..., no random
   suffix), so every readJson key still finds its file.

   SAFE BY DEFAULT:
   - Dry run unless --copy is passed: it lists what it WOULD copy.
   - Never deletes anything, in either store.
   - Never overwrites a NEWER copy: a blob is copied only when the private
     store has no copy, or an older one. So it can be re-run after the
     cut-over to pick up writes that landed on the old store in between,
     without undoing anything the app has since written to the new one.
   - Skips uploads-tmp/ (temporary browser uploads, deleted after parsing).

   Run (manual mode, never auto):
     SRC_BLOB_TOKEN=<old public store rw token> DEST_BLOB_TOKEN=<new private store rw token> \
       npx tsx scripts/migrate-blob-to-private.ts            # dry run
     ... npx tsx scripts/migrate-blob-to-private.ts --copy   # do it
   Ends with a count check: every source blob must exist in the destination
   with the same size, or it says which do not. */
import { list, put, type ListBlobResultBlob } from "@vercel/blob";

// Defaults are the names a `vercel env pull` gives when the new store is
// connected with the prefix PRIVATE_BLOB (old store keeps the default BLOB).
const SRC = (process.env.SRC_BLOB_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "").trim();
const DEST = (process.env.DEST_BLOB_TOKEN || process.env.PRIVATE_BLOB_READ_WRITE_TOKEN || "").trim();
const COPY = process.argv.includes("--copy");
const SKIP_PREFIX = "uploads-tmp/";

async function listAll(token: string): Promise<ListBlobResultBlob[]> {
  const out: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ token, limit: 1000, cursor });
    out.push(...res.blobs);
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return out;
}

function guessType(pathname: string): string {
  if (pathname.endsWith(".json")) return "application/json";
  if (/\.(png)$/i.test(pathname)) return "image/png";
  if (/\.(jpe?g)$/i.test(pathname)) return "image/jpeg";
  if (/\.(webp)$/i.test(pathname)) return "image/webp";
  if (/\.xlsx$/i.test(pathname)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

async function main() {
  if (!SRC || !DEST) throw new Error("Set SRC_BLOB_TOKEN (old public store) and DEST_BLOB_TOKEN (new private store).");
  if (SRC === DEST) throw new Error("Source and destination are the same store.");

  const [src, dest] = await Promise.all([listAll(SRC), listAll(DEST)]);
  const destBy = new Map(dest.map((b) => [b.pathname, b]));
  const todo = src.filter((b) => {
    if (b.pathname.startsWith(SKIP_PREFIX)) return false;
    const d = destBy.get(b.pathname);
    return !d || new Date(d.uploadedAt).getTime() < new Date(b.uploadedAt).getTime();
  });
  const bytes = todo.reduce((n, b) => n + b.size, 0);
  console.log(`Source ${src.length} blobs, destination ${dest.length}. To copy: ${todo.length} (${(bytes / 1e6).toFixed(1)} MB).`);
  if (!COPY) {
    for (const b of todo.slice(0, 20)) console.log(`  would copy ${b.pathname} (${b.size} B)`);
    if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);
    console.log("\nDry run. Add --copy to copy.");
    return;
  }

  let done = 0;
  const failed: string[] = [];
  const queue = [...todo];
  // A few at a time: the big sales ledgers are tens of MB.
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      try {
        const res = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`read HTTP ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length !== b.size) throw new Error(`read ${body.length} B, expected ${b.size}`);
        await put(b.pathname, body, {
          token: DEST, access: "private", addRandomSuffix: false, allowOverwrite: true,
          contentType: res.headers.get("content-type") || guessType(b.pathname),
          cacheControlMaxAge: 0,
        });
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${todo.length}`);
      } catch (e) {
        failed.push(`${b.pathname}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }));
  console.log(`Copied ${done}, failed ${failed.length}.`);
  for (const f of failed) console.log(`  FAILED ${f}`);

  // The check that matters: every source blob is now in the destination.
  const after = new Map((await listAll(DEST)).map((b) => [b.pathname, b]));
  // Missing, or still older than the source. A destination copy NEWER than
  // the source is the app's own later write: fine, whatever its size.
  const missing = src.filter((b) => {
    if (b.pathname.startsWith(SKIP_PREFIX)) return false;
    const d = after.get(b.pathname);
    if (!d) return true;
    const newer = new Date(d.uploadedAt).getTime() > new Date(b.uploadedAt).getTime();
    return !newer && d.size !== b.size;
  });
  console.log(missing.length === 0
    ? `CHECK OK: all ${src.filter((b) => !b.pathname.startsWith(SKIP_PREFIX)).length} source blobs are in the private store at the same size.`
    : `CHECK FAILED: ${missing.length} source blobs missing or a different size:\n${missing.slice(0, 30).map((b) => "  " + b.pathname).join("\n")}`);
  process.exit(failed.length || missing.length ? 1 : 0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
