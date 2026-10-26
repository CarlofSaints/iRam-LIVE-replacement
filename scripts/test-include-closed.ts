/* Month-End "Include closed stores?" (26 Oct 2026). NO = today's rule, every
   closed-store line left out. YES = closed-store lines with stock or sales this
   year come back; a closed store with neither stays out.

   Run: npx tsx scripts/test-include-closed.ts                                 */

import { applyReportExclusions, exclusionLabel } from "../lib/reportExclusions";

let fails = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails++;
};
const cols = ["09-2026", "09-2025"];
const rows = [
  { id: "open", _storeStatus: "ACTIVE", SOH: 0, "09-2026": 0 },
  { id: "closedStock", _storeStatus: "CLOSED", SOH: 5, "09-2026": 0 },
  { id: "closedSales", _storeName: "GAME X (CLOSED)", SOH: 0, "09-2026": 3 },
  { id: "closedLySalesOnly", _storeStatus: "CLOSED", SOH: 0, "09-2026": 0, "09-2025": 9 },
  { id: "closedEmpty", _storeStatus: "CLOSED", SOH: 0, "09-2026": 0 },
];
const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id).join(",");

const no = applyReportExclusions(rows, cols, 2026);
check("NO: only the open store", ids(no) === "open", ids(no));
check("NO: 4 closed lines left out", no.closedStoreLines === 4 && no.closedStoreLinesKept === 0, no);
check("NO: label unchanged", exclusionLabel(no, 2026) === "4 lines at closed stores", exclusionLabel(no, 2026));

const yes = applyReportExclusions(rows, cols, 2026, { includeClosed: true });
check("YES: stock + this-year sales come back", ids(yes) === "open,closedStock,closedSales", ids(yes));
check("YES: LY-only and empty stay out", yes.closedStoreLines === 2 && yes.closedStoreLinesKept === 2, yes);
check("YES: label says both", exclusionLabel(yes, 2026) ===
  "2 lines at closed stores with no stock and no sales (closed stores included: 2 lines with stock or 2026 sales)", exclusionLabel(yes, 2026));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
