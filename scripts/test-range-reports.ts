/* Range in Month-End + Vital Signs: a product not ranged at a store raises no
   OOS / Open to Order there, Sales splits Ranged vs Not ranged, and a full
   (TRUE/FALSE) range file gets a Range Exceptions list while a TRUE-only file
   does not. Covers lib/rangeState.ts, lib/enrichment.ts (FALSE vs MISSING,
   applyRangeGuard), lib/monthEndReport.ts and calcOpenToOrder. */
import { buildSiteRanging, enrichLedgerRow, applyRangeGuard } from "../lib/enrichment";
import {
  buildOOSSummary, buildOOSDetail, buildSalesSummary, buildDateContext,
  buildStatusSummary, buildRangeExceptions,
} from "../lib/monthEndReport";
import { calcOpenToOrder } from "../lib/vitalSigns";
import type { StoreRecord } from "../lib/types";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

type Row = Record<string, unknown>;
const stores = new Map<string, StoreRecord>([
  ["b28", { siteNum: "B28", channel: "MASSBUILD", subChannel: "BWH" } as StoreRecord],
  ["b99", { siteNum: "B99", channel: "MASSBUILD", subChannel: "BWH" } as StoreRecord],
]);
const R = (article: string, site: string, ind: unknown) =>
  ({ "Channel Article": `MASSBUILD-${article}-EA`, "Site Num": `MASSBUILD-${site}`, Channel: "MASSBUILD", "Range Indicator": ind });

// ── Enrichment: TRUE / FALSE / MISSING ──
const full = buildSiteRanging([R("1", "B28", true), R("2", "B28", false), R("3", "B28", "")], ["B28"])!;
const e = (r: Row, sr = full) => enrichLedgerRow(r, new Map(), new Map(), stores, undefined, sr);
check("stated TRUE", e({ Site: "B28", Article: "1" })._rangeState, "TRUE");
check("stated FALSE", e({ Site: "B28", Article: "2" })._rangeState, "FALSE");
check("blank indicator is not a FALSE → MISSING", e({ Site: "B28", Article: "3" })._rangeState, "MISSING");
check("no row → MISSING", e({ Site: "B28", Article: "4" })._rangeState, "MISSING");
check("store not in file → MISSING", e({ Site: "B99", Article: "1" })._rangeState, "MISSING");

const trueOnly = buildSiteRanging([R("1", "B28", true)], ["B28"])!;
check("full file detected", applyRangeGuard([e({ Site: "B28", Article: "1" })], full), "full");
check("TRUE-only file detected", applyRangeGuard([e({ Site: "B28", Article: "1" }, trueOnly)], trueOnly), "true-only");
check("no range file", applyRangeGuard([{}], undefined), "none");

// Guard: listed store, nothing TRUE anywhere in the batch → codes disagree → cleared.
const mismatch = [e({ Site: "B28", Article: "9" }), e({ Site: "B28", Article: "8" })];
applyRangeGuard(mismatch, full);
check("no TRUE in the batch → verdicts cleared, nothing hidden", mismatch.map((r) => r._rangeState ?? "none"), ["none", "none"]);

// ── Month-End ──
const DATE_COLS = ["07-2026", "08-2026", "09-2026"];
const ctx = buildDateContext(DATE_COLS);
const line = (over: Row): Row => ({
  Site: "B28", SOH: 0, "07-2026": 5, "08-2026": 5, "09-2026": 5, "Incl SP": 115, ...over,
});
const rows: Row[] = [
  line({ Article: "A", _rangeState: "TRUE" }),                 // OOS, ranged → counts
  line({ Article: "B", _rangeState: "FALSE" }),                // OOS, stated not ranged → not OOS, not base
  line({ Article: "C", _rangeState: "MISSING" }),              // OOS, assumed not ranged → same
  line({ Article: "D", _rangeState: "FALSE", SOH: 4 }),        // not ranged but stocked → base, not OOS
  line({ Article: "E" }),                                      // no range data → unchanged
];
const oos = buildOOSSummary(rows, DATE_COLS);
check("OOS count: only ranged + unknown", oos.oosCount, 2);
check("base drops the empty not-ranged lines, keeps the stocked one", oos.baseCount, 3);
check("OOS detail lists only A and E", buildOOSDetail(rows, DATE_COLS).map((d) => d.article), ["A", "E"]);
check("Status base unchanged by range", buildStatusSummary(rows, DATE_COLS, [], []).baseCount, 5);

const levels = buildSalesSummary(rows, ctx);
check("Range level sits after Vendor", levels.slice(0, 2).map((l) => l.level), ["Vendor", "Range"]);
const rng = levels.find((l) => l.level === "Range")!;
check("Range split labels", rng.volumeRows.map((r) => r.name).sort(),
  ["No range data", "Not ranged", "Not ranged (not in range file)", "Ranged"]);
check("Range split keeps the same total as Vendor", rng.volumeTotal.ytd, levels[0].volumeTotal.ytd);
check("no range data at all → no Range level",
  buildSalesSummary([line({ Article: "Z" })], ctx).some((l) => l.level === "Range"), false);

check("exceptions: full file lists MISSING only", buildRangeExceptions(rows, "full").map((x) => x.article), ["C"]);
check("exceptions: TRUE-only file → none", buildRangeExceptions(rows, "true-only").length, 0);

// ── Open to Order (Vital Signs, Month-End OTO, Charts) ──
const oto = (over: Row) => calcOpenToOrder(
  { SOH: 0, SOO: 0, SIT: 0, _productStatus: "ACTIVE", "R. Profile": 6, "Nett Cost": 10, ...over }, [], 1,
).oto;
check("OTO on a ranged line", oto({ _rangeState: "TRUE" }), 6);
check("no OTO when stated not ranged", oto({ _rangeState: "FALSE" }), 0);
check("no OTO when not in the range file", oto({ _rangeState: "MISSING" }), 0);
check("OTO unchanged without range data", oto({}), 6);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
