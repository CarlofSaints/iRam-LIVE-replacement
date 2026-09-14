/* Portfolio Stock Health engine — the rules and the traps. */
import { buildPortfolioHealth, findStaleVendors, STALE_VENDOR_DAYS } from "../lib/portfolioHealth";
import { computeStockFlags, LOW_COVER_DAYS } from "../lib/stockFlags";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const REF = new Date(Date.UTC(2026, 8, 30)); // 30 Sep 2026, end of report month
const DATE_COLS = ["07-2026", "08-2026", "09-2026"];
const FRESH = "2026-09-28T06:00:00.000Z";
const STALE = "2026-07-01T06:00:00.000Z"; // ~90 days back

type Row = Record<string, unknown>;
function row(over: Partial<Row> = {}): Row {
  return {
    _clientId: "c1",
    _vendor: "9677",
    _lastLoadedAt: FRESH,
    _province: "Gauteng",
    _storeType: "Corporate Store",
    _storeName: "The Glen",
    _productDescription: "AMOS PEELERZ GUMMY PEACH 80GR",
    Site: "GC07",
    Article: "1025203",
    SOH: 10,
    "Last Sold": "2026-09-20",
    "Last Recv": "2026-09-15",
    "07-2026": 30, "08-2026": 30, "09-2026": 30,
    ...over,
  };
}

const names = new Map([["c1", "CLIPPA SALES"], ["c2", "LUMOSS"]]);
const DISC = new Set(["D", "X"]);

function build(rows: Row[], opts: Partial<Parameters<typeof buildPortfolioHealth>[0]> = {}) {
  return buildPortfolioHealth({
    rows, clientNames: names, dateColumns: DATE_COLS, referenceDate: REF,
    discontinuedCodes: DISC, ...opts,
  });
}

// ── The five measures ──
const flagOpts = {
  dateColumns: DATE_COLS, refYear: 2026, refMonth: 9, daysElapsed: 273,
  cutoff: new Date(Date.UTC(2026, 5, 30)), discontinuedCodes: DISC,
};
check("SOH 0 is out of stock", computeStockFlags(row({ SOH: 0 }), flagOpts).flags.oos, true);
check("SOH -4 is out of stock TOO", computeStockFlags(row({ SOH: -4 }), flagOpts).flags.oos, true);
check("...and is counted as negative SOH", computeStockFlags(row({ SOH: -4 }), flagOpts).flags.negSoh, true);
check("SOH 10 is not out of stock", computeStockFlags(row(), flagOpts).flags.oos, false);
check("positive SOH is never negSoh", computeStockFlags(row(), flagOpts).flags.negSoh, false);

// Phantom: stock but no sale AND no receipt since the cutoff (blank = stale)
check(
  "phantom when both dates are old",
  computeStockFlags(row({ "Last Sold": "2026-01-05", "Last Recv": "2026-01-09" }), flagOpts).flags.phantom,
  true,
);
check(
  "NOT phantom when it was received recently",
  computeStockFlags(row({ "Last Sold": "2026-01-05", "Last Recv": "2026-09-15" }), flagOpts).flags.phantom,
  false,
);
check(
  "BLANK dates count as stale, so it IS phantom",
  computeStockFlags(row({ "Last Sold": "", "Last Recv": "" }), flagOpts).flags.phantom,
  true,
);
check(
  "no stock is never phantom",
  computeStockFlags(row({ SOH: 0, "Last Sold": "", "Last Recv": "" }), flagOpts).flags.phantom,
  false,
);

// Discontinued is CONFIGURED, never inferred
check(
  "code D with stock is discontinued-with-SOH",
  computeStockFlags(row({ Status: "D" }), flagOpts).flags.discontinued,
  true,
);
check(
  "an unconfigured code is NOT discontinued",
  computeStockFlags(row({ Status: "T" }), flagOpts).flags.discontinued,
  false,
);
check(
  "with NO codes configured nothing is discontinued",
  computeStockFlags(row({ Status: "D" }), { ...flagOpts, discontinuedCodes: new Set<string>() }).flags.discontinued,
  false,
);
check(
  "discontinued needs stock on hand",
  computeStockFlags(row({ Status: "D", SOH: 0 }), flagOpts).flags.discontinued,
  false,
);

// Low cover needs the line to still be selling
check(
  "thin cover on a selling line",
  computeStockFlags(row({ SOH: 1 }), flagOpts).flags.lowCover,
  true,
);
check(
  "one unit left but NOTHING selling is not a cover emergency",
  computeStockFlags(row({ SOH: 1, "07-2026": 0, "08-2026": 0, "09-2026": 0 }), flagOpts).flags.lowCover,
  false,
);

