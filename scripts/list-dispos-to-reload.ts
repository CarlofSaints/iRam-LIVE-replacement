/* ──────────────────────────────────────────────────────────────
   Which DISPO loads lost data to the header bugs, and so need re-uploading.

   Two defects, both fixed on 12 Aug 2026, neither of which repairs data that
   was already written — only a re-upload does that:

     1. The verbose Massbuild/SAP export spells its columns out in full
        ("Vendor Number", "Rounding Profile", "Promotion SP", "Last Receipt
        Date"). Only the short spellings were aliased, so those columns were
        dropped — most visibly the vendor, leaving the load with no vendor
        number at all.
     2. Two date-column shapes were not recognised as months — "26-Jul"
        (year first) and "8/1/25" (an Excel date serial) — plus "Sept-2025",
        which was detected but had no entry in the month table. A file whose
        months were ALL in one of those shapes merged no sales at all.

   Both are visible in the stored upload record, so this needs no re-parsing:
   a missing vendor number, and a short (or empty) date-column list.

   Usage (PowerShell):
     $env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"
     npx tsx scripts/list-dispos-to-reload.ts
     npx tsx scripts/list-dispos-to-reload.ts --csv reload.csv
     npx tsx scripts/list-dispos-to-reload.ts --latest-only     (one per stream)
   ────────────────────────────────────────────────────────────── */

import fs from "node:fs";
import path from "node:path";
import { appUrl, login, getDispoUploads, type Upload } from "./appClient";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const CSV = arg("csv");
const LATEST_ONLY = argv.includes("--latest-only");

// A healthy DISPO carries a run of monthly columns plus a same-month-last-year
// column. Every good file in the corpus has 7; anything short lost columns.
const EXPECTED_MONTHS = 7;

function faults(u: Upload): string[] {
  const out: string[] = [];
  const n = (u.dateColumns ?? []).length;
  if (n === 0) out.push("no sales months merged");
  else if (n < EXPECTED_MONTHS) out.push(`only ${n} of ${EXPECTED_MONTHS} sales months`);
  if (!(u.vendorNumber || "").trim()) out.push("no vendor number");
  return out;
}

const periodScore = (u: Upload) => (u.reportYear ?? 0) * 10000 + (u.reportMonth ?? 0) * 100 + (u.reportWeek ?? 0);
const periodLabel = (u: Upload) => `Wk${u.reportWeek} ${MON[u.reportMonth ?? 0] ?? u.reportMonth} ${u.reportYear}`;

async function main() {
  const app = appUrl(arg("app"));
  const uploads = await getDispoUploads(app, await login(app));
  const affected = uploads.filter((u) => faults(u).length > 0);

  // Group to the unit the team actually re-uploads: client × channel × period.
  const groups = new Map<string, Upload[]>();
  for (const u of affected) {
    const k = [u.clientName, u.channelName, u.reportYear, u.reportMonth, u.reportWeek].join("|");
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }

  // The snapshot rule (SOH, prices, R. Profile) only accepts a file for the
  // newest period a stream holds, so re-uploading the LATEST period per stream
  // is what restores current stock; older periods only restore sales history.
  const newestPerStream = new Map<string, number>();
  for (const u of uploads) {
    const s = `${u.clientId}|${u.channelId}`;
    newestPerStream.set(s, Math.max(newestPerStream.get(s) ?? 0, periodScore(u)));
  }
  const isLatest = (u: Upload) => newestPerStream.get(`${u.clientId}|${u.channelId}`) === periodScore(u);

  let rows = [...groups.values()].map((v) => v.sort((a, b) => a.uploadDate.localeCompare(b.uploadDate)));
  if (LATEST_ONLY) rows = rows.filter((v) => isLatest(v[0]));
  rows.sort((a, b) =>
    a[0].clientName.localeCompare(b[0].clientName) ||
    a[0].channelName.localeCompare(b[0].channelName) ||
    periodScore(b[0]) - periodScore(a[0]));

  console.log(`\nDISPO loads that need re-uploading`);
  console.log(`  ${affected.length} load(s) across ${rows.length} client/channel/period combination(s)`);
  console.log(`  of ${uploads.length} DISPO loads on record${LATEST_ONLY ? "  (latest period per stream only)" : ""}\n`);

  let lastClient = "";
  for (const v of rows) {
    const u = v[0];
    if (u.clientName !== lastClient) { console.log(`\n  ${u.clientName}`); lastClient = u.clientName; }
    const why = [...new Set(v.flatMap(faults))].join(" · ");
    const files = [...new Set(v.map((x) => x.fileName))].join(" ; ");
    console.log(`     ${periodLabel(u).padEnd(14)} ${u.channelName.padEnd(10)} ${isLatest(u) ? "LATEST " : "       "} ${why}`);
    console.log(`        ${v.length} load(s) by ${[...new Set(v.map((x) => x.uploadedByName))].join(", ")} — ${files}`);
  }

  if (rows.length === 0) console.log("  Nothing outstanding — every load has its vendor and a full set of sales months.");

  if (CSV) {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const out = ["Client,Channel,Period,Vendor,IsLatestPeriod,Problem,Loads,LoadedBy,Files,UploadedOn"];
    for (const v of rows) {
      const u = v[0];
      out.push([
        u.clientName, u.channelName, periodLabel(u), u.vendorNumber || "(none)",
        isLatest(u) ? "yes" : "no", [...new Set(v.flatMap(faults))].join(" · "),
        String(v.length), [...new Set(v.map((x) => x.uploadedByName))].join(", "),
        [...new Set(v.map((x) => x.fileName))].join(" ; "),
        v.map((x) => x.uploadDate.slice(0, 10)).join(" ; "),
      ].map(esc).join(","));
    }
    fs.writeFileSync(CSV, out.join("\r\n"), "utf8");
    console.log(`\nCSV written to ${path.resolve(CSV)}`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
