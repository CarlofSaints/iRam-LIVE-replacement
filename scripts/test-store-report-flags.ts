/* The store report still flags exactly what it flagged before its three
   stock-health rules moved into lib/stockFlags.ts. Live report — this is the
   regression guard on that refactor, not a test of new behaviour. */
import { buildStoreReport, LOW_COVER_DAYS, PHANTOM_MONTHS } from "../lib/storeReport";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

const REF = new Date(Date.UTC(2026, 8, 30));
const DATE_COLS = ["07-2026", "08-2026", "09-2026"];

type Row = Record<string, unknown>;
function row(over: Partial<Row> = {}): Row {
  return {
    Site: "GC07", Article: "A1", SOH: 10,
    "Last Sold": "2026-09-20", "Last Recv": "2026-09-15",
    "07-2026": 30, "08-2026": 30, "09-2026": 30,
    _storeName: "The Glen", _province: "Gauteng", _storeType: "Corporate Store",
    ...over,
  };
}

function report(rows: Row[]) {
  return buildStoreReport(
    [{ clientId: "c1", clientName: "CLIPPA", rows, dateColumns: DATE_COLS, statusDefs: [], scenarios: [], hasRanging: false }],
    { siteCode: "GC07", referenceDate: REF },
  );
}

check("thresholds unchanged", [LOW_COVER_DAYS, PHANTOM_MONTHS], [14, 3]);

const r = report([
  row({ Article: "OOS1", SOH: 0 }),
  row({ Article: "NEG1", SOH: -3 }),
  row({ Article: "LOW1", SOH: 1 }),
  row({ Article: "PHAN1", SOH: 8, "Last Sold": "2026-01-02", "Last Recv": "2026-01-03" }),
  row({ Article: "PHAN2", SOH: 8, "Last Sold": "", "Last Recv": "" }),
  row({ Article: "FINE1" }),
]);

check("out of stock counts zero AND negative", r.counts.oos, 2);
check("low cover", r.counts.lowCover, 1);
check("phantom counts both the old dates and the blank ones", r.counts.phantom, 2);
check("the healthy line triggers nothing", r.lines.find((l) => l.article === "FINE1")?.flags.oos, false);

const low = r.lines.find((l) => l.article === "LOW1")!;
check("DROS still computed", low.dros > 0, true);
check("days cover still computed", low.daysCover !== null, true);

const oos = r.lines.find((l) => l.article === "OOS1")!;
check("an out-of-stock line is not also low cover", [oos.flags.oos, oos.flags.lowCover], [true, false]);

const phan = r.lines.find((l) => l.article === "PHAN1")!;
check("a phantom line keeps its stock", phan.soh, 8);
check("and is not out of stock", phan.flags.oos, false);

// Act DSC survived the refactor as a display field
const withDsc = report([row({ Article: "D1", "Act DSC": 42 })]);
check("Act DSC still reaches the line", withDsc.lines[0].actDsc, 42);

// A line with no stock and no sales is still LISTED (this report deliberately
// shows every listed SKU, unlike the portfolio roll-up which drops out-of-base)
const empty = report([row({ Article: "E1", SOH: 0, "07-2026": 0, "08-2026": 0, "09-2026": 0 })]);
check("out-of-base lines are still shown per store", empty.lines.length, 1);
check("and still flagged out of stock", empty.counts.oos, 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
