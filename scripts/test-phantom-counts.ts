/* Phantom count merge — the rule that decides whether a rep's count survives.
   Run: npx tsx scripts/test-phantom-counts.ts                                */

import { mergePhantomCounts, phantomLineKey, type PhantomCount, type IncomingCount } from "../lib/phantomCounts";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const T1 = "2026-08-11T10:00:00.000Z";
const T2 = "2026-08-11T10:05:00.000Z";
const T3 = "2026-08-11T10:10:00.000Z";

function inc(article: string, found: number | null, at: string, rep = "rep-a@x.co"): IncomingCount {
  return { clientId: "c1", clientName: "USABCO", vendor: "1063", article, description: "D", found, at, repEmail: rep };
}
function store(...entries: PhantomCount[]): Record<string, PhantomCount> {
  const out: Record<string, PhantomCount> = {};
  for (const e of entries) out[phantomLineKey(e.clientId, e.article)] = e;
  return out;
}
const K = (a: string) => phantomLineKey("c1", a);

console.log("\n── Basic capture ────────────────────────────────────────");
{
  const lines: Record<string, PhantomCount> = {};
  const r = mergePhantomCounts(lines, [inc("A1", 4, T1), inc("A2", 62.5, T1)]);
  ok("first save reports a change", r.changed);
  eq("whole units stored", lines[K("A1")]?.found, 4);
  eq("decimals stored intact", lines[K("A2")]?.found, 62.5);
}

console.log("\n── Zero is a real answer ────────────────────────────────");
{
  const lines: Record<string, PhantomCount> = {};
  mergePhantomCounts(lines, [inc("A1", 0, T1)]);
  // "I counted and found nothing" is the single most valuable phantom result —
  // it must be stored, not treated as an empty box.
  eq("a zero count is stored", lines[K("A1")]?.found, 0);
  ok("zero is present as a line", Object.prototype.hasOwnProperty.call(lines, K("A1")));
}

console.log("\n── Timestamp wins, not arrival order ────────────────────");
{
  const lines = store({ clientId: "c1", clientName: "U", vendor: "1063", article: "A1", description: "D", found: 9, at: T2 });
  const r = mergePhantomCounts(lines, [inc("A1", 3, T1)]);
  eq("a LATE-ARRIVING OLDER count is ignored", lines[K("A1")].found, 9);
  ok("and reports no change", !r.changed);

  mergePhantomCounts(lines, [inc("A1", 12, T3)]);
  eq("a newer count wins", lines[K("A1")].found, 12);
}

console.log("\n── Clearing the box ─────────────────────────────────────");
{
  const lines = store({ clientId: "c1", clientName: "U", vendor: "1063", article: "A1", description: "D", found: 5, at: T1 });
  const r = mergePhantomCounts(lines, [inc("A1", null, T2)]);
  ok("emptying the box removes the count", !Object.prototype.hasOwnProperty.call(lines, K("A1")));
  ok("and reports a change", r.changed);

  // A stale device that never saw the count must not be able to erase a fresh one.
  const lines2 = store({ clientId: "c1", clientName: "U", vendor: "1063", article: "A1", description: "D", found: 7, at: T3 });
  mergePhantomCounts(lines2, [inc("A1", null, T1)]);
  eq("a STALE clear cannot wipe a newer count", lines2[K("A1")].found, 7);
}

console.log("\n── Two reps in the same store ───────────────────────────");
{
  // Rep A counts aisle 1, rep B counts aisle 2. Each phone posts the FULL map it
  // holds — including blanks for lines it knows nothing about. Neither may erase
  // the other's work.
  const lines: Record<string, PhantomCount> = {};
  mergePhantomCounts(lines, [inc("A1", 4, T1, "a@x.co"), inc("A2", null, T1, "a@x.co")]);
  mergePhantomCounts(lines, [inc("A1", null, T1, "b@x.co"), inc("A2", 11, T2, "b@x.co")]);
  eq("rep A's count survives rep B's blank", lines[K("A1")]?.found, 4);
  eq("rep B's count is recorded", lines[K("A2")]?.found, 11);
  eq("each count keeps its own author", lines[K("A2")]?.repEmail, "b@x.co");
}

console.log("\n── Idle re-posting doesn't cause writes ─────────────────");
{
  const lines = store({ clientId: "c1", clientName: "U", vendor: "1063", article: "A1", description: "D", found: 4, at: T2 });
  const r = mergePhantomCounts(lines, [inc("A1", 4, T2)]);
  ok("re-sending the identical count is a no-op", !r.changed);

  // Same value, later timestamp: take it, so the stored `at` advances and an
  // older entry can't win a later race.
  const r2 = mergePhantomCounts(lines, [inc("A1", 4, T3)]);
  ok("the same value with a NEWER stamp still advances the clock", r2.changed);
  eq("timestamp moved forward", lines[K("A1")].at, T3);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
