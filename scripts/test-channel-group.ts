/* A Makro DISPO carries Walmart / Food Store / Cash & Carry sites. The upload
   routes those rows into the companion channel's own ledger — correct — but the
   reports only read the channel you ticked, so what you saw was the frozen copy
   left in the Makro ledger by loads that pre-date the split.

   VERIGREEN 9677, Aug-2026 Wk2: A01/A02/A03 printed 0 units and 0 SOH while the
   DISPO carried 379/357/271 SOH and 23/31/52 Aug units. Exactly the residual
   left over after the thousands and case-sales fixes.

   Run: npx tsx scripts/test-channel-group.ts                                   */

import {
  buildChannelGroup,
  expandToChannelGroups,
  dedupeByFreshestLoad,
} from "../lib/channelGroup";
import type { Channel } from "../lib/types";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
const ch = (id: string, name: string, extra: Partial<Channel> = {}) =>
  ({ id, name, ...extra }) as Channel;

// Makro names Walmart as a companion. Walmart does NOT name Makro — the link
// has to work read from either side.
const CHANNELS: Channel[] = [
  ch("makro", "MAKRO", { companionChannelIds: ["walmart"] }),
  ch("walmart", "WALMART"),
  ch("builders", "BUILDERS"),
  ch("makro-dc", "MAKRO DC", { parentId: "makro" }),
];

console.log("\n── The group is the same read from either side ──────────");
{
  const fromMakro = buildChannelGroup("makro", CHANNELS).map((c) => c.id).sort();
  const fromWalmart = buildChannelGroup("walmart", CHANNELS).map((c) => c.id).sort();
  eq("Makro sees both", fromMakro.join(","), "makro,walmart");
  eq("Walmart sees both — the link is bidirectional", fromWalmart.join(","), "makro,walmart");
  eq("an unlinked channel is alone",
    buildChannelGroup("builders", CHANNELS).map((c) => c.id).join(","), "builders");
  // An id with no channel record yields NOTHING, not itself. That is what the
  // inline version in the upload route did before this was extracted (it mapped
  // through channelById and filtered the misses), and the upload's site
  // validation depends on it: an empty accept list means no site is "known" and
  // every row falls to the primary channel. Pinned so the extraction cannot
  // quietly change it.
  eq("an unknown id yields nothing, matching the old inline behaviour",
    buildChannelGroup("nope", CHANNELS).length, 0);
  // The report side is unaffected either way — expand keeps the caller's own id.
  eq("…but a report still reads the ledger it was asked for",
    expandToChannelGroups(["nope"], CHANNELS).join(","), "nope");
}

console.log("\n── Expanding a report's selection ───────────────────────");
{
  const e = expandToChannelGroups(["makro"], CHANNELS);
  eq("Makro expands to Makro + Walmart", e.join(","), "makro,walmart");
  ok("the ticked channel stays first", e[0] === "makro");

  // A sub-channel's companions hang off its MAIN channel.
  eq("a sub-channel resolves through its parent",
    expandToChannelGroups(["makro-dc"], CHANNELS).join(","), "makro-dc,makro,walmart");

  // Selecting both sides must not produce the same ledger twice — that would
  // double every number in the report.
  eq("no duplicates when both sides are ticked",
    expandToChannelGroups(["makro", "walmart"], CHANNELS).join(","), "makro,walmart");
  eq("an unlinked channel does not drag anything in",
    expandToChannelGroups(["builders"], CHANNELS).join(","), "builders");
}

console.log("\n── The fossil loses to the live row ─────────────────────");
{
  const DATES = ["07-2026", "08-2026"];
  // The A01 story: a frozen all-zero copy in the Makro ledger, and the live row
  // in Walmart's, loaded today.
  const fossil = {
    Article: "415952", Site: "A01", SOH: 0,
    "07-2026": 0, "08-2026": 0, _lastLoadedAt: "2026-06-01T08:00:00.000Z",
  };
  const live = {
    Article: "415952", Site: "A01", SOH: 379,
    "07-2026": 50, "08-2026": 23, _lastLoadedAt: "2026-08-18T08:00:00.000Z",
  };

  for (const [order, rows] of [
    ["fossil first", [fossil, live]],
    ["live first", [live, fossil]],
  ] as const) {
    const r = dedupeByFreshestLoad([...rows], DATES);
    eq(`${order}: one row survives`, r.rows.length, 1);
    eq(`${order}: it is the live one`, r.rows[0]["SOH"], 379);
    eq(`${order}: the drop is counted`, r.supersededRows, 1);
    eq(`${order}: …and recognised as a stale fossil`, r.supersededStale, 1);
  }
}

console.log("\n── …but nothing else is disturbed ───────────────────────");
{
  const DATES = ["07-2026"];
  const rows = [
    { Article: "A", Site: "M01", SOH: 10, "07-2026": 5, _lastLoadedAt: "2026-08-01T00:00:00Z" },
    { Article: "B", Site: "M01", SOH: 20, "07-2026": 7, _lastLoadedAt: "2026-08-01T00:00:00Z" },
    { Article: "A", Site: "M02", SOH: 30, "07-2026": 9, _lastLoadedAt: "2026-08-01T00:00:00Z" },
  ];
  const r = dedupeByFreshestLoad(rows, DATES);
  eq("distinct keys all survive", r.rows.length, 3);
  eq("nothing superseded", r.supersededRows, 0);
  ok("original order is kept", String(r.rows[0]["Site"]) === "M01" && String(r.rows[2]["Site"]) === "M02");

  // A row with no Article/Site (the file's own grand-total line) must pass
  // through rather than collapse onto some other row.
  const withTotal = dedupeByFreshestLoad(
    [...rows, { Article: "", Site: "", "07-2026": 999 }], DATES);
  eq("an unkeyed row passes through", withTotal.rows.length, 4);

  // Two live rows, neither stale — the fresher still wins, but it is not
  // reported as a fossil.
  const both = dedupeByFreshestLoad([
    { Article: "A", Site: "M01", SOH: 5, "07-2026": 5, _lastLoadedAt: "2026-08-01T00:00:00Z" },
    { Article: "A", Site: "M01", SOH: 9, "07-2026": 9, _lastLoadedAt: "2026-08-18T00:00:00Z" },
  ], DATES);
  eq("fresher of two live rows wins", both.rows[0]["SOH"], 9);
  eq("…and is not counted as stale", both.supersededStale, 0);

  // A row with no stamp at all must never beat one that has been loaded.
  const unstamped = dedupeByFreshestLoad([
    { Article: "A", Site: "M01", SOH: 0, "07-2026": 0 },
    { Article: "A", Site: "M01", SOH: 42, "07-2026": 1, _lastLoadedAt: "2026-08-18T00:00:00Z" },
  ], DATES);
  eq("an unstamped row loses to a stamped one", unstamped.rows[0]["SOH"], 42);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
