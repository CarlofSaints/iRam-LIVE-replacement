/* Generates a SAMPLE store report (email + hosted action page) using the real
   renderers with synthetic data — no login, no Blob, no DISPO required.
   Run: npx tsx scripts/make-sample-store-report.ts
   Output: sample-store-report-email.html + sample-store-report-page.html      */

import { writeFileSync } from "fs";
import { join } from "path";
import type { StoreReport, StoreLine, StoreLineFlags } from "../lib/storeReport";
import { renderStoreReportEmail } from "../lib/storeReportEmail";
import { renderStoreReportPage } from "../lib/storeReportPage";

const CLIENT_ID = "sample-client";
const CLIENT_NAME = "USABCO";

const noFlags: StoreLineFlags = {
  oos: false, lowCover: false, phantom: false,
  status: false, marginRisk: false, marginOpp: false,
};

function line(p: Partial<StoreLine> & { article: string; description: string }): StoreLine {
  return {
    clientId: CLIENT_ID,
    clientName: CLIENT_NAME,
    vendor: "1063",
    vendorProdCode: "VP" + p.article.slice(-5),
    barcode: "600" + Math.abs(hash(p.article)).toString().padStart(10, "0").slice(0, 10),
    productCode: p.article,
    category: "HOUSEWARE",
    soh: 0, dros: 0, daysCover: null,
    actDsc: 360, stockMargin: 0.38,
    lastSold: "", lastReceived: "", lastSoldDays: null, lastReceivedDays: null,
    prst: "A", statusLabel: "Active", statusClass: "POSITIVE",
    vendorStatus: "Active", ranging: "TRUE", rpType: "RP",
    mac: null, nett: null, marginRiskRand: null, marginOppRand: null,
    sellPrice: null, stkMargin: null, prodMargin: null, rrp: null,
    flags: { ...noFlags },
    ...p,
  } as StoreLine;
}

