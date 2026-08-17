/* Which period a report claims to be for.
   Run: npx tsx scripts/test-report-period.ts                                  */

import { resolveReportPeriod, latestStamp, reportVendorPart, type PeriodStamp } from "../lib/reportPeriod";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const NOW = new Date("2026-08-11T10:00:00Z");
const S = (y: number, m: number, w: number): PeriodStamp => ({ reportYear: y, reportMonth: m, reportWeek: w });

console.log("\n── The bug this file exists for ─────────────────────────");
{
  // Channel order has nothing to do with time. The old code took the FIRST
  // stamped ledger, so an old channel stamped Wk1 sitting first in the list
  // labelled every report "Wk1" — on every client, which is exactly how it
  // was reported.
  const stamps = [S(2026, 3, 1), S(2026, 7, 4), S(2026, 6, 2)];
  const r = resolveReportPeriod(stamps, {}, NOW);
  eq("takes the LATEST stamp, not the first", r.label, "Jul 2026 Wk4");
  eq("and not the first one's week", r.week, 4);
}

console.log("\n── The user's choice always wins ────────────────────────");
{
  const stamps = [S(2026, 3, 1)];
  eq("chosen week beats the stamp", resolveReportPeriod(stamps, { week: 4 }, NOW).week, 4);
  eq("chosen week as a STRING (query params are strings)",
    resolveReportPeriod(stamps, { week: "4" }, NOW).week, 4);
  eq("full choice", resolveReportPeriod(stamps, { year: 2026, month: 7, week: 5 }, NOW).label, "Jul 2026 Wk5");
  eq("Week 5 is a real week and survives", resolveReportPeriod(stamps, { week: "5" }, NOW).week, 5);
}

console.log("\n── Fields resolve INDEPENDENTLY ─────────────────────────");
{
  // Pinning the month while leaving the week on Auto has to work — otherwise
  // touching one box silently drags the others with it.
  const r = resolveReportPeriod([S(2026, 7, 4)], { month: 6 }, NOW);
  eq("chosen month is honoured", r.month, 6);
  eq("week still comes from the stamp", r.week, 4);
  eq("year still comes from the stamp", r.year, 2026);
  eq("source is reported per field", `${r.source.month}/${r.source.week}`, "chosen/stamped");
}

console.log("\n── Empty / Auto is not a choice ─────────────────────────");
{
  // The page sends nothing for Auto, but be robust to "" and null arriving too.
  for (const blank of ["", null, undefined] as const) {
    const r = resolveReportPeriod([S(2026, 7, 4)], { week: blank }, NOW);
    eq(`week ${JSON.stringify(blank)} falls back to the stamp`, r.week, 4);
  }
  // A junk param must not become NaN in a sheet header.
  eq("unparseable week falls back rather than printing NaN",
    resolveReportPeriod([S(2026, 7, 4)], { week: "abc" }, NOW).week, 4);
}

console.log("\n── Unstamped ledgers ────────────────────────────────────");
{
  // An unstamped ledger knows nothing about the period. Scoring its blanks as
  // zero and letting it win would be the same "wrong one wins" bug in disguise.
  const stamps: (PeriodStamp | null)[] = [{}, null, S(2026, 7, 4), {}];
  eq("unstamped ledgers are ignored", resolveReportPeriod(stamps, {}, NOW).label, "Jul 2026 Wk4");
  eq("latestStamp skips them too", latestStamp(stamps)?.reportMonth, 7);
  eq("no stamps at all → null", latestStamp([{}, null]), null);
}

console.log("\n── Nothing to go on ─────────────────────────────────────");
{
  const r = resolveReportPeriod([], {}, NOW);
  eq("falls back to today's year", r.year, 2026);
  eq("falls back to today's month", r.month, 8);
  eq("falls back to a week-of-month", r.week, 2);   // 11th → ceil(11/7) = 2
  eq("every field flagged as a fallback", `${r.source.year}${r.source.month}${r.source.week}`, "fallbackfallbackfallback");
}

console.log("\n── Partial stamps ───────────────────────────────────────");
{
  // A ledger stamped with a year+month but no week: use what it has, fall back
  // for what it doesn't, and say which was which.
  const r = resolveReportPeriod([{ reportYear: 2026, reportMonth: 7 }], {}, NOW);
  eq("year and month from the stamp", `${r.year}-${r.month}`, "2026-7");
  eq("missing week is a fallback, not a silent 1", r.source.week, "fallback");
}

console.log("\n── Label and filename agree ─────────────────────────────");
{
  // These two are shown side by side; if they ever disagree, nobody can tell
  // which one is lying.
  const r = resolveReportPeriod([], { year: 2026, month: 7, week: 4 }, NOW);
  eq("label", r.label, "Jul 2026 Wk4");
  eq("filename part", r.filePart, "202607Wk4");
  eq("month is zero-padded in the filename", resolveReportPeriod([], { year: 2026, month: 3, week: 1 }, NOW).filePart, "202603Wk1");
}

// ── Which vendor(s) the filename names ────────────────────────────────────────
// The bug it fixes: VERIGREEN is 9677 on MAKRO and 1544 on MASSBUILD, and their
// MAKRO Month-End downloaded as "… - 1544 - …" without a single 1544 row in it.
{
  const row = (v: string) => ({ _vendor: v, Article: "1", Site: "M01" });
  eq("names the vendor actually in the file, not vendorNumbers[0]",
    reportVendorPart([row("9677"), row("9677")], ["1544", "9677"]), "9677");
  eq("…and the other channel names its own",
    reportVendorPart([row("1544")], ["1544", "9677"]), "1544");
  eq("a genuinely multi-vendor file names them all, in the declared order",
    reportVendorPart([row("9677"), row("1544")], ["1544", "9677"]), "1544+9677");
  eq("a vendor in the DATA but not declared is still named, never hidden",
    reportVendorPart([row("9677"), row("4242")], ["9677"]), "9677+4242");
  eq("a declared vendor with no rows is left out",
    reportVendorPart([row("9677")], ["1544", "9677", "1111"]), "9677");
  eq("rows carrying no vendor fall back to what the client declares",
    reportVendorPart([{ Article: "1" }], ["1544", "9677"]), "1544+9677");
  eq("…and an empty report with nothing declared names nothing",
    reportVendorPart([], undefined), "");
  eq("blank vendor stamps are ignored, not named as empty",
    reportVendorPart([{ _vendor: "  " }, row("9677")], ["9677"]), "9677");
  const many = ["1", "2", "3", "4", "5", "6", "7"];
  eq("a long vendor list is capped so the filename stays a filename",
    reportVendorPart(many.map(row), many), "1+2+3+4+5+2more");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
