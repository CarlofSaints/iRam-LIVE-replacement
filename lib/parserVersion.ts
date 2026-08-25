/* WHICH PARSER WROTE THIS NUMBER.

   On 25 Aug 2026 six clients' DISPOs were reloaded between 10:43 and 11:44 to
   repair a thousandfold understatement — but the fix only went live at 11:51.
   Every one of those reloads re-wrote exactly the same wrong numbers, reported
   success, and ticked the DISPO Checklist. Nothing in the data said which
   parser had produced it, so the only way to tell a repaired row from an
   unrepaired one was to compare load timestamps against a deployment clock,
   after the fact, by hand.

   So every ledger row now carries the version of the read path that last wrote
   it. "Was this made by the fixed code?" becomes a question you can ask of the
   data instead of the calendar — see /control-centre/data-health.

   ▶ BUMP `PARSER_VERSION` WHENEVER A CHANGE ALTERS THE NUMBERS A DISPO PARSES
     TO — a new column alias, a quantity read differently, a change to the UOM
     collapse or the merge rules. Add a line to PARSER_HISTORY saying what
     changed, because the number on its own tells nobody anything. Do NOT bump
     it for a change that cannot move a value (wording, styling, a report). */

export const PARSER_VERSION = 4;

export interface ParserRelease {
  version: number;
  date: string;      // when it went live
  commit: string;
  summary: string;   // what it changed about the numbers
}

/* Newest first. Versions 1-3 are recorded for the record only: stamping began
   at v4, so no row in the ledger will ever read 1, 2 or 3 — anything written
   before 25 Aug 2026 carries no stamp at all. */
export const PARSER_HISTORY: ParserRelease[] = [
  {
    version: 4,
    date: "2026-08-25",
    commit: "3704c22",
    summary:
      "Reads a period-separated thousand in Massbuild-style exports, which have no \"**\" total " +
      "line to check against, by testing each suspect against a total it would otherwise exceed.",
  },
  {
    version: 3,
    date: "2026-08-19",
    commit: "88b8f02",
    summary:
      "Computes a group's sales as Σ(units × Compo) instead of copying the \"**\" line, which is " +
      "not written in a consistent unit across exports.",
  },
  {
    version: 2,
    date: "2026-08-19",
    commit: "f5b6276",
    summary:
      "Reads a period-separated thousand where the file's \"**\" total lines confirm it, and stops " +
      "dropping case, pallet and layer sales in the UOM collapse.",
  },
  {
    version: 1,
    date: "before 2026-08-19",
    commit: "—",
    summary:
      "Everything earlier. Understated sales wherever a DISPO wrote thousands with a period or " +
      "sold in more than one unit of measure.",
  },
];

/** The field each ledger row carries. Underscore-prefixed, so `isInternalField`
    exempts it from the snapshot-period rule — it describes the write itself,
    not a point in time, and must be refreshed by every load.

    MEASURED, not guessed: on USABCO 1063 / MASSBUILD (15,942 rows, 16.44 MB)
    this adds 19 bytes a row — 0.29 MB, or 1.76%. Reports build their columns
    from explicit lists rather than from row keys, so it does not surface in
    Vital Signs or Month-End. */
export const PARSER_VERSION_FIELD = "_parserVersion";

/** Read a row's stamp. Anything unparseable — including absent — is null,
    which means "written before stamping existed", NOT "version zero". */
export function parserVersionOf(row: Record<string, unknown>): number | null {
  const v = row[PARSER_VERSION_FIELD];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Is this row's number known to have come from the current read path? */
export function isCurrentParser(row: Record<string, unknown>): boolean {
  return parserVersionOf(row) === PARSER_VERSION;
}

/** Plain-language label for a stamp, for the UI and the activity log. */
export function describeParserVersion(v: number | null): string {
  if (v === null) return "unstamped (written before 25 Aug 2026)";
  const rel = PARSER_HISTORY.find((r) => r.version === v);
  return rel ? `v${v} (${rel.date})` : `v${v} (unknown release)`;
}
