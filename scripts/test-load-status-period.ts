/* DISPO load status — the current period, not the upload window.

   Replays the 12 Aug 2026 situation that exposed the old rule: a week of heavy
   back-loading (109 files since Monday, 52 of them for Jun 2025 / Dec 2025 /
   Jan 2026) made the mail report 50 of 51 vendors loaded while the checklist
   showed 27 streams with no current-week DISPO.

   Run: npx tsx scripts/test-load-status-period.ts
*/

import { computeLoadStatus } from "../lib/loadStatus";
import type { UploadMeta, Client } from "../lib/types";
import type { StoreReportState } from "../lib/storeReportState";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

const NOW = new Date("2026-08-12T07:14:00Z"); // Wed 12 Aug, 09:14 SAST

function client(id: string, name: string, vendors: string[], active = true): Client {
  return { id, name, vendorNumbers: vendors, active, channelIds: [], linkedClientIds: [], controlFiles: {}, createdAt: "2026-01-01T00:00:00Z" } as unknown as Client;
}

let seq = 0;
function upload(o: {
  clientId: string; vendor: string; channelId: string; channelName: string;
  uploadDate: string; y: number; m: number; w: number;
}): UploadMeta {
  return {
    id: `u${++seq}`, clientId: o.clientId, clientName: "", channelId: o.channelId,
    channelName: o.channelName, fileType: "dispo", fileName: `f${seq}.xlsx`,
    uploadDate: o.uploadDate, uploadedBy: "x", uploadedByName: "x",
    vendorNumber: o.vendor, rowCount: 10, status: "processed",
    reportYear: o.y, reportMonth: o.m, reportWeek: o.w,
  } as unknown as UploadMeta;
}

const EMPTY_STATE: StoreReportState = { periods: {}, activePeriodKey: null } as unknown as StoreReportState;

// ── Scenario: two vendors. ACME loaded a real Aug-Wk1 DISPO. BETA only
//    back-loaded a December 2025 file, this morning. ─────────────────────
const clients = [client("c1", "ACME", ["100"]), client("c2", "BETA", ["200"])];
const uploads = [
  // history, so both vendors are known to load on MASSBUILD
  upload({ clientId: "c1", vendor: "100", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-07-06T08:00:00Z", y: 2026, m: 7, w: 1 }),
  upload({ clientId: "c2", vendor: "200", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-07-06T08:00:00Z", y: 2026, m: 7, w: 1 }),
  // the current week opens
  upload({ clientId: "c1", vendor: "100", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-08-11T06:00:00Z", y: 2026, m: 8, w: 1 }),
  // BETA's only upload this week is a back-load for December 2025
  upload({ clientId: "c2", vendor: "200", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-08-12T06:00:00Z", y: 2025, m: 12, w: 4 }),
];

const r = computeLoadStatus(uploads, clients, EMPTY_STATE, NOW);

eq(r.periodLabel, "Wk1 Aug 2026", "current period is the newest stamp");
eq(r.loadedVendors, 1, "only the vendor with a current-period DISPO is loaded");
eq(r.outstandingVendors, 1, "the back-load-only vendor is outstanding");
eq(r.outstanding.map((o) => o.vendorNumber), ["200"], "BETA is the one named");
eq(r.outstanding[0]?.missingChannels, ["MASSBUILD"], "its missing channel is named");
eq(r.loadsThisWeek, 2, "both uploads since Monday are counted as activity");
eq(r.currentPeriodLoads, 1, "one of them was for the current period");
eq(r.historicalLoads, 1, "the December file is reported as a back-load");

// The old rule counted upload time only, so BETA would have shown as loaded.
// Pin that this is genuinely different behaviour.
eq(r.outstanding.length > 0, true, "a back-load no longer satisfies the week");

// ── The week opens on its first current-period load, whenever that was ──
eq(typeof r.periodOpenedLabel, "string", "reports when the week opened");

// A file stamped for the current period but uploaded BEFORE Monday still counts:
// it is this week's DISPO regardless of when it landed.
const early = computeLoadStatus(
  [
    uploads[0], uploads[1], uploads[3],
    upload({ clientId: "c1", vendor: "100", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-08-07T06:00:00Z", y: 2026, m: 8, w: 1 }),
  ],
  clients, EMPTY_STATE, NOW,
);
eq(early.loadedVendors, 1, "a current-period file loaded last Friday still counts");
eq(early.currentPeriodLoads, 0, "…even though it is outside the Monday→now activity window");

// ── A vendor with several channels is only done when all of them are in ──
const multi = computeLoadStatus(
  [
    upload({ clientId: "c1", vendor: "100", channelId: "mb", channelName: "MASSBUILD", uploadDate: "2026-07-06T08:00:00Z", y: 2026, m: 7, w: 1 }),
    upload({ clientId: "c1", vendor: "100", channelId: "mk", channelName: "MAKRO", uploadDate: "2026-07-06T08:00:00Z", y: 2026, m: 7, w: 1 }),
    upload({ clientId: "c1", vendor: "100", channelId: "mk", channelName: "MAKRO", uploadDate: "2026-08-11T06:00:00Z", y: 2026, m: 8, w: 1 }),
  ],
  [clients[0]], EMPTY_STATE, NOW,
);
eq(multi.outstandingVendors, 1, "MASSBUILD still missing ⇒ vendor outstanding");
eq(multi.outstanding[0]?.partial, true, "…and flagged partial");
eq(multi.outstanding[0]?.missingChannels, ["MASSBUILD"], "…naming only the missing channel");

// ── Nothing stamped at all: no period, everything outstanding, no crash ──
const none = computeLoadStatus([], clients, EMPTY_STATE, NOW);
eq(none.periodLabel, null, "no stamped loads ⇒ no current period");
eq(none.outstandingVendors, 2, "both declared vendors are outstanding");
eq(none.loadsThisWeek, 0, "no activity");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All load-status assertions passed.\n");
