/* The Phantom sheet of the Month-End report listed a product code and an
   article number but never said what the product WAS — every other detail
   sheet in the same workbook (OOS Detail, DSC Detail, Status Detail) carries a
   Description column and Phantom did not. A phantom line is an instruction to
   go and look for stock on a shelf, so a row nobody can identify is a row
   nobody can action.

   Inserting a column in the middle of a grid that writes its cells by NUMBER
   is the risky part: get it wrong and every column after Description silently
   shifts, which reads as "the dates are broken" rather than "a column moved".
   So this builds the real workbook, reopens it, and asserts the whole header
   row and a full data row — not just the new cell.

   Run: npx tsx scripts/test-phantom-description.ts                          */

import ExcelJS from "exceljs";
import { buildPhantomAnalysis } from "../lib/monthEndReport";
import { buildMonthEndWorkbook } from "../lib/monthEndExcel";
import type { OOSSummary } from "../lib/monthEndReport";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const REF = new Date(Date.UTC(2026, 7, 31)); // 31 Aug 2026

/* Three rows that are all phantom (stock on hand, nothing sold or received
   since 2024) and differ only in where their description can come from. */
const ROWS: Record<string, unknown>[] = [
  {
    "Site": "S117", "_storeName": "GREENSTONE", "Article": "850023056",
    "Article Desc": "ADDIS FLOOR MOP REFILL TWIST", "_productDescription": "PMF NAME, NOT USED",
    "_clientProductId": "CP-1", "_vendor": "1063", "PR ST": "R", "_productStatus": "ACTIVE",
    "SOH": 4, "Last Sold": "01/11/2024", "Last Recv": "14/05/2024",
  },
  {
    // DISPO description blank — the PMF name must fill in rather than a blank
    "Site": "S118", "_storeName": "WOODMEAD", "Article": "192247",
    "Article Desc": "", "_productDescription": "ADDIS BUCKET 10L",
    "_clientProductId": "CP-2", "_vendor": "1063", "PR ST": "Z4", "_productStatus": "DELISTED",
    "SOH": 2, "Last Sold": "", "Last Recv": "",
  },
  {
    // Neither source has a description — the cell is empty, and the row must
    // still line up
    "Site": "S119", "_storeName": "CENTURION", "Article": "620983",
    "_clientProductId": "CP-3", "_vendor": "1449", "PR ST": "", "_productStatus": "ACTIVE",
    "SOH": 7, "Last Sold": "03/02/2024", "Last Recv": "09/01/2024",
  },
];

async function main() {
  const analysis = buildPhantomAnalysis(ROWS, {
    referenceDate: REF, lastSoldMonths: 6, lastReceivedMonths: 6,
  });

  console.log("Analysis");
  eq("all three rows are phantom", analysis.phantomLines, 3);
  const byArticle = new Map(analysis.detail.map((d) => [d.article, d]));
  eq("DISPO description wins", byArticle.get("850023056")?.description, "ADDIS FLOOR MOP REFILL TWIST");
  eq("PMF description fills a blank DISPO one", byArticle.get("192247")?.description, "ADDIS BUCKET 10L");
  eq("no description anywhere stays empty", byArticle.get("620983")?.description, "");

  const buf = await buildMonthEndWorkbook(
    [], {} as OOSSummary, [], "TEST CLIENT", "MASSBUILD", "Aug 2026 Wk3",
    [], [], undefined, [], undefined, analysis, ["phantom"],
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet("Phantom");

  console.log("Workbook");
  ok("Phantom sheet exists", !!sheet);
  if (!sheet) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

  /* Headers carry an emoji prefix from HEADER_ICONS ("🏢 Vendor"), so compare
     on the text after it. */
  const label = (r: number, c: number) =>
    String(sheet.getCell(r, c).value ?? "").replace(/^[^A-Za-z]+/, "").trim();

  // Find the detail header row by its first cell rather than by arithmetic —
  // the layout above the grid grows with the number of PMF statuses.
  let headerRow = 0;
  for (let r = 1; r <= sheet.rowCount; r++) {
    if (label(r, 1) === "Vendor") { headerRow = r; break; }
  }
  ok("detail header row found", headerRow > 0);

  const headers = ["Vendor", "Site", "Site Name", "Product Code", "Article", "Description",
    "PR ST", "Product Status", "SOH", "Date Last Sold", "Date Last Received"];
  headers.forEach((h, i) => {
    eq(`header ${i + 1} is ${h}`, label(headerRow, i + 1), h);
  });
  eq("nothing written past the last header",
    String(sheet.getCell(headerRow, headers.length + 1).value ?? ""), "");

  /* The full row, so a shifted column is caught by the value that landed in
     the wrong place, not only by the missing one. Rows are sorted by site
     name, so CENTURION comes first. */
  const first = headerRow + 1;
  eq("row 1 vendor", String(sheet.getCell(first, 1).value ?? ""), "1449");
  eq("row 1 site", String(sheet.getCell(first, 2).value ?? ""), "S119");
  eq("row 1 site name", String(sheet.getCell(first, 3).value ?? ""), "CENTURION");
  eq("row 1 product code", String(sheet.getCell(first, 4).value ?? ""), "CP-3");
  eq("row 1 article", String(sheet.getCell(first, 5).value ?? ""), "620983");
  eq("row 1 description is empty", String(sheet.getCell(first, 6).value ?? ""), "");
  eq("row 1 PR ST", String(sheet.getCell(first, 7).value ?? ""), "(blank)");
  eq("row 1 product status", String(sheet.getCell(first, 8).value ?? ""), "ACTIVE");
  eq("row 1 SOH is still a number", sheet.getCell(first, 9).value, 7);
  ok("row 1 last sold is still a date", sheet.getCell(first, 10).value instanceof Date,
    JSON.stringify(sheet.getCell(first, 10).value));
  ok("row 1 last received is still a date", sheet.getCell(first, 11).value instanceof Date,
    JSON.stringify(sheet.getCell(first, 11).value));

  // The descriptions themselves, on the rows that have one.
  const descByArticle = new Map<string, string>();
  for (let r = first; r < first + analysis.detail.length; r++) {
    descByArticle.set(String(sheet.getCell(r, 5).value ?? ""), String(sheet.getCell(r, 6).value ?? ""));
  }
  eq("sheet shows the DISPO description", descByArticle.get("850023056"), "ADDIS FLOOR MOP REFILL TWIST");
  eq("sheet shows the PMF fallback", descByArticle.get("192247"), "ADDIS BUCKET 10L");

  /* The filter must cover the new column, or Description is the one field
     nobody can filter on. Reopened workbooks give the range back as a string
     ("A11:K12"), not the {from,to} object it was written with. */
  const af = String(sheet.autoFilter ?? "");
  const lastCol = af.split(":")[1]?.replace(/\d+/g, "") ?? "";
  eq("autofilter reaches the last column", lastCol, "K");   // K = 11th column
  eq("autofilter starts at the header row", af.split(":")[0], `A${headerRow}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
