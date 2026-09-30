/* Closed stores + dead discontinued lines are left out of Month-End / Vital
   Signs; ND leaves closed stores and dead discontinued products out of its
   base; an empty OTO sheet says which rule emptied it. */
import { applyReportExclusions, isClosedStore, isDeadDiscontinued, exclusionLabel } from "../lib/reportExclusions";
import { buildNumericalDistribution, buildOpenToOrder } from "../lib/monthEndReport";
import { openToOrderBlock } from "../lib/vitalSigns";
import type { ProductMaster, StatusDefinition, StoreRecord } from "../lib/types";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}
type Row = Record<string, unknown>;
const COLS = ["11-2025", "12-2025", "01-2026", "02-2026"];

// ── Closed stores ──
check("status CLOSED", isClosedStore("CLOSED"), true);
check("status Inactive", isClosedStore("Inactive"), true);
check("name carries (CLOSED)", isClosedStore("ACTIVE", "BWH GEZINA (CLOSED) - B01"), true);
check("active store", isClosedStore("ACTIVE", "BWH FAERIE GLEN - B02"), false);
check("blank status is not closed", isClosedStore("", ""), false);

// ── Dead discontinued ──
const d = (over: Row): Row => ({ _productStatus: "DISCONTINUED", SOH: 0, "11-2025": 7, "12-2025": 3, "01-2026": 0, "02-2026": 0, ...over });
check("discontinued, no stock, no 2026 sales → dead", isDeadDiscontinued(d({}), COLS, 2026), true);
check("…but sold this year → kept", isDeadDiscontinued(d({ "02-2026": 1 }), COLS, 2026), false);
check("…but has stock → kept", isDeadDiscontinued(d({ SOH: 2 }), COLS, 2026), false);
check("…a return (negative sale) this year still counts as activity", isDeadDiscontinued(d({ "01-2026": -1 }), COLS, 2026), false);
check("active product never dropped", isDeadDiscontinued(d({ _productStatus: "ACTIVE" }), COLS, 2026), false);
check("last year's sales don't keep it", isDeadDiscontinued(d({}), COLS, 2026), true);

const ex = applyReportExclusions([
  { _storeStatus: "CLOSED", _productStatus: "ACTIVE", SOH: 5 },
  d({}),
  { _storeStatus: "ACTIVE", _productStatus: "ACTIVE", SOH: 5 },
], COLS, 2026);
check("exclusions: one of each dropped", [ex.rows.length, ex.closedStoreLines, ex.deadDiscontinuedLines], [1, 1, 1]);
check("Menu line", exclusionLabel(ex, 2026), "1 lines at closed stores; 1 discontinued lines with no stock and no 2026 sales");
check("nothing left out → no Menu line", exclusionLabel({ closedStoreLines: 0, deadDiscontinuedLines: 0 }, 2026), "");

// ── ND base ──
const range = (site: string, cpid: string, over: Row = {}): Row =>
  ({ "Product ID": cpid, "Channel Article": `MASSBUILD-${cpid}-EA`, "Site Num": `MASSBUILD-${site}`, Channel: "MASSBUILD", "Store Status": "ACTIVE", "Store Name": site, "Range Indicator": true, ...over });
const products = new Map<string, ProductMaster>([
  ["p1", { clientProductId: "P1", status: "ACTIVE" } as ProductMaster],
  ["p9", { clientProductId: "P9", status: "DISCONTINUED" } as ProductMaster],
]);
const stores = [
  { siteNum: "B02", status: "ACTIVE" }, { siteNum: "B01", status: "CLOSED" }, { siteNum: "B03", status: "ACTIVE" },
] as StoreRecord[];
const nd = buildNumericalDistribution({
  rows: [{ Site: "B02", Article: "P1", _clientProductId: "P1", SOH: 3 }],
  dateColumns: COLS, refYear: 2026, refMonth: 2, rollingMonths: 6,
  hasRanging: true,
  rangingRows: [
    range("B02", "P1"),                                        // counted, distributed
    range("B03", "P1"),                                        // counted, not distributed
    range("B01", "P1"),                                        // closed in the store master
    range("B04", "P1", { "Store Status": "CLOSED" }),          // closed in the range file
    range("B05", "P1", { "Store Name": "BWH X (CLOSED) - B05" }), // closed by name
    range("B02", "P9"),                                        // discontinued, no DISPO line
    range("B03", "P1", { "Range Indicator": false }),          // not ranged
  ],
  stores, products,
});
check("ND base = ranged, open stores, live products only", nd.detail.map((x) => `${x.site}|${x.productCode}|${x.nd}`).sort(),
  ["b02|P1|1", "b03|P1|0"]);

// ── OTO: why nothing qualified ──
const defs = [{ code: "Z4", classification: "POSITIVE", channelId: "c" }] as StatusDefinition[];
const base: Row = { SOH: 0, SOO: 0, SIT: 0, _productStatus: "ACTIVE", "R. Profile": 6, Status: "Z4" };
check("qualifying line → no block", openToOrderBlock(base, defs), null);
check("unknown status code", openToOrderBlock({ ...base, Status: "Z9" }, defs), { block: "Status code has no definition", detail: "Z9" });
check("R. Profile column missing", openToOrderBlock({ ...base, "R. Profile": undefined }, defs), { block: "No R. Profile", detail: "(column missing)" });
check("PMF status", openToOrderBlock({ ...base, _productStatus: "" }, defs), { block: "PMF status not ACTIVE", detail: "(blank / not in PMF)" });

const oto = buildOpenToOrder({
  rows: [
    { ...base, Status: "Z9" }, { ...base, Status: "Z9" }, { ...base, Status: "Z7" },
    { ...base, SOH: 4 },                                       // in stock: not listed as a reason
    { ...base, "R. Profile": "" },
  ],
  statusDefs: defs, statusScenarios: [], otoMultipliers: {}, hasRanging: false, rangingRows: [],
});
check("empty OTO says why", oto.skipped.map((s) => `${s.reason}: ${s.lines} [${s.examples}]`), [
  "Status code has no definition: 3 [Z9 (2), Z7 (1)]",
  "No R. Profile: 1 [(blank) (1)]",
]);
check("and still no lines", oto.totalLines, 0);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
