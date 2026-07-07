/* Weekly rep action-report workbook — what each rep ticked off as actioned,
   plus the DISPO-verification verdict once a fresh DISPO has re-checked it.
   Two sheets: Summary (per rep) + Detail (every claim). */

import ExcelJS from "exceljs";
import type { StoreReportClaim } from "./storeReportClaims";

const CAT_LABEL: Record<string, string> = {
  oos: "Out of Stock",
  lowCover: "Low Stock Cover",
  phantom: "Phantom",
  status: "Status",
  marginRisk: "Margin Risk",
  marginOpp: "Margin Opportunity",
};

function catList(cats: string[]): string {
  return cats.map((c) => CAT_LABEL[c] || c).join(", ");
}

function verdictLabel(c: StoreReportClaim): string {
  if (!c.verification) return "Pending next DISPO";
  return { consistent: "Consistent", suspect: "SUSPECT", inconclusive: "Inconclusive" }[c.verification.outcome];
}

const HEADER_FILL = "FF1C3D5A";  // navy
const SUSPECT_FILL = "FFFDECEC"; // light red

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 26;
}

export async function buildActionWorkbook(claims: StoreReportClaim[], rangeLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "iRam LIVE";

  // ── Summary sheet — per rep ──
  const summary = wb.addWorksheet("Summary");
  summary.addRow([`Weekly Rep Action Report — ${rangeLabel}`]).font = { bold: true, size: 14 };
  summary.addRow([]);
  const sHead = summary.addRow(["Rep", "Email", "Actions claimed", "Consistent", "Suspect", "Inconclusive", "Pending"]);
  styleHeader(sHead);

  const byRep = new Map<string, StoreReportClaim[]>();
  for (const c of claims) {
    const key = c.repEmail || c.repName || "(unknown)";
    (byRep.get(key) || byRep.set(key, []).get(key)!).push(c);
  }
  const repKeys = [...byRep.keys()].sort();
  for (const key of repKeys) {
    const list = byRep.get(key)!;
    const count = (pred: (c: StoreReportClaim) => boolean) => list.filter(pred).length;
    summary.addRow([
      list[0].repName || "—",
      list[0].repEmail || "—",
      list.length,
      count((c) => c.verification?.outcome === "consistent"),
      count((c) => c.verification?.outcome === "suspect"),
      count((c) => c.verification?.outcome === "inconclusive"),
      count((c) => !c.verification),
    ]);
  }
  summary.columns = [{ width: 22 }, { width: 30 }, { width: 15 }, { width: 12 }, { width: 10 }, { width: 13 }, { width: 10 }];
  summary.views = [{ state: "frozen", ySplit: 3 }];

  // ── Detail sheet — every claim ──
  const detail = wb.addWorksheet("Detail");
  const dHead = detail.addRow([
    "Rep", "Store", "Site", "Client", "Article", "Description", "Action(s)",
    "SOH at claim", "Claimed", "Verdict", "New SOH", "Gap (days)", "Notes",
  ]);
  styleHeader(dHead);

  const sorted = [...claims].sort(
    (a, b) => (a.repName || "").localeCompare(b.repName || "") || (a.storeName || "").localeCompare(b.storeName || ""),
  );
  for (const c of sorted) {
    const row = detail.addRow([
      c.repName || "—",
      c.storeName || c.siteCode,
      c.siteCode,
      c.clientName,
      c.article,
      c.description,
      catList(c.categories),
      c.soh,
      c.claimedAt ? c.claimedAt.slice(0, 10) : "",
      verdictLabel(c),
      c.verification ? c.verification.newSoh ?? "" : "",
      c.verification ? c.verification.gapDays : "",
      c.verification ? c.verification.note : "",
    ]);
    if (c.verification?.outcome === "suspect") {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUSPECT_FILL } };
      });
    }
  }
  detail.columns = [
    { width: 20 }, { width: 24 }, { width: 10 }, { width: 18 }, { width: 12 }, { width: 34 },
    { width: 20 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 10 }, { width: 11 }, { width: 52 },
  ];
  detail.getColumn(13).alignment = { wrapText: true, vertical: "top" };
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
