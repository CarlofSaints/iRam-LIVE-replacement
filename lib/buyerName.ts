/* ──────────────────────────────────────────────────────────────
   Buyer name cleanup

   Massmart DISPOs carry the buyer's internal code alongside their name in
   one "Buyer" field, and the code is NOT in a fixed position. Measured
   across every client DISPO on disk with a Buyer column (19 distinct
   values, Aug 2026):

     "W_mm1_b01 Brendan naidoo"      code first
     "W_mm20_b02 Michelle lee"       code first
     "W_mm13_b06 Vacant"             code first
     "Mauritz swart W_mm23_b01"      code LAST
     "Rowen Armstrong"               no code at all (14 of the 19)

   So "take everything after the first space" is wrong — it would turn
   "Mauritz swart W_mm23_b01" into "swart W_mm23_b01", dropping the first
   name and keeping the code. What actually identifies the code is the
   UNDERSCORE: no human name contains one. Dropping underscore-bearing
   tokens works wherever the code sits and leaves plain names untouched.

   This is applied at REPORT-RENDER time, not on the way into the ledger,
   so it fixes every DISPO already loaded with no re-upload — and the raw
   value stays in the ledger if the code is ever needed. See
   [[derived-data-keeps-the-old-bug]]: cleaning at parse time would only
   have helped DISPOs loaded after the change.
   ────────────────────────────────────────────────────────────── */

/* Proper Case, because the source casing is inconsistent for the SAME person
   — the DISPOs carry both "Mauritz swart" and "Mauritz Swart", "Rowen
   armstrong" and "Rowen Armstrong". Once the codes are stripped those would
   read as two different buyers in the report.

   Carl's call (10 Aug 2026) was to case everything rather than maintain a
   list of exceptions, and the data supports it: none of the 19 real values
   contain a "McDonald" / "O'Brien" / "van der Merwe" pattern that naive
   casing would mangle. Word boundaries include hyphen and apostrophe so
   "anne-marie o'brien" still comes out right — that is standard casing, not
   an exception list. If a genuinely irregular name ever turns up, this is
   the one place to special-case it. */
function properCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    // Don't turn a possessive into "Mauritz'S".
    .replace(/(['’])S\b/g, "$1s");
}

/**
 * Strip the internal buyer code from a DISPO "Buyer" value and Proper Case
 * the name that remains.
 *
 * "Vacant" is a real value (post unfilled) and is preserved. If a value is
 * nothing but a code, the original is returned untouched rather than an empty
 * cell — showing the code beats showing blank, and a code is not a name to
 * case.
 */
export function cleanBuyerName(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const value = String(raw).trim();
  if (!value) return "";

  const kept = value
    .split(/\s+/)
    .filter((token) => !token.includes("_"))
    .join(" ")
    .trim();

  // Nothing but a code — keep what we were given rather than blanking it.
  return kept ? properCase(kept) : value;
}
