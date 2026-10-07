// The upload routes read AND DELETE the URL the browser posts. Only a temp
// upload in OUR store may pass, never app data or another store.
// Run: npx tsx scripts/test-temp-upload-guard.ts
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_AbC123xyz_notasecret";
delete process.env.NEXT_PUBLIC_BLOB_ACCESS;

let fails = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fails++; };

(async () => {
  const { isOwnTempUpload } = await import("../lib/blob");
  const own = "https://abc123xyz.public.blob.vercel-storage.com";
  check("our own temp upload passes", isOwnTempUpload(`${own}/uploads-tmp/DISPO%20W3-a1b2.xlsx`));
  check("live/users.json in our store is refused", !isOwnTempUpload(`${own}/live/users.json`));
  check("a sales ledger is refused", !isOwnTempUpload(`${own}/live/sales/c1/ledger.json`));
  check("dot-dot out of the temp folder is refused", !isOwnTempUpload(`${own}/uploads-tmp/../live/users.json`));
  check("encoded dot-dot is refused", !isOwnTempUpload(`${own}/uploads-tmp/%2E%2E/live/users.json`));
  check("another tenant's store is refused", !isOwnTempUpload("https://zzz999.public.blob.vercel-storage.com/uploads-tmp/x.xlsx"));
  check("the private host of our store id is refused on a public store", !isOwnTempUpload("https://abc123xyz.private.blob.vercel-storage.com/uploads-tmp/x.xlsx"));
  check("a lookalike host is refused", !isOwnTempUpload("https://abc123xyz.public.blob.vercel-storage.com.evil.example/uploads-tmp/x"));
  check("plain http is refused", !isOwnTempUpload(`http://abc123xyz.public.blob.vercel-storage.com/uploads-tmp/x.xlsx`));
  check("garbage is refused", !isOwnTempUpload("not a url"));
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
