/* Copy named clients from iRam LIVE's store into ARIA's (OuterJoin's) store.

   SAFE BY DEFAULT: a dry run that lists what it would copy. --copy copies.
   It never deletes anything. Removing a client from iRam LIVE is a separate,
   later run with --archive-in-iram (sets the client ARCHIVED, the same as the
   Archive button: every byte is kept and Restore brings it back), done only
   after Carl has checked the client on ARIA.

   What a client is (see lib/clientPurge.ts for the same list):
     - its row in clients.json
     - everything under clients/{id}/ (control files, mappings, logo, report config)
     - everything under sales/{id}/ (the ledgers)
     - its uploads: index rows + uploads/{uploadId}.json + uploads/meta/{uploadId}.json
   Shared setup the client needs, copied whole on the FIRST copy into an ARIA
   store that has no clients yet, merged by id after that:
     channels.json (+ seed/migration flags so ARIA never re-seeds defaults over
     them, + main-channel logos), status-definitions.json, status-scenarios.json,
     cams.json (only the CAMs these clients use), config/retail-calendar.json,
     store-files/ (store master) and the store-report site-code lists.
   NOT copied, listed for Carl instead:
     - users who are limited to these clients (make them on ARIA; they get a
       Forgot-password email there)
     - a client's Perigee feed token: it is encrypted with iRam's key and has
       to be pasted again on ARIA
     - history: store-report audit/sends/tracking, activity log, report counts,
       Portfolio Stock Health snapshots (those are all-client).

   Run (manual mode only), after `vercel env pull` of each project to a file:
     npx tsx scripts/copy-clients-to-aria.ts --src-env=.env.iram --dest-env=.env.aria "Defy" "Lesco" "SNOMASTER (PTY) LTD"
   Nobody copies a secret: see authFrom() below.
   Add --copy to copy, --archive-in-iram (separately, later) to archive.
   A name matches case-insensitively, exact first, else a unique "contains".
   Use --id=<clientId> instead of a name when a name matches more than one. */
import { list, put, get } from "@vercel/blob";
import { gzipSync, gunzipSync } from "zlib";
import fs from "fs";

const args = process.argv.slice(2);
// --src-env=<file> / --dest-env=<file>: a `vercel env pull` file per store,
// so nobody copies a secret by hand. Uses BLOB_READ_WRITE_TOKEN if it is
// there; a SENSITIVE token pulls down BLANK, so otherwise it uses the
// short-lived VERCEL_OIDC_TOKEN + BLOB_STORE_ID the same pull writes (it
// expires on its own after some hours: pull again if the run says so).
type Auth = { token: string } | { oidcToken: string; storeId: string };
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const l = raw.trim();
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) out[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "").trim();
  }
  return out;
}
function authFrom(flag: string): Auth | null {
  const file = args.find((x) => x.startsWith(flag + "="))?.slice(flag.length + 1);
  if (!file) return null;
  const env = readEnvFile(file);
  if (env.BLOB_READ_WRITE_TOKEN) return { token: env.BLOB_READ_WRITE_TOKEN };
  if (env.VERCEL_OIDC_TOKEN && env.BLOB_STORE_ID) return { oidcToken: env.VERCEL_OIDC_TOKEN, storeId: env.BLOB_STORE_ID };
  return null;
}
const SRC = authFrom("--src-env");
const DEST = authFrom("--dest-env");
const COPY = args.includes("--copy");
const ARCHIVE = args.includes("--archive-in-iram");
const ids = args.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5));
const names = args.filter((a) => !a.startsWith("--"));
const P = "live/";

type Json = Record<string, unknown>;
interface Blob { pathname: string; url: string; size: number }

