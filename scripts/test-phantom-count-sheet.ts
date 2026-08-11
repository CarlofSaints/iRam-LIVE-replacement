/* Phantom stock count sheet — build it, reopen it, assert what's inside.
   Run: npx tsx scripts/test-phantom-count-sheet.ts                          */

import ExcelJS from "exceljs";
import { effectiveDsc, NO_COVER, type StoreLine, type StoreLineFlags } from "../lib/storeReport";
import { buildPhantomCountWorkbook, phantomSheetFileName, vendorLabelFor, type PhantomSheetMeta } from "../lib/phantomCountSheet";

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
    clientId: "c1", clientName: "USABCO", vendorName: "ADDIS", vendorProdCode: "9514",
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
  line({ article: "620983", vendor: "1449", vendorName: "RUSTOLEUM", soh: 3, prst: "(blank)" }),
  line({ article: "457882", vendor: "1449", vendorName: "RUSTOLEUM", soh: 62.5 }),
  line({ article: "999001", vendor: "", vendorName: "", soh: 2 }),   // no vendor — must still be counted
];

const META: PhantomSheetMeta = {
  storeName: "BWH RIVONIA-B50", siteCode: "B50", subChannel: "BWH", province: "GAUTENG",
  periodLabel: "Wk 2 · Aug 2026", generatedAt: "11 Aug 2026 at 14:20",
  vendorLabel: "ALL", repName: "J. Nkosi", mode: "empty",
};

// Column order, 1-indexed, matching the sheet the teams already print —
// plus Vendor / Vendor Name at the front, minus STO.
const HEADERS = [
  "Vendor", "Vendor Name", "Article", "Barcode", "Vend. Prod.", "Material Description",
  "Date Last Sold", "Last Recpt Y/M", "Act DSC", "Stk Margin", "PR ST", "SOH",
  "Count 1", "Count 2", "Comment",
];
const C = (name: string) => HEADERS.indexOf(name) + 1;

