// Runs lib/blob.ts against a REAL private Blob store. Use an EMPTY test store,
// never a live one: it writes and deletes under live/_selftest/.
// Run: NEXT_PUBLIC_BLOB_ACCESS=private npx tsx --env-file=<store .env> scripts/test-private-blob.ts
import { BLOB_ACCESS, writeJson, readJson, readJsonStrict, deleteBlob, listBlobs, writeBlob, readBlobBytes, fetchBlobBytes } from "../lib/blob";
import { put } from "@vercel/blob";

let fails = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fails++; };

(async () => {
  check("store mode is private", BLOB_ACCESS === "private");
  const key = `_selftest/${Date.now()}.json`;
  check("a missing blob reads as the fallback", (await readJsonStrict(key, "none")) === "none");
  await writeJson(key, { rows: [1, 2, 3], name: "test" });
  const back = await readJsonStrict<{ rows: number[] }>(key, { rows: [] }, { skipCache: true });
  check("written JSON reads back from the store (gzip, no cache)", back.rows.length === 3);
  await writeJson(key, { rows: [9] });
  const again = await readJsonStrict<{ rows: number[] }>(key, { rows: [] }, { skipCache: true });
  check("an overwrite is read straight away", again.rows[0] === 9);
  check("forgiving read works too", (await readJson<{ rows: number[] }>(key, { rows: [] })).rows[0] === 9);
  check("listBlobs finds it", (await listBlobs("_selftest/")).some((b) => b.key === `live/${key}`));

  const url = await writeBlob("_selftest/pic.png", Buffer.from("png-bytes"), "image/png");
  check("raw bytes read back by key", (await readBlobBytes("_selftest/pic.png"))?.toString() === "png-bytes");
  // What a browser upload hands the upload routes: the blob URL.
  const up = await put("live/_selftest/upload.xlsx", "xlsx-bytes", { access: "private", addRandomSuffix: true });
  check("an uploaded file is fetched back by URL", (await fetchBlobBytes(up.url))?.toString() === "xlsx-bytes");

  const anon = await fetch(url);
  check(`the URL alone gives nothing without the token (HTTP ${anon.status})`, !anon.ok);

  check("delete removes it", await deleteBlob(key));
  check("a deleted blob reads as missing", (await readJsonStrict(key, "gone", { skipCache: true })) === "gone");
  await deleteBlob("_selftest/pic.png");
  await deleteBlob(up.pathname);
  check("cleanup left nothing", (await listBlobs("_selftest/")).length === 0);
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