// ── The unconfigured-measure signal ──
check("codes configured -> reported as configured", build([row()]).discontinuedConfigured, true);
check(
  "no codes configured -> reported as NOT configured",
  build([row()], { discontinuedCodes: new Set<string>() }).discontinuedConfigured,
  false,
);

// ── Stale vendors leave every figure ──
const mixed = [
  row({ SOH: 0 }),                                        // c1 fresh, OOS
  row({ _clientId: "c2", _vendor: "1000012163", _lastLoadedAt: STALE, SOH: 0, Site: "GF29" }),
  row({ _clientId: "c2", _vendor: "1000012163", _lastLoadedAt: STALE, SOH: 0, Site: "GF30" }),
];
const withStale = build(mixed);
check("the stale vendor is named", withStale.excluded.length, 1);
check("named by CLIENT, not just a number", withStale.excluded[0].clientName, "LUMOSS");
check("with its last data date", withStale.excluded[0].lastData, STALE);
check("and the line count it took with it", withStale.excluded[0].linesRemoved, 2);
check("its lines are OUT of the headline", withStale.totals.oos, 1);
check("out of the site count too", withStale.sites, 1);
check("and out of the client rollup", withStale.byClient.map((r) => r.label), ["CLIPPA SALES"]);
check(
  "LUMOSS appears in NO breakdown row anywhere",
  JSON.stringify(withStale).includes("LUMOSS") &&
    withStale.byClient.some((r) => r.label === "LUMOSS"),
  false,
);

// A stream nobody ever stamped is legacy, not stale — keep it
const legacy = [row({ _lastLoadedAt: "" }), row({ _lastLoadedAt: "", SOH: 0, Site: "GC08" })];
check("unstamped legacy rows are NOT dropped", build(legacy).excluded.length, 0);
check("...and still count", build(legacy).totals.oos, 1);

// The threshold is two weeks, not one — a late weekly file must not flap
const eightDaysAgo = new Date(REF.getTime() - 8 * 86400000).toISOString();
check("a file 8 days late is still live", build([row({ _lastLoadedAt: eightDaysAgo })]).excluded.length, 0);
const twentyDaysAgo = new Date(REF.getTime() - 20 * 86400000).toISOString();
check("20 days quiet is stale", build([row({ _lastLoadedAt: twentyDaysAgo })]).excluded.length, 1);
check("the threshold is 14 days", STALE_VENDOR_DAYS, 14);

// ── Rollups ──
const spread = [
  row({ SOH: 0, Site: "GC07", _province: "Gauteng" }),
  row({ SOH: 0, Site: "GC07", _province: "Gauteng", Article: "999" }),
  row({ SOH: 0, Site: "WC27", _province: "Western cape", _storeType: "Franchisee Store" }),
  row({ SOH: 5, Site: "WC27", _province: "Western cape", _storeType: "Franchisee Store", Article: "888" }),
];
const s = build(spread);
check("portfolio site count is DISTINCT sites", s.sites, 2);
check("three lines are out of stock", s.totals.oos, 3);
check("province rollup splits correctly", s.byProvince.map((r) => [r.label, r.counts.oos]), [
  ["Gauteng", 2], ["Western cape", 1],
]);
check("a site counted once per province, not per line", s.byProvince[0].sites, 1);
check("site profile rollup", s.bySiteProfile.map((r) => [r.label, r.counts.oos]), [
  ["Corporate Store", 2], ["Franchisee Store", 1],
]);
check("provinces are NEVER truncated", build(spread, { topN: 1 }).byProvince.length, 2);
check("but the site table is capped", build(spread, { topN: 1 }).bySite.length, 1);

// Absence is a value, not a dropped row
const noProv = build([row({ SOH: 0, _province: "", _storeType: "" })]);
check("an unmapped province is bucketed, not lost", noProv.byProvince[0].label, "(no province)");
check("same for site profile", noProv.bySiteProfile[0].label, "(no site profile)");
check("and it still reaches the headline", noProv.totals.oos, 1);

// In-base: a line with no stock and no sales anywhere is not a gap, it is absent
const outOfBase = build([row({ SOH: 0, "07-2026": 0, "08-2026": 0, "09-2026": 0 })]);
check("a line with no stock and no sales is out of base", outOfBase.activeLines, 0);
check("so it is not counted as out of stock", outOfBase.totals.oos, 0);

// One line can carry several measures at once — they must NOT be summed
const both = build([row({ SOH: 3, Status: "D", "Last Sold": "", "Last Recv": "" })]);
check("phantom and discontinued on the same line", [both.totals.phantom, both.totals.discontinued], [1, 1]);
check("one active line, two measures", both.activeLines, 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
