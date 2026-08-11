/* Phantom stock count sheet — build it, reopen it, assert what's inside.
   Run: npx tsx scripts/test-phantom-count-sheet.ts                          */

import ExcelJS from "exceljs";
import type { StoreLine, StoreLineFlags } from "../lib/storeReport";
import { buildPhantomCountWorkbook, phantomSheetFileName, type PhantomSheetMeta } from "../lib/phantomCountSheet";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const noFlags: StoreLineFlags = { oos: false, lowCover: false, phantom: true, status: false, marginRisk: false, marginOpp: false };

function line(p: Partial<StoreLine> & { article: string; vendor: string }): StoreLine {
  return {
    clientId: "c1", clientName: "USABCO", vendorProdCode: "9514",
    barcode: "6001246617315", productCode: p.article,
    description: "ADDIS FLOOR MOP REFILL TWIST", category: "HOUSEWARE",
    soh: 4, dros: 0, daysCover: null, actDsc: 360, stockMargin: 0.48,
    lastSold: "2025-11-01", lastReceived: "2025-05-14", lastSoldDays: 200, lastReceivedDays: 370,
    prst: "R", statusLabel: "", statusClass: "UNCLASSIFIED", vendorStatus: "Active",
    ranging: "", rpType: "", mac: null, nett: null, marginRiskRand: null, marginOppRand: null,
    sellPrice: null, stkMargin: null, prodMargin: null, rrp: null,
    flags: { ...noFlags },
    ...p,
  } as StoreLine;
}

const LINES: StoreLine[] = [
  line({ article: "850023056", vendor: "1063", soh: 1 }),
  line({ article: "192247", vendor: "1063", soh: 4 }),
  line({ article: "620983", vendor: "1449", soh: 3, prst: "(blank)" }),
  line({ article: "457882", vendor: "1449", soh: 62.5 }),
  line({ article: "999001", vendor: "", soh: 2 }),          // no vendor — must still be counted
];

const META: PhantomSheetMeta = {
  storeName: "BWH RIVONIA-B50", siteCode: "B50", subChannel: "BWH", province: "GAUTENG",
  periodLabel: "Wk 2 · Aug 2026", generatedAt: "11 Aug 2026 at 14:20",
  vendorLabel: "ALL", repName: "J. Nkosi", mode: "empty",
};

const HEADERS = [
  "Vendor", "Article", "Barcode", "Vend. Prod.", "Material Description",
  "Date Last Sold", "Last Recpt Y/M", "Act DSC", "Stk Margin", "PR ST", "SOH",
  "Count 1", "Count 2", "Comment",
];

