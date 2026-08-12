/* ──────────────────────────────────────────────────────────────
   SharePoint protocol check — every DISPO loaded into iRam LIVE should have a
   matching folder in the client's SharePoint tree:

     <CLIENTS>/<CLIENT>/DISPO's & DATA SOURCES/<YYYY>/<YYYY-MM>/W<n>

   Reads the loads from the live app and checks the OneDrive-synced folders on
   this machine, so it reports where the filing was skipped.

   Usage (PowerShell):
     $env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"
     npx tsx scripts/check-dispo-folders.ts
     npx tsx scripts/check-dispo-folders.ts --since 2026-07 --csv report.csv
     npx tsx scripts/check-dispo-folders.ts --root "D:\path\to\CLIENTS"

   Folder-name overrides (when a client's folder can't be matched automatically)
   go in scripts/dispo-folder-map.json as { "APP CLIENT NAME": "FOLDER NAME" }.
   ────────────────────────────────────────────────────────────── */

import fs from "node:fs";
import path from "node:path";
import { appUrl, login, getDispoUploads, type Upload } from "./appClient";
import {
  isDispoDir, resolveClientFolder, monthFolderName, weekFolderNumber,
} from "../lib/dispoFiling";

const DEFAULT_ROOT = "C:\\Users\\CarlDosSantos-(OUTER\\IRAM\\IRAM - Clients\\CLIENTS";
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── args ──
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = arg("root") ?? process.env.IRAM_CLIENTS_ROOT ?? DEFAULT_ROOT;
const APP = appUrl(arg("app"));
const SINCE = arg("since"); // "YYYY-MM" — only check periods from this month on
const CSV = arg("csv");

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith("~$")).map((d) => d.name);
  } catch {
    return [];
  }
}

// ── main ───────────────────────────────────────────────────────────────────
type Verdict = "OK" | "EMPTY WEEK FOLDER" | "NO WEEK FOLDER" | "NO MONTH FOLDER" | "NO YEAR FOLDER" | "NO DISPO FOLDER" | "NO CLIENT FOLDER";

interface Row {
  client: string; folder: string; period: string; verdict: Verdict;
  expected: string; loads: number; files: string[]; loadedBy: string;
}

async function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`Clients root not found:\n  ${ROOT}\nPass --root "<path>" if it lives elsewhere.`);
    process.exit(1);
  }

  const uploads = (await getDispoUploads(APP, await login(APP))).filter(
    (u) => u.reportYear != null && u.reportMonth != null && u.reportWeek != null,
  );

  // Manual overrides win over fuzzy matching.
  const mapPath = path.join(__dirname, "dispo-folder-map.json");
  const overrides: Record<string, string> = fs.existsSync(mapPath)
    ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : {};

  const clientDirs = listDirs(ROOT);
  const resolveFolder = (clientName: string) => resolveClientFolder(clientName, clientDirs, overrides);

  // One row per (client, period) that has at least one load.
  const groups = new Map<string, { client: string; y: number; m: number; w: number; loads: Upload[] }>();
  for (const u of uploads) {
    if (SINCE && `${u.reportYear}-${String(u.reportMonth).padStart(2, "0")}` < SINCE) continue;
    const k = `${u.clientName}|${u.reportYear}|${u.reportMonth}|${u.reportWeek}`;
    const g = groups.get(k) ?? { client: u.clientName, y: u.reportYear!, m: u.reportMonth!, w: u.reportWeek!, loads: [] };
    g.loads.push(u);
    groups.set(k, g);
  }

  const rows: Row[] = [];
  const unmatched = new Map<string, string>();

  for (const g of [...groups.values()].sort(
    (a, b) => a.client.localeCompare(b.client) || b.y - a.y || b.m - a.m || b.w - a.w,
  )) {
    const period = `${MON[g.m]} ${g.y} Wk${g.w}`;
    const loadedBy = [...new Set(g.loads.map((l) => l.uploadedByName))].join(", ");
    const { folder, near, score } = resolveFolder(g.client);

    const push = (verdict: Verdict, expected: string, files: string[] = []) =>
      rows.push({ client: g.client, folder: folder ?? "—", period, verdict, expected, loads: g.loads.length, files, loadedBy });

    if (!folder) {
      unmatched.set(g.client, `closest folder "${near}" scored ${score.toFixed(2)}`);
      push("NO CLIENT FOLDER", `${g.client} (no folder under CLIENTS)`);
      continue;
    }

    const clientPath = path.join(ROOT, folder);
    const dispoDir = listDirs(clientPath).find(isDispoDir);
    if (!dispoDir) { push("NO DISPO FOLDER", path.join(folder, "DISPO's & DATA SOURCES")); continue; }

    const yearPath = path.join(clientPath, dispoDir, String(g.y));
    const expectBase = path.join(folder, dispoDir, String(g.y));
    if (!fs.existsSync(yearPath)) { push("NO YEAR FOLDER", expectBase); continue; }

    const monthName = monthFolderName(g.y, g.m);
    const monthPath = path.join(yearPath, monthName);
    if (!fs.existsSync(monthPath)) { push("NO MONTH FOLDER", path.join(expectBase, monthName)); continue; }

    const weekDir = listDirs(monthPath).find((d) => weekFolderNumber(d) === g.w);
    if (!weekDir) { push("NO WEEK FOLDER", path.join(expectBase, monthName, `W${g.w}`)); continue; }

    const files = listFiles(path.join(monthPath, weekDir));
    push(files.length === 0 ? "EMPTY WEEK FOLDER" : "OK", path.join(expectBase, monthName, weekDir), files);
  }

  // ── report ──
  const bad = rows.filter((r) => r.verdict !== "OK");
  const byVerdict = new Map<string, number>();
  for (const r of rows) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);

  console.log(`\nDISPO SharePoint filing check`);
  console.log(`  root:    ${ROOT}`);
  console.log(`  checked: ${rows.length} client/period combinations with loads${SINCE ? ` from ${SINCE}` : ""}`);
  for (const [v, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${v}`);

  if (unmatched.size > 0) {
    console.log(`\n⚠ ${unmatched.size} client(s) could not be matched to a folder — add them to scripts/dispo-folder-map.json:`);
    for (const [c, why] of unmatched) console.log(`   "${c}"  →  ?     (${why})`);
  }

  if (bad.length > 0) {
    console.log(`\n${bad.length} period(s) loaded into iRam LIVE with no filed DISPO:\n`);
    let last = "";
    for (const r of bad) {
      if (r.client !== last) { console.log(`  ${r.client}`); last = r.client; }
      console.log(`     ${r.period.padEnd(16)} ${r.verdict.padEnd(19)} ${r.loads} load(s) by ${r.loadedBy}`);
      console.log(`        expected: ${r.expected}`);
    }
  } else {
    console.log(`\nEvery loaded period has a matching folder.`);
  }

  if (CSV) {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = ["Client,Folder,Period,Verdict,Loads,LoadedBy,ExpectedPath,FilesInFolder"];
    for (const r of rows) {
      lines.push([r.client, r.folder, r.period, r.verdict, String(r.loads), r.loadedBy, r.expected, r.files.join(" | ")].map(esc).join(","));
    }
    fs.writeFileSync(CSV, lines.join("\r\n"), "utf8");
    console.log(`\nCSV written to ${path.resolve(CSV)}`);
  }
  console.log("");
}

// Only run when invoked directly, so the matcher above can be unit-tested.
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
