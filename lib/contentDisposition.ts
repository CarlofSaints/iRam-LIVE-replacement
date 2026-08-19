/* HTTP header values are LATIN-1. Putting a filename straight into
   `Content-Disposition` therefore throws the moment the name contains any
   character above U+00FF:

     Cannot convert argument to a ByteString because the character at index 72
     has a value of 8212 which is greater than 255

   8212 is U+2014, an EM DASH — the separator in the phantom count sheet's
   vendor label ("9677 — VERIGREEN PTY LTD"). Reported 19 Aug 2026 from Makro
   Cornubia: Download failed, Email worked. Email was fine because a MIME
   attachment name is encoded, not written into a raw header.

   The fix is RFC 6266: send BOTH a plain ASCII fallback and a UTF-8 encoded
   `filename*`, which every current browser prefers. That covers the em dash and
   everything after it — an accent, a curly apostrophe, a non-breaking space —
   rather than patching out the one character we happened to hit. */

/** Characters that have an obvious ASCII equivalent. Anything not listed is
    dropped rather than guessed at — a mangled letter is worse than a missing
    one, and `filename*` still carries the real name. */
const TRANSLITERATE: Record<string, string> = {
  "—": "-",   // — em dash
  "–": "-",   // – en dash
  "‒": "-",   // ‒ figure dash
  "−": "-",   // − minus
  "‘": "'",   // ' left single quote
  "’": "'",   // ' right single quote / apostrophe
  "“": '"',   // " left double quote
  "”": '"',   // " right double quote
  "…": "...", // … ellipsis
  " ": " ",   // non-breaking space
  "•": "-",   // • bullet
};

/**
 * An ASCII-only, quote-free version of the name, safe to sit inside the
 * `filename="…"` parameter of a header.
 */
export function asciiFilename(filename: string): string {
  const mapped = [...String(filename ?? "")]
    .map((ch) => {
      if (TRANSLITERATE[ch] !== undefined) return TRANSLITERATE[ch];
      const code = ch.codePointAt(0) ?? 0;
      // Printable ASCII only. Quotes and backslash would end or escape the
      // parameter; control characters would allow header injection.
      if (code < 0x20 || code > 0x7e) return "";
      if (ch === '"' || ch === "\\") return "";
      return ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  /* The stem — the name without its extension — has to contain something a
     person can read. "日本語.xlsx" maps to ".xlsx", which is not an empty string
     but IS a hidden, nameless file on every OS. Give it a stem and let
     `filename*` carry the real name. */
  const ext = mapped.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "";
  const stem = ext ? mapped.slice(0, -ext.length) : mapped;
  if (/[A-Za-z0-9]/.test(stem)) return mapped;
  return `download${ext || (String(filename ?? "").match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "")}`;
}

/**
 * A complete, header-safe `Content-Disposition` value.
 *
 *   attachment; filename="Report - 9677 - VERIGREEN.xlsx"; filename*=UTF-8''Report%20-%209677%20%E2%80%94%20VERIGREEN.xlsx
 *
 * `encodeURIComponent` already escapes everything RFC 5987 disallows except
 * `!'()*`, which it leaves alone and which the grammar rejects — so those are
 * escaped explicitly.
 */
export function contentDisposition(filename: string, type: "attachment" | "inline" = "attachment"): string {
  const name = String(filename ?? "").trim() || "download";
  const fallback = asciiFilename(name);
  const encoded = encodeURIComponent(name)
    .replace(/['()!*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Read a filename back out of a Content-Disposition header, browser side.
 *
 * `filename*` MUST win: `filename=` is only the ASCII fallback, so a reader that
 * looks at it first silently downgrades "9677 — VERIGREEN" to "9677 - VERIGREEN".
 * Every download button that names a blob needs this, which is why it lives here
 * rather than being re-written at each call site.
 *
 * NOTE: the /r store-report page builds its script as a STRING (lib/storeReportPage)
 * and cannot import this, so it carries its own copy of the same two rules. If
 * you change the precedence here, change it there too.
 */
export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const cd = String(header ?? "");
  const star = cd.match(/filename\*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* malformed — use the plain one */ }
  }
  const plain = cd.match(/filename="([^"]*)"/i) ?? cd.match(/filename=([^;]+)/i);
  const name = plain?.[1]?.trim();
  return name || fallback;
}
