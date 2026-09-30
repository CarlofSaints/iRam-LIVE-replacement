/* ──────────────────────────────────────────────────────────────
   Is this product ranged at this store? — ONE answer, read by every report.

   Stamped per row by lib/enrichment.ts as `_rangeState`:
     "TRUE"    — the range file says TRUE for this site × product
     "FALSE"   — the range file says FALSE for it (a properly loaded file)
     "MISSING" — the range file doesn't state it: no row, a blank indicator, or
                 a store that isn't in the file at all. Treated as NOT ranged —
                 teams often load TRUE-only files (Carl's call, 30 Sep 2026).
     absent    — no range file, a channel the file doesn't cover, or codes that
                 don't line up. Can't judge, so nothing is hidden.

   A properly loaded file states TRUE or FALSE for every combination, so in that
   case a MISSING line is a gap in the file → the Month-End "Range Exceptions"
   sheet. In a TRUE-only file every non-TRUE line is MISSING, so that sheet
   would just list everything and is not produced.
   ────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

export type RangeState = "TRUE" | "FALSE" | "MISSING" | "";

export function rangeStateOf(row: Row): RangeState {
  const s = row["_rangeState"];
  return s === "TRUE" || s === "FALSE" || s === "MISSING" ? s : "";
}

/** Not ranged at this store — stated FALSE, or not stated at all. */
export function notRangedHere(row: Row): boolean {
  const s = rangeStateOf(row);
  return s === "FALSE" || s === "MISSING";
}

/** How the report names each state (Sales "Range" level, Data + Vital Signs column). */
export function rangeLabel(row: Row): string {
  switch (rangeStateOf(row)) {
    case "TRUE": return "Ranged";
    case "FALSE": return "Not ranged";
    case "MISSING": return "Not ranged (not in range file)";
    default: return "";
  }
}

/** How the client's range file was loaded, from what it contains. */
export type RangeMode = "none" | "true-only" | "full";
