/* The stamp that says which parser wrote a ledger row.

   Six clients were reloaded on 25 Aug 2026 between 10:43 and 11:44 to repair a
   thousandfold understatement. The fix went live at 11:51. Every one of those
   reloads re-wrote the same wrong numbers, reported success, and ticked the
   DISPO Checklist — and nothing in the data could tell you.

   Run: npx tsx scripts/test-parser-version.ts                                 */

import {
  PARSER_VERSION,
  PARSER_HISTORY,
  PARSER_VERSION_FIELD,
  parserVersionOf,
  isCurrentParser,
  describeParserVersion,
} from "../lib/parserVersion";
import { summariseRows } from "../lib/parserVersionAudit";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

console.log("\n── The version is documented, not just incremented ──────");
{
  // This is the test that matters. Bumping the constant without saying what
  // changed leaves a number nobody can interpret, which is the situation the
  // stamp exists to end.
  const entry = PARSER_HISTORY.find((r) => r.version === PARSER_VERSION);
  ok(`PARSER_VERSION ${PARSER_VERSION} has a PARSER_HISTORY entry`, !!entry);
  ok("  and it says what changed about the numbers",
    !!entry && entry.summary.trim().length > 30);
  ok("  and it carries a date", !!entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date));

  const versions = PARSER_HISTORY.map((r) => r.version);
  eq("no duplicate versions", new Set(versions).size, versions.length);
  ok("newest first", versions.every((v, i) => i === 0 || versions[i - 1] > v),
    JSON.stringify(versions));
  ok("the current version is the highest", Math.max(...versions) === PARSER_VERSION);
}

console.log("\n── Reading a stamp ─────────────────────────────────────");
{
  eq("a stamped row reports its version", parserVersionOf({ [PARSER_VERSION_FIELD]: 4 }), 4);
  // Absence means "written before stamping existed" — NOT version zero, and
  // never something to treat as current.
  eq("an unstamped row is null, not 0", parserVersionOf({}), null);
  eq("a junk stamp is null", parserVersionOf({ [PARSER_VERSION_FIELD]: "4" }), null);
  eq("NaN is null", parserVersionOf({ [PARSER_VERSION_FIELD]: NaN }), null);
  ok("a current row is current", isCurrentParser({ [PARSER_VERSION_FIELD]: PARSER_VERSION }));
  ok("an unstamped row is NOT current", !isCurrentParser({}));
  ok("an older row is NOT current", !isCurrentParser({ [PARSER_VERSION_FIELD]: PARSER_VERSION - 1 }));
  ok("a newer row is not treated as current either",
    !isCurrentParser({ [PARSER_VERSION_FIELD]: PARSER_VERSION + 1 }),
    "a row from a newer deploy is not something this build can vouch for");
}

console.log("\n── Describing it to a human ────────────────────────────");
{
  ok("null says when stamping began", describeParserVersion(null).includes("25 Aug 2026"));
  ok("a known version names its date", describeParserVersion(PARSER_VERSION).includes("2026-"));
  ok("an unknown version is admitted, not hidden",
    describeParserVersion(999).includes("unknown"));
}

console.log("\n── Classifying a ledger ────────────────────────────────");
{
  const row = (v: number | null, loadedAt: string) => ({
    Article: "A", Site: "M01", _lastLoadedAt: loadedAt,
    ...(v === null ? {} : { [PARSER_VERSION_FIELD]: v }),
  });

  const s = summariseRows([
    row(PARSER_VERSION, "2026-08-25T12:15:31Z"),
    row(PARSER_VERSION, "2026-08-25T12:15:31Z"),
    row(PARSER_VERSION - 1, "2026-08-25T11:44:00Z"),
    row(null, "2026-08-19T09:00:00Z"),
  ]);
  eq("counts every row", s.totalRows, 4);
  eq("  two on the current parser", s.current, 2);
  eq("  one behind", s.behind, 1);
  eq("  one unstamped", s.unstamped, 1);
  eq("  broken down by version", s.byVersion[`v${PARSER_VERSION}`], 2);
  eq("  unstamped counted under its own key", s.byVersion["unstamped"], 1);
  // The reload has to be at or after the NEWEST bad load, not the oldest.
  eq("staleAsOf is the newest load still needing a redo", s.staleAsOf, "2026-08-25T11:44:00Z");

  const clean = summariseRows([row(PARSER_VERSION, "2026-08-25T12:15:31Z")]);
  eq("a clean ledger reports nothing stale", clean.behind + clean.unstamped, 0);
  eq("  and no stale date", clean.staleAsOf, "");

  eq("an empty ledger is not an error", summariseRows([]).totalRows, 0);
}

console.log(fail === 0 ? `\nALL PASS — ${pass} passed, 0 failed` : `\nFAILED — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
