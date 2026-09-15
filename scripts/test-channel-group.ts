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
  scopeRowsToSelection,
  pickedMetas,
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

console.log("\n── A report holds ONLY the channels picked (15 Sep 2026) ──");
{
  /* Carl: "when a user selects Walmart, the vital signs report includes all
     makro stores too … same thing if i select only Makro". The group is read
     whole so Walmart's live rows are visible; it must then be cut back. */
  const DATES = ["08-2026"];
  const STORES = [
    { siteNum: "M01", channel: "MAKRO" },
    { siteNum: "A01", channel: "WALMART" },
    { siteNum: "B01", channel: "BUILDERS" },
  ];
  const row = (Site: string, SOH: number, at: string) =>
    ({ Article: "415952", Site, SOH, "08-2026": SOH, _lastLoadedAt: at });
  const makroLedger = {
    channelId: "makro",
    rows: [
      row("M01", 10, "2026-08-18T00:00:00Z"),
      row("A01", 0, "2026-06-01T00:00:00Z"),   // pre-split fossil of a Walmart store
      row("X99", 5, "2026-08-18T00:00:00Z"),   // site not in the store master
    ],
  };
  const walmartLedger = { channelId: "walmart", rows: [row("A01", 379, "2026-08-18T00:00:00Z")] };
  const both = [makroLedger, walmartLedger];
  const sites = (rows: Record<string, unknown>[]) => rows.map((r) => r["Site"]).sort().join(",");

  const w = scopeRowsToSelection(both, ["walmart"], CHANNELS, STORES, DATES);
  eq("Walmart only: Walmart's store, and no Makro store", sites(w.rows), "A01");
  eq("…it is the live row, not the fossil", w.rows[0]?.["SOH"], 379);
  eq("…labelled Walmart alone", w.channelNames.join(" + "), "WALMART");
  eq("…and the Makro rows are counted as dropped", w.droppedOtherChannel, 2);

  const m = scopeRowsToSelection(both, ["makro"], CHANNELS, STORES, DATES);
  eq("Makro only: no Walmart store, not even its fossil copy", sites(m.rows), "M01,X99");
  eq("…a site with no store record stays with the ledger it came from", m.rows.some((r) => r["Site"] === "X99"), true);
  eq("…labelled Makro alone", m.channelNames.join(" + "), "MAKRO");

  const mw = scopeRowsToSelection(both, ["makro", "walmart"], CHANNELS, STORES, DATES);
  eq("Makro + Walmart ticked: both channels' stores", sites(mw.rows), "A01,M01,X99");
  eq("…with the fossil still collapsed onto the live row", mw.rows.find((r) => r["Site"] === "A01")?.["SOH"], 379);
  eq("…labelled with both", mw.channelNames.join(" + "), "MAKRO + WALMART");

  eq("a Makro sub-channel pick means Makro's stores",
    sites(scopeRowsToSelection(both, ["makro", "makro-dc"], CHANNELS, STORES, DATES).rows), "M01,X99");

  // Unrelated channels share site codes; picking both must never merge them.
  const clash = scopeRowsToSelection(
    [
      { channelId: "makro", rows: [row("M01", 10, "2026-08-18T00:00:00Z")] },
      { channelId: "builders", rows: [row("M01", 77, "2026-08-01T00:00:00Z")] },
    ],
    ["makro", "builders"], CHANNELS, [], DATES,
  );
  eq("the same Article|Site on unrelated channels is two rows, not one", clash.rows.length, 2);
  eq("…nothing reported as superseded", clash.supersededRows, 0);

  const metas = pickedMetas(
    [{ channelId: "makro", meta: "makro-meta" }, { channelId: "walmart", meta: "walmart-meta" }],
    ["walmart"], CHANNELS,
  );
  eq("the period comes from the picked channel's own ledger", metas.join(","), "walmart-meta");
  eq("…falling back to every ledger read when the picked one has none",
    pickedMetas([{ channelId: "makro", meta: "makro-meta" }, { channelId: "walmart", meta: null }], ["walmart"], CHANNELS).join(","),
    "makro-meta,");
}

console.log("\n── Liquor vs main stores: the SUB_CHANNEL ticks ─────────");
{
  /* Carl, 15 Sep 2026: "some clients i need to run the report only for the
     liquor stores and some clients only for main stores". */
  const CH: Channel[] = [
    ch("makro", "MAKRO (MAIN)", { companionChannelIds: ["walmart"] }),
    ch("walmart", "WALMART"),
    ch("sub-makro", "MAKRO", { parentId: "makro" }),
    ch("sub-liquor", "MAKRO LIQUOR", { parentId: "makro" }),
  ];
  const STORES = [
    { siteNum: "M01", channel: "MAKRO (MAIN)", subChannel: "Makro" },           // case differs
    { siteNum: "L01", channel: "MAKRO (MAIN)", subChannel: "MAKRO LIQUOR " },   // trailing space
    { siteNum: "A01", channel: "WALMART", subChannel: "WALMART" },
  ];
  const r = (Site: string) => ({ Article: "1", Site, SOH: 1, "08-2026": 1, _lastLoadedAt: "2026-08-18T00:00:00Z" });
  const L = [
    { channelId: "makro", rows: [r("M01"), r("L01"), r("X99")] },   // X99: no store record
    { channelId: "walmart", rows: [r("A01")] },
  ];
  const DATES = ["08-2026"];
  const sites = (rows: Record<string, unknown>[]) => rows.map((x) => x["Site"]).sort().join(",");

  const liq = scopeRowsToSelection(L, ["makro", "sub-liquor"], CH, STORES, DATES);
  eq("liquor ticked: the liquor store only", sites(liq.rows), "L01");
  eq("…the main store and the unplaceable one are counted out", liq.droppedSubChannel, 2);
  eq("…and the label says liquor, so it cannot overwrite a main run", liq.channelNames.join(" + "), "MAKRO (MAIN) (MAKRO LIQUOR)");

  eq("main ticked: the main store only",
    sites(scopeRowsToSelection(L, ["makro", "sub-makro"], CH, STORES, DATES).rows), "M01");

  const all = scopeRowsToSelection(L, ["makro", "sub-makro", "sub-liquor"], CH, STORES, DATES);
  eq("every sub ticked: not narrowed, nothing left out", sites(all.rows), "L01,M01,X99");
  eq("…labelled as the plain channel", all.channelNames.join(" + "), "MAKRO (MAIN)");

  eq("Makro's liquor tick never narrows Walmart, which has no sub-channels",
    sites(scopeRowsToSelection(L, ["makro", "sub-liquor", "walmart"], CH, STORES, DATES).rows), "A01,L01");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
