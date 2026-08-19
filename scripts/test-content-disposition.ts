/* Reported 19 Aug 2026 from Makro Cornubia: the phantom Stock Count Sheet would
   not DOWNLOAD — "Could not build the sheet: Cannot convert argument to a
   ByteString because the character at index 72 has a value of 8212 which is
   greater than 255" — but EMAIL of the same sheet worked.

   8212 is U+2014, the em dash in the vendor label "9677 — VERIGREEN PTY LTD".
   HTTP header values are Latin-1, so the name could not go into
   Content-Disposition raw. Email was unaffected because a MIME attachment name
   is encoded rather than written into a header.

   Run: npx tsx scripts/test-content-disposition.ts                            */

import { contentDisposition, asciiFilename, filenameFromContentDisposition } from "../lib/contentDisposition";
import { phantomSheetFileName } from "../lib/phantomCountSheet";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

/** The check that actually matters: can this value be put in a header at all?
    This is precisely what threw in production. */
function headerSafe(value: string): boolean {
  try { new Headers({ "Content-Disposition": value }); return true; }
  catch { return false; }
}

console.log("\n── The exact failure from Makro Cornubia ────────────────");
{
  const filename = phantomSheetFileName({
    storeName: "MAKRO CORNUBIA - M28",
    siteCode: "M28",
    periodLabel: "Wk 1 · Aug 2026",
    generatedAt: "19 Aug 2026 at 09:00",
    vendorLabel: "9677 — VERIGREEN PTY LTD",
    mode: "empty",
  });
  ok("the filename really does contain the em dash", filename.includes("—"));

  const old = `attachment; filename="${filename}"`;
  ok("the OLD header is rejected by Headers — this is the reported bug", !headerSafe(old));

  const fixed = contentDisposition(filename);
  ok("the NEW header is accepted", headerSafe(fixed), fixed);
  ok("  it keeps an ASCII fallback", /filename="[^"]*"/.test(fixed));
  ok("  the fallback has no em dash", !/filename="[^"]*—/.test(fixed));
  ok("  and it carries the real name UTF-8 encoded", fixed.includes("filename*=UTF-8''"));
  ok("  the encoded name round-trips to the original",
    decodeURIComponent(fixed.split("filename*=UTF-8''")[1]) === filename);
}

console.log("\n── Every character above 255 must be handled, not just — ");
{
  // The em dash was simply the one we hit first. A client or store name can
  // carry any of these.
  for (const name of [
    "Report – en dash.xlsx",
    "Café Ltd.xlsx",
    "O’Brien’s Store.xlsx",
    "“Quoted” Client.xlsx",
    "Ünïcodé Wörks.xlsx",
    "Ellipsis… here.xlsx",
    "Non breaking space.xlsx",
    "Пример.xlsx",
    "日本語.xlsx",
  ]) {
    ok(`header-safe: ${name}`, headerSafe(contentDisposition(name)));
  }
}

console.log("\n── The ASCII fallback stays a usable filename ───────────");
{
  eq("em dash becomes a hyphen", asciiFilename("A — B.xlsx"), "A - B.xlsx");
  eq("en dash becomes a hyphen", asciiFilename("A – B.xlsx"), "A - B.xlsx");
  eq("curly apostrophe straightens", asciiFilename("O’Brien.xlsx"), "O'Brien.xlsx");
  eq("non-breaking space becomes a space", asciiFilename("A B.xlsx"), "A B.xlsx");
  eq("ellipsis expands", asciiFilename("Wait….xlsx"), "Wait....xlsx");
  eq("plain names are untouched", asciiFilename("Vital Signs - 9677.xlsx"), "Vital Signs - 9677.xlsx");
  // An all-non-ASCII name must still produce something openable. ".xlsx" is a
  // HIDDEN, nameless file on every OS — a stem is required, not just a truthy
  // string. (My first version returned exactly that.)
  eq("a fully non-ASCII name keeps its extension", asciiFilename("日本語.xlsx"), "download.xlsx");
  eq("…and one with no extension still has a name", asciiFilename("日本語"), "download");
  eq("a name that is only punctuation gets a stem too", asciiFilename("— —.xlsx"), "download.xlsx");
  eq("…but a real stem is left alone", asciiFilename("a.xlsx"), "a.xlsx");
  eq("a leading dot in a real name survives", asciiFilename("Report v1.2.xlsx"), "Report v1.2.xlsx");
}

console.log("\n── A filename can't break out of the header ─────────────");
{
  // A quote would close the parameter early; CR/LF would be header injection.
  const nasty = 'evil".xlsx';
  const h = contentDisposition(nasty);
  eq("a quote is stripped from the fallback", asciiFilename(nasty), "evil.xlsx");
  ok("  the header is still safe", headerSafe(h));
  ok("  exactly one quoted parameter survives", (h.match(/"/g) ?? []).length === 2, h);

  const injected = "a\r\nX-Evil: 1.xlsx";
  ok("CRLF is removed", !/[\r\n]/.test(asciiFilename(injected)));
  ok("  and the header is safe", headerSafe(contentDisposition(injected)));

  // RFC 5987 does not allow these raw in ext-value; encodeURIComponent leaves them.
  const h2 = contentDisposition("a'b(c)d!e*f.xlsx");
  for (const c of ["'", "(", ")", "!", "*"]) {
    ok(`  ${c} is percent-escaped in filename*`,
      !h2.split("filename*=UTF-8''")[1].includes(c), h2);
  }
}

console.log("\n── Shape and defaults ───────────────────────────────────");
{
  ok("defaults to attachment", contentDisposition("a.xlsx").startsWith("attachment;"));
  ok("inline is available", contentDisposition("a.xlsx", "inline").startsWith("inline;"));
  ok("an empty name still yields a valid header", headerSafe(contentDisposition("")));
  ok("  …named download", contentDisposition("").includes('filename="download"'));
}

console.log("\n── Reading the name back, browser side ──────────────────");
{
  const original =
    "Phantom Stock Count - MAKRO CORNUBIA - M28 - 9677 — VERIGREEN PTY LTD - 2026-08-19.xlsx";
  const header = contentDisposition(original);
  eq("filename* wins, so the em dash survives the round trip",
    filenameFromContentDisposition(header, "x.xlsx"), original);

  // Reading filename= first would silently downgrade the name — that is the
  // whole reason this helper exists rather than a regex at each call site.
  ok("  …and it is NOT the ASCII fallback",
    filenameFromContentDisposition(header, "x.xlsx") !== asciiFilename(original));

  eq("a plain filename= header still parses",
    filenameFromContentDisposition('attachment; filename="Plain.xlsx"', "x.xlsx"), "Plain.xlsx");
  eq("an unquoted filename= parses too",
    filenameFromContentDisposition("attachment; filename=Plain.xlsx", "x.xlsx"), "Plain.xlsx");
  eq("no header at all falls back",
    filenameFromContentDisposition(null, "Fallback.xlsx"), "Fallback.xlsx");
  eq("an empty header falls back",
    filenameFromContentDisposition("", "Fallback.xlsx"), "Fallback.xlsx");

  // A truncated percent-escape makes decodeURIComponent throw. It must fall
  // back to the ASCII copy, never blow up the download.
  eq("a broken filename* falls back to the ASCII one",
    filenameFromContentDisposition(
      `attachment; filename="Safe.xlsx"; filename*=UTF-8''%E0%A4%A`, "x.xlsx"),
    "Safe.xlsx");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
