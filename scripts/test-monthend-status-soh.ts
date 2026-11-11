/* Status sheet SOH column (11 Nov 2026, client ask). Sums SOH per PR ST and per
   PR ST × PMF status, and lands in the last column of both tables.
   Run: npx tsx scripts/test-monthend-status-soh.ts */
import ExcelJS from "exceljs";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import { buildStatusSummary } from "../lib/monthEndReport";

let failures = 0;
const assert = (label: string, cond: boolean, note = "") => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? `  — ${note}` : ""}`); };

const DATE_COLS = ["01-2026", "02-2026"];
const rows = [
  { Site: "A", Status: "N", _productStatus: "ACTIVE", "01-2026": 1, "02-2026": 1, SOH: 10 },
  { Site: "B", Status: "N", _productStatus: "ACTIVE", "01-2026": 1, "02-2026": 1, SOH: 5 },
  { Site: "C", Status: "D", _productStatus: "DELISTED", "01-2026": 0, "02-2026": 2, SOH: "" },
];
const s = buildStatusSummary(rows as any, DATE_COLS, [], []);
const n = s.prst.find((r) => r.prst === "N");
assert("PR ST N sums SOH", n?.soh === 15, String(n?.soh));
assert("blank SOH counts as 0", s.prst.find((r) => r.prst === "D")?.soh === 0);
assert("combo row sums SOH", s.prstByPmf.find((r) => r.prst === "N" && r.pmfStatus === "ACTIVE")?.soh === 15);

(async () => {
  const buf = await buildMonthEndWorkbook([], { stores: [], skus: [] } as any, [], "T", "C", "P", [], DATE_COLS, s, [], undefined, undefined, ["status"]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
  const sh = wb.getWorksheet("Status")!;
  const found: string[] = [];
  sh.eachRow((r, i) => r.eachCell((c, col) => { if (String(c.value).endsWith("SOH")) found.push(`${i}:${col}`); }));
  assert("SOH header in both tables (cols D and F)", found.length === 2 && found[0].endsWith(":4") && found[1].endsWith(":6"), found.join(","));
  process.exit(failures ? 1 : 0);
})();