async function reopen(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

async function main() {
  console.log("\n── effectiveDsc: the column must never be blank ─────────");
  {
    // The retailer blanks Act DSC when it has no rate of sale to divide by. A
    // blank beside real stock reads as "no data" when the truth is the opposite.
    eq("the DISPO's own value wins when present", effectiveDsc({ actDsc: 360, soh: 4, dros: 2 }), 360);
    eq("blank + a rate of sale → we do the division ourselves", effectiveDsc({ actDsc: null, soh: 40, dros: 2 }), 20);
    eq("rounds to whole days", effectiveDsc({ actDsc: null, soh: 10, dros: 3 }), 3);
    eq("blank + NO rate of sale → the placeholder", effectiveDsc({ actDsc: null, soh: 11, dros: 0 }), NO_COVER);
    eq("placeholder is 9999", NO_COVER, 9999);
    // A sliver of a rate of sale over real stock computes to tens of thousands
    // of days; that means the same thing as "never", so it reads the same.
    eq("absurd cover is clamped to the placeholder", effectiveDsc({ actDsc: null, soh: 5000, dros: 0.01 }), NO_COVER);
    // Guard the other direction: no stock is NO cover, not endless cover.
    eq("no stock is zero cover, not 9999", effectiveDsc({ actDsc: null, soh: 0, dros: 0 }), 0);
    eq("a real zero from the DISPO is kept", effectiveDsc({ actDsc: 0, soh: 4, dros: 0 }), 0);
  }

  console.log("\n── vendorLabelFor ───────────────────────────────────────");
  {
    eq("number and name", vendorLabelFor("1063", "ADDIS"), "1063 — ADDIS");
    eq("falls back to the bare number", vendorLabelFor("1063", ""), "1063");
    eq("no vendor at all", vendorLabelFor("", ""), "No vendor");
  }

  console.log("\n── One sheet, empty (no counts) ─────────────────────────");
  {
    const buf = await buildPhantomCountWorkbook(LINES, META, { oneSheet: true });
    const wb = await reopen(buf);
    eq("one worksheet", wb.worksheets.length, 1);
    const ws = wb.worksheets[0];
    eq("sheet name", ws.name, "Stock Count");

    const head = ws.getRow(5);
    const got = HEADERS.map((_, i) => String(head.getCell(i + 1).value ?? ""));
    ok("column headers match the legacy sheet (+Vendor/Vendor Name, −STO)",
      JSON.stringify(got) === JSON.stringify(HEADERS), got.join("|"));
    ok("STO column is absent", !got.includes("STO"));

    eq("row count = lines", ws.rowCount - 5, LINES.length);

    // Sorted by Article ASCENDING, NUMERICALLY — so 999001 precedes 850023056
    // (999 thousand is less than 850 million). A plain string sort would put the
    // 9-digit code first, which reads wrong on a sheet of mixed-length articles.
    const articles = [];
    for (let r = 6; r <= ws.rowCount; r++) articles.push(String(ws.getRow(r).getCell(C("Article")).value ?? ""));
    ok("sorted by article ascending, numerically",
      JSON.stringify(articles) === JSON.stringify(["192247", "457882", "620983", "999001", "850023056"]),
      articles.join(","));

    eq("vendor number present", String(ws.getRow(6).getCell(C("Vendor")).value ?? ""), "1063");
    eq("vendor NAME present beside it", String(ws.getRow(6).getCell(C("Vendor Name")).value ?? ""), "ADDIS");

    // Act DSC must be populated on EVERY row — that is the whole point.
    let blankDsc = 0;
    for (let r = 6; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(C("Act DSC")).value == null) blankDsc++;
    eq("Act DSC is never blank", blankDsc, 0);

    // Count 1 must be EMPTY in "empty" mode — this is the whole point of that mode.
    let count1Filled = 0, count2Filled = 0;
    for (let r = 6; r <= ws.rowCount; r++) {
      if (ws.getRow(r).getCell(C("Count 1")).value != null) count1Filled++;
      if (ws.getRow(r).getCell(C("Count 2")).value != null) count2Filled++;
    }
    eq("Count 1 blank on every row", count1Filled, 0);
    eq("Count 2 blank on every row", count2Filled, 0);

    // Barcode must survive as TEXT, not 6.00E+12.
    const bc = ws.getRow(6).getCell(C("Barcode"));
    eq("barcode kept as text", String(bc.value), "6001246617315");
    eq("barcode number format is text", bc.numFmt, "@");

    eq("Last Recpt rendered as Y/M", String(ws.getRow(6).getCell(C("Last Recpt Y/M")).value), "2025/05");
    // Quantity columns carry NO thousands separator — Carl's call. A comma in a
    // hand-read unit count reads as a decimal separator to half the world.
    for (const name of ["SOH", "Count 1", "Count 2"]) {
      const fmt = String(ws.getRow(6).getCell(C(name)).numFmt ?? "");
      ok(`${name} has no thousands separator`, !fmt.includes(","), `numFmt "${fmt}"`);
    }
    eq("Stk Margin is a fraction with a % format", ws.getRow(6).getCell(C("Stk Margin")).numFmt, "0%");
    ok("header block names the store", String(ws.getCell("A2").value).includes("BWH RIVONIA-B50"));
    ok("header block names the vendor scope", String(ws.getCell("A3").value).includes("Vendor: ALL"));
    ok("note explains the 9999 placeholder", String(ws.getCell("A4").value).includes("9999"));
    // exceljs types `views` as a union; only the frozen variant carries ySplit.
    // Reading it back off a REOPENED file is the point — a freeze that only
    // existed in memory would read as undefined here.
    const view = ws.views?.[0] as { state?: string; ySplit?: number } | undefined;
    ok("frozen below the header row on reopen", view?.state === "frozen" && view?.ySplit === 5,
      JSON.stringify(view));
    ok("header row repeats when printed", ws.pageSetup?.printTitlesRow === "5:5");
    ok("autofilter set over the table", !!ws.autoFilter);
    ok("(blank) PR ST is emptied, not printed",
      String(ws.getRow(8).getCell(C("PR ST")).value ?? "") !== "(blank)");
  }

  console.log("\n── Act DSC on the sheet, computed and placeholder ───────");
  {
    const mixed: StoreLine[] = [
      line({ article: "100", vendor: "1063", actDsc: 360, soh: 4, dros: 1 }),      // from the DISPO
      line({ article: "200", vendor: "1063", actDsc: null, soh: 40, dros: 2 }),    // computed → 20
      line({ article: "300", vendor: "1063", actDsc: null, soh: 11, dros: 0 }),    // nothing selling → 9999
    ];
    const ws = (await reopen(await buildPhantomCountWorkbook(mixed, META, { oneSheet: true }))).worksheets[0];
    const dscFor = (article: string) => {
      for (let r = 6; r <= ws.rowCount; r++) {
        if (String(ws.getRow(r).getCell(C("Article")).value ?? "") === article) return ws.getRow(r).getCell(C("Act DSC")).value;
      }
      return "ROW NOT FOUND";
    };
    eq("DISPO value passes through", dscFor("100"), 360);
    eq("blank becomes our own SOH ÷ DROS", dscFor("200"), 20);
    eq("no rate of sale becomes 9999", dscFor("300"), NO_COVER);
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
        if (String(ws.getRow(r).getCell(C("Article")).value ?? "") === article) return ws.getRow(r).getCell(C("Count 1")).value;
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
    // Tabs carry the vendor NAME, not just the number — a row of bare numbers
    // along the bottom of Excel tells nobody which vendor they are looking at.
    ok("a tab per vendor, named and in vendor order",
      JSON.stringify(names) === JSON.stringify(["1063 — ADDIS", "1449 — RUSTOLEUM", "No vendor"]), names.join(","));
    eq("vendor 1063 has its 2 lines", wb.getWorksheet("1063 — ADDIS")!.rowCount - 5, 2);
    eq("vendor 1449 has its 2 lines", wb.getWorksheet("1449 — RUSTOLEUM")!.rowCount - 5, 2);
    eq("the vendorless line is not lost", wb.getWorksheet("No vendor")!.rowCount - 5, 1);
    ok("each tab names its own vendor in the header",
      String(wb.getWorksheet("1449 — RUSTOLEUM")!.getCell("A3").value).includes("Vendor: 1449 — RUSTOLEUM"));
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

    // A vendor name long enough to blow Excel's 31-char sheet-name cap.
    const longName = [line({ article: "1", vendor: "1063", vendorName: "A VERY LONG VENDOR NAME INDEED PTY LTD" })];
    const longWb = await reopen(await buildPhantomCountWorkbook(longName, META, { oneSheet: false }));
    ok("a long vendor name is truncated to a legal sheet name",
      longWb.worksheets[0].name.length <= 31, `"${longWb.worksheets[0].name}" (${longWb.worksheets[0].name.length})`);

    const f = phantomSheetFileName({ ...META, vendorLabel: "1063" }, new Date("2026-08-11T10:00:00Z"));
    ok("filename is safe + descriptive", f === "Phantom Stock Count - BWH RIVONIA-B50 - 1063 - 2026-08-11.xlsx", f);
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
