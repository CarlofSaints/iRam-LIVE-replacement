/* ──────────────────────────────────────────────────────────────
   Site-code normalisation.

   Some store codes are alpha-prefixed and zero-padded (e.g. "R001"). When a
   client saves a DISPO in Excel, that column is often stored as a currency
   value, so the code round-trips as a Rand amount: "R001" → "R1" (or "R 1.00").
   Our DISPO parser reads Site as formatted text, so the "R" survives but the
   zero-padding is lost — and the value no longer matches the store master's
   "R001", breaking site matching, the ledger key and store enrichment.

   normalizeSiteKey collapses an alpha-prefixed code to <prefix> + <integer>, so
   "R001", "R1" and "R 1.00" all key to "r1" while staying distinct from S-/D-
   codes ("s1", "d1"). Pure-numeric codes are left as a plain loose key so their
   matching is unchanged. This is a deliberately different (padding-agnostic)
   key from looseCode() in storeReportCodeMap.ts, which preserves zeros.

   Caveat: this treats "R1" and "R001" as the SAME store. If a store master ever
   used both as genuinely different sites the keys would collide — callers that
   repair against the master guard for that by skipping ambiguous keys.
   ────────────────────────────────────────────────────────────── */

/** Trim, lowercase, strip spaces / dashes / underscores. */
function loose(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/[\s \-_]+/g, "");
}

/**
 * Canonical matching key for a site code, tolerant of Excel's Rand-mangling of
 * alpha-prefixed codes. "R001" | "R1" | "R 1.00" | "R1,234.00" → "r1" | "r1234".
 * Pure-numeric and non-numeric-tail codes fall back to a plain loose key.
 */
export function normalizeSiteKey(raw: unknown): string {
  const s = loose(raw);
  if (!s) return "";
  // Require at least one leading letter so only alpha-prefixed codes (the ones
  // at risk of Rand-mangling) get their numeric tail normalised. A trailing
  // ".00"/",000" from currency formatting is parsed away via Number().
  const m = s.match(/^([a-z]+)(\d[\d.,]*)$/);
  if (!m) return s;
  const num = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(num)) return s;
  return m[1] + Math.trunc(num);
}