// ── store access ──
async function listAll(auth: Auth, prefix: string): Promise<Blob[]> {
  const out: Blob[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ ...auth, prefix, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
// iRam's store is PUBLIC (read by URL); ARIA's is PRIVATE (read with its token).
async function srcBytes(pathname: string): Promise<Buffer | null> {
  const b = (await listAll(SRC!, pathname)).find((x) => x.pathname === pathname);
  if (!b) return null;
  const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`read ${pathname}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function destBytes(pathname: string): Promise<Buffer | null> {
  const r = await get(pathname, { access: "private", ...DEST!, useCache: false });
  if (!r) return null;
  if (r.statusCode !== 200 || !r.stream) throw new Error(`read ${pathname}: HTTP ${r.statusCode}`);
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}
const decode = <T>(buf: Buffer | null, fallback: T): T =>
  buf ? (JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf-8")) as T) : fallback;
const srcJson = async <T>(key: string, fb: T) => decode<T>(await srcBytes(P + key), fb);
const destJson = async <T>(key: string, fb: T) => decode<T>(await destBytes(P + key), fb);

const plan: string[] = [];
async function putDest(pathname: string, body: Buffer, contentType = "application/json") {
  plan.push(`write ${pathname} (${body.length} B)`);
  if (!COPY) return;
  await put(pathname, body, { ...DEST!, access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 0 });
}
const putDestJson = (key: string, v: unknown) => putDest(P + key, gzipSync(Buffer.from(JSON.stringify(v)), { level: 6 }));
async function copyRaw(pathname: string) {
  const b = await srcBytes(pathname);
  if (!b) throw new Error(`missing in iRam store: ${pathname}`);
  await putDest(pathname, b, pathname.endsWith(".json") ? "application/json" : "application/octet-stream");
}
async function copyPrefix(prefix: string): Promise<number> {
  const blobs = await listAll(SRC!, P + prefix);
  for (const b of blobs) await copyRaw(b.pathname);
  return blobs.length;
}
function mergeById<T extends { id: string }>(dest: T[], add: T[]): T[] {
  const byId = new Map(dest.map((x) => [x.id, x]));
  for (const x of add) byId.set(x.id, x);
  return [...byId.values()];
}

async function main() {
  if (!SRC || !DEST) throw new Error("No store credentials in --src-env / --dest-env: pull each project's env again.");
  const sid = (a: Auth) => ("storeId" in a ? a.storeId : a.token.split("_")[3] || "").replace(/^store_/, "").toLowerCase();
  if (sid(SRC) === sid(DEST)) throw new Error("Source and destination are the same store.");
  if (!names.length && !ids.length) throw new Error("Name at least one client.");

  // ── pick the clients ──
  const srcClients = await srcJson<Json[]>("clients.json", []);
  if (!srcClients.length) throw new Error("iRam clients.json read as empty: stopping.");
  const picked: Json[] = [];
  for (const id of ids) {
    const c = srcClients.find((x) => x.id === id);
    if (!c) throw new Error(`No iRam client with id ${id}`);
    picked.push(c);
  }
  for (const n of names) {
    const want = n.trim().toUpperCase();
    const exact = srcClients.filter((c) => String(c.name).trim().toUpperCase() === want);
    const hits = exact.length ? exact : srcClients.filter((c) => String(c.name).toUpperCase().includes(want));
    if (hits.length !== 1) {
      console.log(`"${n}" matches ${hits.length} iRam clients:`);
      for (const h of hits) console.log(`   --id=${h.id}  ${h.name}  vendors ${JSON.stringify(h.vendorNumbers)}  ${h.active === false ? "(archived)" : ""}`);
      throw new Error(`Say which "${n}" with --id=...`);
    }
    picked.push(hits[0]);
  }
  const pickedIds = new Set(picked.map((c) => String(c.id)));

  if (ARCHIVE) {
    // Separate run, after Carl has checked ARIA. The same fields the Archive button sets.
    const now = new Date().toISOString();
    for (const c of picked) {
      const onAria = (await destJson<Json[]>("clients.json", [])).some((x) => x.id === c.id);
      if (!onAria) throw new Error(`${c.name} is not on ARIA yet: refusing to archive it in iRam.`);
    }
    const next = srcClients.map((c) => pickedIds.has(String(c.id))
      ? { ...c, active: false, archivedAt: now, archivedBy: "Moved to ARIA (OuterJoin)" } : c);
    for (const c of picked) console.log(`archive in iRam: ${c.name}`);
    if (!COPY) { console.log("\nDry run. Add --copy to archive."); return; }
    await put(P + "clients.json", gzipSync(Buffer.from(JSON.stringify(next))), { ...SRC!, access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
    console.log("Archived. Restore any of them from iRam LIVE's Clients page, Archived tab.");
    return;
  }

  // ── shared setup ──
  const destClients = await destJson<Json[]>("clients.json", []);
  const firstCopy = destClients.length === 0;
  console.log(firstCopy ? "ARIA has no clients yet: shared setup is copied whole.\n" : `ARIA already has ${destClients.length} client(s): shared setup is merged by id.\n`);

  const srcChannels = await srcJson<{ id: string; name: string; parentId?: string }[]>("channels.json", []);
  const destChannels = firstCopy ? [] : await destJson<{ id: string; name: string }[]>("channels.json", []);
  const clash = srcChannels.filter((s) => destChannels.some((d) => d.id !== s.id && d.name.toUpperCase() === s.name.toUpperCase()));
  if (clash.length) console.log(`⚠ channel names on ARIA under a different id: ${clash.map((c) => c.name).join(", ")}`);
  await putDestJson("channels.json", mergeById(destChannels, srcChannels));
  await putDestJson("channels-seeded.json", { done: true });
  await putDestJson("channels-migrated-v2.json", { done: true });
  const mains = new Set(srcChannels.filter((c) => !c.parentId).map((c) => c.id));
  for (const b of await listAll(SRC!, P + "channels/")) {
    const id = b.pathname.split("/")[2];
    if (mains.has(id)) await copyRaw(b.pathname);
  }
  for (const key of ["status-definitions.json", "status-scenarios.json"]) {
    const s = await srcJson<{ id: string }[]>(key, []);
    await putDestJson(key, mergeById(firstCopy ? [] : await destJson<{ id: string }[]>(key, []), s));
  }
  const camIds = new Set(picked.map((c) => c.camId).filter(Boolean));
  const cams = (await srcJson<{ id: string }[]>("cams.json", [])).filter((c) => camIds.has(c.id));
  await putDestJson("cams.json", mergeById(firstCopy ? [] : await destJson<{ id: string }[]>("cams.json", []), cams));
  if (firstCopy) {
    for (const key of ["config/retail-calendar.json", "store-reports/code-map.json", "store-reports/code-ignore.json", "store-reports/code-input.json"]) {
      if (await srcBytes(P + key)) await copyRaw(P + key);
    }
    console.log(`store master: ${await copyPrefix("store-files/")} file(s)`);
  } else {
    console.log("store master: NOT copied (ARIA already has one); load a store file there if stores are missing.");
  }

  // ── each client ──
  const uploadIndex = await srcJson<Json[]>("uploads/index.json", []);
  const theirUploads = uploadIndex.filter((u) => pickedIds.has(String(u.clientId)));
  for (const c of picked) {
    const files = await copyPrefix(`clients/${c.id}/`);
    const ledgers = await copyPrefix(`sales/${c.id}/`);
    const ups = theirUploads.filter((u) => u.clientId === c.id);
    for (const u of ups) {
      for (const key of [`uploads/${u.id}.json`, `uploads/meta/${u.id}.json`]) {
        if (await srcBytes(P + key)) await copyRaw(P + key);
      }
    }
    console.log(`${c.name}: ${files} control/config file(s), ${ledgers} ledger file(s), ${ups.length} upload(s)`);
  }
  const destIndex = firstCopy ? [] : await destJson<{ id: string }[]>("uploads/index.json", []);
  await putDestJson("uploads/index.json", mergeById(destIndex, theirUploads as unknown as { id: string }[]));
  await putDestJson("clients.json", mergeById(destClients as unknown as { id: string }[], picked as unknown as { id: string }[]));

  // ── what Carl has to do by hand ──
  const users = await srcJson<Json[]>("users.json", []);
  const theirs = users.filter((u) => {
    const scoped = [...((u.clientIds as string[]) || []), ...((u.storeReportClientIds as string[]) || [])];
    return scoped.length > 0 && scoped.some((id) => pickedIds.has(id));
  });
  console.log(`\nUsers limited to these clients (make them on ARIA, they reset their password there):`);
  for (const u of theirs) console.log(`   ${u.name} <${u.email}> role ${u.role}${u.storeReportOwnClientsOnly ? ", own-client store reports" : ""}`);
  if (!theirs.length) console.log("   none");
  const feeds = await srcJson<{ clientId: string }[]>("store-reports/perigee-feeds.json", []);
  const feedFor = feeds.filter((f) => pickedIds.has(f.clientId));
  console.log(`Perigee feed tokens to paste again on ARIA: ${feedFor.length ? feedFor.map((f) => picked.find((c) => c.id === f.clientId)?.name).join(", ") : "none"}`);

  console.log(`\n${plan.length} write(s) to ARIA. ${COPY ? "Done." : "Dry run: add --copy to copy."}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
