/* The store report reads the range file PER STORE, and does not raise Out of
   Stock / Low Cover on a product that isn't ranged at that store.
   Covers lib/enrichment.ts (buildSiteRanging + _rangedAtSite) and the filter in
   lib/storeReport.ts. */
import { buildSiteRanging, enrichLedgerRow } from "../lib/enrichment";
import { buildStoreReport } from "../lib/storeReport";
import { rangeArticleCode } from "../lib/rangingFields";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

type Row = Record<string, unknown>;

// Real range headers carry Helper/Mandatory prefixes (see monthEndReport rangingField).
const RANGE: Row[] = [
  { HelperProductID: "P-1", HelperArticleChannelCode: "000111", HelperSiteCode: "M28", MandatoryRangeIndicator: "TRUE" },
  { HelperProductID: "P-2", HelperArticleChannelCode: "222", HelperSiteCode: "M28", MandatoryRangeIndicator: "FALSE" },
  { HelperProductID: "P-2", HelperArticleChannelCode: "222", HelperSiteCode: "M29", MandatoryRangeIndicator: "TRUE" },
  { HelperProductID: "P-4", HelperArticleChannelCode: "", HelperSiteCode: "M28", MandatoryRangeIndicator: "Y" },
];
const sr = buildSiteRanging(RANGE)!;
const links = new Map<string, string>([["444", "P-4"]]);
const enrich = (r: Row) => enrichLedgerRow(r, links, new Map(), new Map(), undefined, sr);

check("empty range file → no per-store lookup", buildSiteRanging([]), undefined);
check("ranged TRUE here (article leading zeros ignored)", enrich({ Site: "M28", Article: "111" })._rangedAtSite, true);
check("FALSE here even though TRUE at another store", enrich({ Site: "M28", Article: "222" })._rangedAtSite, false);
check("TRUE at the other store", enrich({ Site: "M29", Article: "222" })._rangedAtSite, true);
check("absent for a store in the file → not ranged", enrich({ Site: "M28", Article: "999" })._rangedAtSite, false);
check("matched via product id when the article is blank in the range file", enrich({ Site: "M28", Article: "444" })._rangedAtSite, true);
check("store not in the range file → can't judge", enrich({ Site: "G016", Article: "111" })._rangedAtSite, undefined);
check("site code case / spacing tolerated", enrich({ Site: " m28 ", Article: "111" })._rangedAtSite, true);

// Second layout (PROGRESSIVE IMPRESSIONS): Site Num + Channel Article wrapped as
// <CHANNEL>-<article>-<unit>, Range Indicator a real boolean. Matched NO store before.
const sr2 = buildSiteRanging([
  { "Product ID": "IRAM_0054", "Channel Article": "MASSBUILD-171220-EA", "Site Num": "B28", "Range Indicator": true },
  { "Product ID": "IRAM_0099", "Channel Article": "MASSBUILD-555-EA", "Site Num": "B02", "Range Indicator": true },
])!;
const enrich2 = (r: Row) => enrichLedgerRow(r, new Map(), new Map(), new Map(), undefined, sr2);
check("Site Num layout: store found", sr2?.sites.has("b28"), true);
check("Channel Article unwrapped → ranged at B28", enrich2({ Site: "B28", Article: "171220" })._rangedAtSite, true);
check("…and not ranged at B28 when only B02 has it", enrich2({ Site: "B28", Article: "555" })._rangedAtSite, false);
check("plain code untouched by the unwrap", rangeArticleCode("171220"), "171220");
check("unwrap keeps the middle", rangeArticleCode("MASSBUILD-171220-EA"), "171220");

// ── The report ──
const REF = new Date(Date.UTC(2026, 8, 30));
const DATE_COLS = ["07-2026", "08-2026", "09-2026"];
function row(over: Row): Row {
  return {
    Site: "M28", SOH: 10, "Last Sold": "2026-09-20", "Last Recv": "2026-09-15",
    "07-2026": 30, "08-2026": 30, "09-2026": 30, _storeName: "Makro Cornubia",
    ...over,
  };
}
function report(rows: Row[], hasRanging = true) {
  return buildStoreReport(
    [{ clientId: "c1", clientName: "CLIPPA", rows, dateColumns: DATE_COLS, statusDefs: [], scenarios: [], hasRanging }],
    { siteCode: "M28", referenceDate: REF },
  );
}

const r = report([
  row({ Article: "RANGED_OOS", SOH: 0, _rangedAtSite: true }),
  row({ Article: "UNRANGED_OOS", SOH: 0, _rangedAtSite: false }),
  row({ Article: "UNRANGED_LOW", SOH: 1, _rangedAtSite: false }),
  row({ Article: "UNRANGED_PHANTOM", SOH: 8, "Last Sold": "2026-01-02", "Last Recv": "2026-01-03", _rangedAtSite: false }),
]);
const line = (a: string) => r.lines.find((l) => l.article === a)!;
check("ranged OOS still reported", line("RANGED_OOS").flags.oos, true);
check("not-ranged OOS dropped", line("UNRANGED_OOS").flags.oos, false);
check("not-ranged low cover dropped", line("UNRANGED_LOW").flags.lowCover, false);
check("not-ranged phantom KEPT (stock is sitting there)", line("UNRANGED_PHANTOM").flags.phantom, true);
check("counts follow", [r.counts.oos, r.counts.lowCover, r.counts.phantom], [1, 0, 1]);
check("hidden count", r.notRangedHidden, 2);
check("line still listed under All products", r.totalProducts, 4);
check("Ranging shown per store", [line("RANGED_OOS").ranging, line("UNRANGED_OOS").ranging], ["TRUE", "FALSE"]);

// Guard: nothing at this store matched TRUE → codes disagree, hide nothing.
const g = report([
  row({ Article: "X1", SOH: 0, _rangedAtSite: false }),
  row({ Article: "X2", SOH: 0, _rangedAtSite: false }),
]);
check("no TRUE match at all → OOS kept (mismatch guard)", g.counts.oos, 2);
check("and Ranging left blank rather than a misleading FALSE", g.lines[0].ranging, "");

// No range file for the client → unchanged behaviour.
const n = report([row({ Article: "Y1", SOH: 0 })], false);
check("no range file → OOS kept", n.counts.oos, 1);
check("no range file → Ranging blank", n.lines[0].ranging, "");

// Store missing from the range file (undefined) is never filtered.
const u = report([
  row({ Article: "Z1", SOH: 0, _rangedAtSite: true }),
  row({ Article: "Z2", SOH: 0 }),
]);
check("undefined at a usable store → OOS kept", u.counts.oos, 2);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