async function reopen(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

async function main() {
  console.log("\n── One sheet, empty (no counts) ─────────────────────────");
  {
    const buf = await buildPhantomCountWorkbook(LINES, META, { oneSheet: true });
    const wb = await reopen(buf);
    eq("one worksheet", wb.worksheets.length, 1);
    const ws = wb.worksheets[0];
    eq("sheet name", ws.name, "Stock Count");

    const head = ws.getRow(5);
    const got = HEADERS.map((_, i) => String(head.getCell(i + 1).value ?? ""));
    ok("column headers match the legacy sheet (+Vendor, −STO)", JSON.stringify(got) === JSON.stringify(HEADERS), got.join("|"));
    ok("STO column is absent", !got.includes("STO"));

    eq("row count = lines", ws.rowCount - 5, LINES.length);

    // Sorted by Article ASCENDING, NUMERICALLY — so 999001 precedes 850023056
    // (999 thousand is less than 850 million). A plain string sort would put the
    // 9-digit code first, which reads wrong on a sheet of mixed-length articles.
    const articles = [];
    for (let r = 6; r <= ws.rowCount; r++) articles.push(String(ws.getRow(r).getCell(2).value ?? ""));
    ok("sorted by article ascending, numerically",
      JSON.stringify(articles) === JSON.stringify(["192247", "457882", "620983", "999001", "850023056"]),
      articles.join(","));

    // Count 1 must be EMPTY in "empty" mode — this is the whole point of that mode.
    let count1Filled = 0;
    for (let r = 6; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(12).value != null) count1Filled++;
    eq("Count 1 blank on every row", count1Filled, 0);
    let count2Filled = 0;
    for (let r = 6; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(13).value != null) count2Filled++;
    eq("Count 2 blank on every row", count2Filled, 0);

    // Barcode must survive as TEXT, not 6.00E+12.
    const bc = ws.getRow(6).getCell(3);
    eq("barcode kept as text", String(bc.value), "6001246617315");
    eq("barcode number format is text", bc.numFmt, "@");

    eq("Last Recpt rendered as Y/M", String(ws.getRow(6).getCell(7).value), "2025/05");
    eq("Stk Margin is a fraction with a % format", ws.getRow(6).getCell(9).numFmt, "0%");
    ok("header block names the store", String(ws.getCell("A2").value).includes("BWH RIVONIA-B50"));
    ok("header block names the vendor scope", String(ws.getCell("A3").value).includes("Vendor: ALL"));
    // exceljs types `views` as a union; only the frozen variant carries ySplit.
    // Reading it back off a REOPENED file is the point — a freeze that only
    // existed in memory would read as undefined here.
    const view = ws.views?.[0] as { state?: string; ySplit?: number } | undefined;
    ok("frozen below the header row on reopen", view?.state === "frozen" && view?.ySplit === 5,
      JSON.stringify(view));
    ok("header row repeats when printed", ws.pageSetup?.printTitlesRow === "5:5");
    ok("autofilter set over the table", !!ws.autoFilter);
    ok("(blank) PR ST is emptied, not printed", String(ws.getRow(8).getCell(10).value ?? "") !== "(blank)");
  }

  console.log("\n── One sheet, WITH count submissions ────────────────────");
  {
    const counts = { "c1|192247": 4, "c1|457882": 62.5, "c1|999001": 0 };
    const buf = await buildPhantomCountWorkbook(LINES, { ...META, mode: "counts" }, { oneSheet: true, counts });
    const ws = (await reopen(buf)).worksheets[0];
    // Address rows by ARTICLE, not by index — an index assertion silently moves
    // when the sort changes and then tests the wrong line.
    const count1For = (article: string) => {
      for (let r = 6; r <= ws.rowCount; r++) {
        if (String(ws.getRow(r).getCell(2).value ?? "") === article) return ws.getRow(r).getCell(12).value;
      }
      return "ROW NOT FOUND";
    };
    eq("counted line 192247 → Count 1", count1For("192247"), 4);
    eq("decimal count survives (rope by the metre)", count1For("457882"), 62.5);
    // A genuine ZERO count is the most important result on the sheet — "we found
    // none" is the finding. It must not be dropped as falsy.
    eq("a ZERO count is written, not dropped", count1For("999001"), 0);
    eq("uncounted line stays blank", count1For("620983"), null);
  }

  console.log("\n── Split: a tab per vendor ──────────────────────────────");
  {
    const buf = await buildPhantomCountWorkbook(LINES, META, { oneSheet: false });
    const wb = await reopen(buf);
    const names = wb.worksheets.map((w) => w.name);
    ok("one tab per vendor, vendor order", JSON.stringify(names) === JSON.stringify(["1063", "1449", "No vendor"]), names.join(","));
    eq("vendor 1063 has its 2 lines", wb.getWorksheet("1063")!.rowCount - 5, 2);
    eq("vendor 1449 has its 2 lines", wb.getWorksheet("1449")!.rowCount - 5, 2);
    eq("the vendorless line is not lost", wb.getWorksheet("No vendor")!.rowCount - 5, 1);
    ok("each tab names its own vendor in the header", String(wb.getWorksheet("1449")!.getCell("A3").value).includes("Vendor: 1449"));
  }

  console.log("\n── Edge cases ───────────────────────────────────────────");
  {
    // Excel refuses to open a workbook with no sheets — an empty selection must
    // still produce a readable "nothing to count" sheet, in both layouts.
    const one = await reopen(await buildPhantomCountWorkbook([], META, { oneSheet: true }));
    eq("empty selection, one-sheet → still a sheet", one.worksheets.length, 1);
    ok("says there is nothing to count", String(one.worksheets[0].getCell("A6").value ?? "").includes("No phantom lines"));

    const split = await reopen(await buildPhantomCountWorkbook([], META, { oneSheet: false }));
    eq("empty selection, split → still a sheet", split.worksheets.length, 1);

    const f = phantomSheetFileName({ ...META, vendorLabel: "1063" }, new Date("2026-08-11T10:00:00Z"));
    ok("filename is safe + descriptive", f === "Phantom Stock Count - BWH RIVONIA-B50 - 1063 - 2026-08-11.xlsx", f);
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
