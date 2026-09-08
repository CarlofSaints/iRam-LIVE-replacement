/* A report for August must not contain September.

   Carl ran a Month-End for Aug 2026 Wk4 on SNOMASTER and the numbers were a
   month out. A DISPO carrying a single day of September had been loaded, then
   a later one that closed off in August. The September column stays in the
   ledger - that is deliberate, the ledger keeps every month it is given - but
   the report read its "current month" off whatever month the DATA reached,
   not off the period the user picked. So September's one unit was printed as
   Current Month, August's real 226 units slid into Last Month, YTD ran to
   September and Same Month LY compared against Sep 2025.

   The period reached the filename and every sheet header, and none of the
   numbers underneath them.

   Two independent halves, and this asserts both:
     1. capDateColumns cuts the later months off the set every sheet counts.
     2. buildDateContext is pinned to the report month, so a report month with
        no data yet reads zero under a correct heading rather than borrowing
        the newest month that does have some.

   Run: npx tsx scripts/test-report-period-scope.ts                           */

import ExcelJS from "exceljs";
import {
  capDateColumns, buildDateContext, buildSalesSummary,
  type OOSSummary,
} from "../lib/monthEndReport";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function same(label: string, actual: unknown[], expected: unknown[]) {
  eq(label, JSON.stringify(actual), JSON.stringify(expected));
}

/* Jan..Sep of both years. September 2026 is the "one day" column: it exists,
   and it holds almost nothing, which is exactly what made the real report look
   like the client had stopped selling. */
const ALL_COLS = [
  ...["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((m) => `${m}-2025`),
  ...["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((m) => `${m}-2026`),
];

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  const r: Record<string, unknown> = {
    "_vendor": "9321", "Article": "A1", "Site": "S1", "_storeName": "GREENSTONE",
    "_storeSubChannel": "MAKRO", "_province": "GAUTENG", "_category": "SM",
    "Incl SP": 115, "Prom SP": 0, "Nett Cost": 50, "SOH": 10,
  };
  for (const c of ALL_COLS) r[c] = 10;      // 10 units every month...
  r["09-2026"] = 1;                          // ...except the stub September
  return { ...r, ...over };
}

function main2026Aug() {
  return buildDateContext(capDateColumns(ALL_COLS, 2026, 8).kept, { year: 2026, month: 8 });
}

async function main() {
  console.log("capDateColumns");
  const cap = capDateColumns(ALL_COLS, 2026, 8);
  same("September 2026 is excluded", cap.excluded, ["09-2026"]);
  ok("August 2026 is kept", cap.kept.includes("08-2026"));
  ok("every 2025 month is kept", ["01-2025", "09-2025"].every((c) => cap.kept.includes(c)));
  eq("nothing else was dropped", cap.kept.length, ALL_COLS.length - 1);

  const july = capDateColumns(ALL_COLS, 2026, 7);
  same("a July report drops August AND September", july.excluded, ["08-2026", "09-2026"]);

  const noPeriod = capDateColumns(ALL_COLS, 0, 0);
  eq("no period given is a no-op", noPeriod.kept.length, ALL_COLS.length);
  const odd = capDateColumns([...ALL_COLS, "Not a month"], 2026, 8);
  ok("a column that is not a month is kept", odd.kept.includes("Not a month"));

  console.log("buildDateContext");
  const ctx = main2026Aug();
  eq("current month is August", ctx.currentMonthCol, "08-2026");
  eq("last month is July", ctx.lastMonthCol, "07-2026");
  eq("same month last year is Aug 2025", ctx.sameMonthLyCol, "08-2025");
  eq("YTD covers Jan-Aug 2026", ctx.currentYearCols.length, 8);
  eq("LY YTD covers Jan-Aug 2025", ctx.lyYtdCols.length, 8);
  ok("YTD excludes September", !ctx.currentYearCols.includes("09-2026"));

  // The bug, reproduced: the same data with no period ref.
  const old = buildDateContext(ALL_COLS);
  eq("WITHOUT a period ref current month is September (the bug)", old.currentMonthCol, "09-2026");
  eq("WITHOUT a period ref last month is August (the bug)", old.lastMonthCol, "08-2026");

  /* A report month with nothing loaded yet must read zero, not borrow July.
     Silently showing another month's figures under an August heading is the
     same failure this whole fix is about. */
  const missing = buildDateContext(capDateColumns(ALL_COLS, 2026, 10).kept, { year: 2026, month: 10 });
  eq("a month with no data has no current-month column", missing.currentMonthCol, null);
  eq("...and does not fall back to the latest month present", missing.lastMonthCol, "09-2026");

  console.log("Sales figures");
  const rows = [row()];
  const levels = buildSalesSummary(rows, ctx);
  const vendorLevel = levels.find((l) => l.level === "Vendor")!;
  const v = vendorLevel.volumeRows[0];
  eq("current month = August's 10 units, not September's 1", v.currentMonth, 10);
  eq("last month = July's 10 units", v.lastMonth, 10);
  eq("YTD = Jan-Aug only (8 x 10)", v.ytd, 80);
  eq("LY YTD = Jan-Aug 2025 (8 x 10)", v.lyYtd, 80);

  const oldLevels = buildSalesSummary(rows, buildDateContext(ALL_COLS));
  eq("the bug: current month would have been September's 1 unit",
    oldLevels.find((l) => l.level === "Vendor")!.volumeRows[0].currentMonth, 1);
  eq("the bug: YTD would have run to September (8 x 10 + 1)",
    oldLevels.find((l) => l.level === "Vendor")!.volumeRows[0].ytd, 81);

  console.log("Workbook");
  const buf = await buildMonthEndWorkbook(
    levels, {} as OOSSummary, [], "TEST CLIENT", "MAKRO", "Aug 2026 Wk4",
    rows, cap.kept, undefined, [], undefined, undefined, ["sales", "data"],
    undefined, undefined, undefined, [],
    { year: 2026, month: 8, excludedMonths: cap.excluded },
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const data = wb.getWorksheet("Data")!;
  const headers: string[] = [];
  for (let c = 1; c <= data.columnCount; c++) headers.push(String(data.getCell(1, c).value ?? ""));
  ok("Data sheet has no 09-2026 column", !headers.includes("09-2026"), headers.join(","));
  ok("Data sheet still has 08-2026", headers.includes("08-2026"));

  const menu = wb.getWorksheet("Menu")!;
  let excludedLine = "";
  for (let r = 1; r <= 20; r++) {
    if (String(menu.getCell(r, 1).value ?? "") === "Months excluded") excludedLine = String(menu.getCell(r, 2).value ?? "");
  }
  ok("the Menu says which months were left out", excludedLine.includes("Sep 2026"), excludedLine);

  const sales = wb.getWorksheet("Sales")!;
  // Row 5 is the first Vendor volume row — see the header block in buildSalesSummary.
  eq("Sales sheet current month cell", sales.getCell(5, 5).value, 10);
  eq("Sales sheet last month cell", sales.getCell(5, 7).value, 10);
  eq("Sales sheet YTD cell", sales.getCell(5, 3).value, 80);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