// tiny deterministic hash so barcodes look real but are stable run-to-run
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const lines: StoreLine[] = [
  // ── Out of stock ──────────────────────────────────────────────
  line({
    article: "40012877", description: "STAINLESS STEEL STOCK POT 24CM",
    soh: 0, dros: 1.4, daysCover: 0, lastSold: "2026-08-04", lastSoldDays: 7,
    lastReceived: "2026-06-19", lastReceivedDays: 53,
    mac: 189.5, nett: 182.0, sellPrice: 349.99,
    flags: { ...noFlags, oos: true },
  }),
  line({
    article: "40013204", description: "NON-STICK FRY PAN 28CM",
    soh: 0, dros: 2.1, daysCover: 0, lastSold: "2026-08-06", lastSoldDays: 5,
    lastReceived: "2026-07-02", lastReceivedDays: 40,
    mac: 142.0, nett: 138.5, sellPrice: 259.99,
    flags: { ...noFlags, oos: true },
  }),
  line({
    article: "40011455", description: "CAST IRON POTJIE NO.3",
    soh: 0, dros: 0.8, daysCover: 0, lastSold: "2026-08-01", lastSoldDays: 10,
    lastReceived: "2026-05-28", lastReceivedDays: 75,
    mac: 410.0, nett: 399.0, sellPrice: 749.99,
    flags: { ...noFlags, oos: true },
  }),
  line({
    article: "40014901", description: "GLASS STORAGE SET 5PC",
    soh: 0, dros: 1.9, daysCover: 0, lastSold: "2026-08-07", lastSoldDays: 4,
    lastReceived: "2026-07-11", lastReceivedDays: 31,
    mac: 96.0, nett: 92.5, sellPrice: 179.99,
    flags: { ...noFlags, oos: true },
  }),
  line({
    article: "40010338", description: "ELECTRIC KETTLE 1.7L BRUSHED",
    soh: 0, dros: 3.2, daysCover: 0, lastSold: "2026-08-08", lastSoldDays: 3,
    lastReceived: "2026-06-30", lastReceivedDays: 42,
    mac: 218.0, nett: 210.0, sellPrice: 399.99,
    flags: { ...noFlags, oos: true },
  }),

  // ── Low stock cover ───────────────────────────────────────────
  line({
    article: "40012001", description: "MIXING BOWL SET 3PC",
    soh: 4, dros: 0.9, daysCover: 4.4, lastSold: "2026-08-09", lastSoldDays: 2,
    lastReceived: "2026-07-24", lastReceivedDays: 18,
    mac: 88.0, nett: 84.0, sellPrice: 169.99,
    flags: { ...noFlags, lowCover: true },
  }),
  line({
    article: "40013777", description: "KNIFE BLOCK SET 6PC",
    soh: 6, dros: 0.7, daysCover: 8.6, lastSold: "2026-08-05", lastSoldDays: 6,
    lastReceived: "2026-07-30", lastReceivedDays: 12,
    mac: 265.0, nett: 258.0, sellPrice: 499.99,
    flags: { ...noFlags, lowCover: true },
  }),
  line({
    article: "40015002", description: "PRESSURE COOKER 6L",
    soh: 3, dros: 0.45, daysCover: 6.7, lastSold: "2026-08-03", lastSoldDays: 8,
    lastReceived: "2026-07-18", lastReceivedDays: 24,
    mac: 520.0, nett: 505.0, sellPrice: 949.99,
    flags: { ...noFlags, lowCover: true },
  }),

  // ── Phantom stock (SOH on hand, nothing moving) ───────────────
  line({
    article: "40009911", description: "ENAMEL BAKE DISH 32CM",
    soh: 11, dros: 0.02, daysCover: 550, lastSold: "2026-04-02", lastSoldDays: 131,
    lastReceived: "2026-03-15", lastReceivedDays: 149,
    mac: 132.0, nett: 128.0, sellPrice: 239.99,
    flags: { ...noFlags, phantom: true },
  }),
  line({
    article: "40008120", description: "SERVING PLATTER OVAL WHITE",
    soh: 7, dros: 0.01, daysCover: 700, lastSold: "2026-03-21", lastSoldDays: 143,
    lastReceived: "2026-02-28", lastReceivedDays: 164,
    mac: 74.0, nett: 70.0, sellPrice: 139.99,
    flags: { ...noFlags, phantom: true },
  }),
  // A second vendor, so the sample exercises the vendor picker + the tab-per-vendor split.
  line({
    article: "40021002", description: "GARDEN HOSE 20M REINFORCED", vendor: "1449",
    soh: 14, dros: 0.03, daysCover: 466, lastSold: "2026-02-11", lastSoldDays: 181,
    lastReceived: "2026-01-30", lastReceivedDays: 193, actDsc: 999, stockMargin: 0.26,
    mac: 289.0, nett: 275.0, sellPrice: 549.99,
    flags: { ...noFlags, phantom: true },
  }),
  line({
    article: "40021777", description: "ROPE POLY 12MM (PER METRE)", vendor: "1449",
    soh: 62.5, dros: 0.04, daysCover: 999, lastSold: "2026-03-02", lastSoldDays: 162,
    lastReceived: "2026-01-14", lastReceivedDays: 209, actDsc: 999, stockMargin: 0.31,
    mac: 18.5, nett: 17.2, sellPrice: 34.99,
    flags: { ...noFlags, phantom: true },
  }),
  line({
    article: "40009450", description: "STORAGE CRATE 52L STACKABLE",
    soh: 23, dros: 0.02, daysCover: 999, lastSold: "2026-04-18", lastSoldDays: 115,
    lastReceived: "2026-03-02", lastReceivedDays: 162,
    mac: 109.0, nett: 104.0, sellPrice: 199.99,
    flags: { ...noFlags, phantom: true },
  }),

  // ── Status issues (selling but flagged discontinued) ──────────
  line({
    article: "40007744", description: "TRAVEL MUG 450ML STEEL",
    soh: 9, dros: 0.6, daysCover: 15, lastSold: "2026-08-08", lastSoldDays: 3,
    lastReceived: "2026-07-05", lastReceivedDays: 37,
    prst: "D", statusLabel: "Discontinued", statusClass: "NEGATIVE",
    vendorStatus: "Active", mac: 64.0, nett: 61.0, sellPrice: 119.99,
    flags: { ...noFlags, status: true },
  }),
  line({
    article: "40006590", description: "SALAD SPINNER LARGE",
    soh: 5, dros: 0.3, daysCover: 16.7, lastSold: "2026-08-02", lastSoldDays: 9,
    lastReceived: "2026-06-22", lastReceivedDays: 50,
    prst: "T", statusLabel: "To Be Deleted", statusClass: "NEGATIVE",
    vendorStatus: "Active", mac: 91.0, nett: 88.0, sellPrice: 169.99,
    flags: { ...noFlags, status: true },
  }),

  // ── Margin risk: store's cost (MAC) is ABOVE our nett ─────────
  line({
    article: "40016110", description: "AIR FRYER 5.5L DIGITAL",
    soh: 12, dros: 0.5, daysCover: 24, lastSold: "2026-08-09", lastSoldDays: 2,
    lastReceived: "2026-07-28", lastReceivedDays: 14,
    mac: 845.0, nett: 780.0, marginRiskRand: 12 * (845.0 - 780.0),
    sellPrice: 1499.99, stkMargin: 0.352, prodMargin: 0.402,
    flags: { ...noFlags, marginRisk: true },
  }),
  line({
    article: "40016344", description: "STAND MIXER 1200W",
    soh: 4, dros: 0.2, daysCover: 20, lastSold: "2026-08-06", lastSoldDays: 5,
    lastReceived: "2026-07-21", lastReceivedDays: 21,
    mac: 1980.0, nett: 1875.0, marginRiskRand: 4 * (1980.0 - 1875.0),
    sellPrice: 3299.99, stkMargin: 0.309, prodMargin: 0.346,
    flags: { ...noFlags, marginRisk: true },
  }),

  // ── Margin opportunity: MAC BELOW nett → room to drop price ───
  line({
    article: "40017055", description: "VACUUM FLASK 1L",
    soh: 18, dros: 0.8, daysCover: 22.5, lastSold: "2026-08-10", lastSoldDays: 1,
    lastReceived: "2026-07-15", lastReceivedDays: 27,
    mac: 128.0, nett: 149.0, marginOppRand: 18 * (149.0 - 128.0),
    sellPrice: 299.99, stkMargin: 0.508, prodMargin: 0.427, rrp: 264.99,
    flags: { ...noFlags, marginOpp: true },
  }),
  line({
    article: "40017890", description: "COOLER BOX 45L WHEELED",
    soh: 9, dros: 0.35, daysCover: 25.7, lastSold: "2026-08-07", lastSoldDays: 4,
    lastReceived: "2026-07-09", lastReceivedDays: 33,
    mac: 612.0, nett: 668.0, marginOppRand: 9 * (668.0 - 612.0),
    sellPrice: 1249.99, stkMargin: 0.457, prodMargin: 0.408, rrp: 1129.99,
    flags: { ...noFlags, marginOpp: true },
  }),
];

const counts = {
  oos: lines.filter((l) => l.flags.oos).length,
  lowCover: lines.filter((l) => l.flags.lowCover).length,
  phantom: lines.filter((l) => l.flags.phantom).length,
  status: lines.filter((l) => l.flags.status).length,
  marginRisk: lines.filter((l) => l.flags.marginRisk).length,
  marginOpp: lines.filter((l) => l.flags.marginOpp).length,
};

const report: StoreReport = {
  siteCode: "MW35",
  storeName: "MAKRO WOODMEAD",
  storeType: "MAKRO",
  subChannel: "MAKRO",
  province: "GAUTENG",
  clients: [{
    clientId: CLIENT_ID,
    clientName: CLIENT_NAME,
    asOf: "Wk 2 · Aug 2026",
    loadedAt: "2026-08-10T06:14:00.000Z",
  }],
  totalProducts: 214,
  counts,
  totalActions: lines.length,
  lines,
};

const meta = {
  periodLabel: "Wk 2 · Aug 2026",
  generatedAt: "11 Aug 2026 at 08:30",
  version: "iRam LIVE — SAMPLE",
};

const outDir = process.cwd();
const emailHtml = renderStoreReportEmail(report, {
  ...meta,
  repName: "Sample Rep",
  reportUrl: "./sample-store-report-page.html",
});
const pageHtml = renderStoreReportPage(report, {
  ...meta,
  reportId: "SAMPLE-MW35-2026-08-2",
  // Endpoints are absolute so the sample can be opened straight off disk: the
  // export panel and the Stock Found boxes render and behave, and the network
  // calls fail visibly against a live deploy rather than silently doing nothing.
  api: {
    countUrl: "https://i-ram-live-replacement.vercel.app/api/store-reports/phantom-count",
    exportUrl: "https://i-ram-live-replacement.vercel.app/api/store-reports/phantom-export",
    token: "SAMPLE-TOKEN",
  },
  // One line already counted, to show what a returning rep sees.
  savedCounts: { [`${CLIENT_ID}|40009911`]: 4 },
});

writeFileSync(join(outDir, "sample-store-report-email.html"), emailHtml);
writeFileSync(join(outDir, "sample-store-report-page.html"), pageHtml);

console.log("Wrote sample-store-report-email.html (%d KB)", Math.round(emailHtml.length / 1024));
console.log("Wrote sample-store-report-page.html  (%d KB)", Math.round(pageHtml.length / 1024));
console.log("Counts:", counts, "| total actions:", report.totalActions);
