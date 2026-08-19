/* ──────────────────────────────────────────────────────────────
   WHICH DISPO STREAMS NEED RE-UPLOADING AFTER THE 19 AUG 2026 FIXES.

   Two parser defects understated sales, and neither repairs data already in
   the ledger — only a re-upload does that:

     1. collapseUomRows kept only the selling-unit row, dropping every CASE,
        PALLET, LAYER and SHRINK-WRAP sale. Affects any DISPO that lists an
        Article×Site once per UOM (a "**" total line is the tell).
     2. Some exports write thousands with a PERIOD — 1,525 as "1.525", 1,500
        as "1.5" — so those values loaded a thousandfold small.

   Affectedness is a property of the STREAM (client + vendor number), not of
   each week's file: a client's Makro export is multi-UOM every week. So this
   reads only the NEWEST file per stream, classifies it, and measures the gap
   between what the old code would have loaded and what the file actually says.

   ⚠️ ONEDRIVE: reading a cloud-only file downloads it. This touches at most one
   file per stream (~37), never the whole tree. Do NOT point a scanner at
   `IRAM\IRAM - Clients` unfiltered — the DISPO folder name matches thousands of
   unrelated files and hydrating them all takes hours.

   ⚠️ Walking the client tree from Node takes many minutes — it is 100+ client
   folders on a OneDrive mount and every readdir is a network round trip.
   PowerShell enumerates the same thing in seconds, so GENERATE THE LIST FIRST
   and hand it in with --files:

     Get-ChildItem "C:\Users\CarlDosSantos-(OUTER\IRAM\IRAM - Clients\CLIENTS" `
       -Recurse -File -Filter "*DISPO*.xls*" |
       Select-Object -ExpandProperty FullName |
       Set-Content -Encoding utf8 "$env:TEMP\dispos.txt"

   Usage:
     npx tsx scripts/list-uom-reloads.ts --files "%TEMP%\dispos.txt"
     npx tsx scripts/list-uom-reloads.ts --files … --csv reload.csv
     To avoid downloading cloud-only files, filter the list in PowerShell first:
       … | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Offline) } | …
     npx tsx scripts/list-uom-reloads.ts                          (slow: walks --root)
   ────────────────────────────────────────────────────────────── */

import fs from "node:fs";
import path from "node:path";
import { parseDispo } from "../lib/dispoParser";
import { readQty, FIXED_QUANTITY_COLUMN } from "../lib/dispoNumbers";

const DEFAULT_ROOT =
  "C:/Users/CarlDosSantos-(OUTER/IRAM/IRAM - Clients/CLIENTS";

const argv = process.argv.slice(2);
const argOf = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = argOf("--root") ?? DEFAULT_ROOT;
const CSV = argOf("--csv");
const FILE_LIST = argOf("--files");
/* Only consider files modified on or after this (default: this year). A stream
   whose newest DISPO is from 2023 is not being loaded any more, so reading it
   costs a OneDrive download and tells you nothing. */
const SINCE = argOf("--since") ?? `${new Date().getFullYear()}-01-01`;
const SINCE_MS = Date.parse(SINCE);
if (!Number.isFinite(SINCE_MS)) {
  console.error(`--since must be a date like 2026-01-01 (got "${SINCE}")`);
  process.exit(1);
}

/* ── Find candidate DISPO files ────────────────────────────────────────────
   Filename must contain DISPO — matching the PATH would pull in every file
   that merely lives under a "DISPO's & DATA SOURCES" folder. */
interface Found { file: string; client: string; vendor: string; mtime: number }

function walk(dir: string, depth: number, out: string[]) {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1, out);
    else if (/dispo/i.test(e.name) && /\.xlsx?$/i.test(e.name)) out.push(full);
  }
}

/* Node's fs.Stats does NOT expose Windows file attributes, so this script
   cannot tell a cloud-only placeholder from a local file — reading one silently
   downloads it. Filtering therefore has to happen in PowerShell, where the
   attribute is available; see the PowerShell filter in the header. Deliberately not
   guessed here: a flag that quietly does nothing is worse than no flag. */

let files: string[];
if (FILE_LIST) {
  files = fs.readFileSync(FILE_LIST, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .filter((f) => /dispo/i.test(path.basename(f)) && /\.xlsx?$/i.test(f));
  console.log(`Reading ${files.length} path(s) from ${FILE_LIST} …`);
} else {
  console.log(`Walking ${ROOT} … (slow on OneDrive — see --files in the header)`);
  files = [];
  walk(ROOT, 0, files);
}

const candidates: Found[] = [];
for (const f of files) {
  // Client = the first path segment below the CLIENTS root, wherever it appears.
  const norm = f.split(/[\\/]/);
  const ci = norm.findIndex((s) => s.toUpperCase() === "CLIENTS");
  const client = ci >= 0 ? norm[ci + 1] : path.relative(ROOT, f).split(path.sep)[0];
  if (!client || client.includes(".")) continue;      // stray file at the root
  /* Vendor number out of the filename. Take the first 3-6 digit run that is not
     a plausible YEAR — "GASPRO 2026-08 DISPO.xls" was otherwise filed under
     vendor "2026". A stream that genuinely has no number stays "?" and is still
     checked; it just groups by client alone. */
  const vendor =
    (path.basename(f).match(/\d{3,6}/g) ?? [])
      .find((d) => !(d.length === 4 && +d >= 1990 && +d <= 2100)) ?? "?";
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
  if (mtime < SINCE_MS) continue;                     // dormant stream
  candidates.push({ file: f, client, vendor, mtime });
}

// Newest file per (client, vendor) stream.
const newest = new Map<string, Found>();
for (const c of candidates) {
  const k = `${c.client}|${c.vendor}`;
  const prev = newest.get(k);
  if (!prev || c.mtime > prev.mtime) newest.set(k, c);
}

console.log(
  `${candidates.length} DISPO file(s) modified since ${SINCE}, ` +
  `${newest.size} client+vendor stream(s) to check.\n` +
  `(reading one file per stream — cloud-only files download as they are read)\n`
);

/* ── What the OLD code would have loaded ───────────────────────────────────
   Deliberately duplicated here rather than kept in lib: it is the behaviour we
   just REMOVED, and it only exists to size the damage. Selling row only (the
   highest-SOH row), values read as-is with no thousands rescale. */
function oldTotal(rows: Record<string, unknown>[], cols: string[]): number {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const a = String(r["Article"] ?? "").trim().toLowerCase();
    const s = String(r["Site"] ?? "").trim().toLowerCase();
    if (!a || !s) continue;
    const k = `${a}|${s}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const plain = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };
  let t = 0;
  for (const g of groups.values()) {
    const parts = g.filter((r) => String(r["UOM"] ?? "").trim() !== "**");
    const pool = parts.length ? parts : g;
    let best = pool[0];
    for (const r of pool) if (plain(r["SOH"]) > plain(best["SOH"])) best = r;
    for (const c of cols) t += plain(best[c]);
  }
  return t;
}

/* The same vendor can appear under more than one folder — staging folders like
   `OJ\01.06` hold dated batches of other clients' DISPOs. Those are the SAME
   ledger stream (client+channel is decided by the vendor, not the folder), so
   reloading both is wasted work: note the older one instead. */
const clientsByVendor = new Map<string, Found[]>();
for (const s of newest.values()) {
  if (s.vendor === "?") continue;
  if (!clientsByVendor.has(s.vendor)) clientsByVendor.set(s.vendor, []);
  clientsByVendor.get(s.vendor)!.push(s);
}
function duplicateNote(s: Found): string {
  const peers = clientsByVendor.get(s.vendor) ?? [];
  if (peers.length < 2) return "";
  const newestPeer = peers.reduce((a, b) => (b.mtime > a.mtime ? b : a));
  if (newestPeer.client === s.client) {
    const others = peers.filter((p) => p.client !== s.client).map((p) => p.client);
    return `also filed under ${others.join(", ")}`;
  }
  return `OLDER COPY — same vendor, newer file under ${newestPeer.client}`;
}

interface Row {
  client: string; vendor: string; file: string; months: string;
  multiUom: boolean; thousands: boolean; rescaled: number;
  oldUnits: number; newUnits: number; shortPct: number; note: string;
}
const results: Row[] = [];
const skipped: string[] = [];

const streamList = [...newest.values()].sort((a, b) => a.client.localeCompare(b.client));
let done = 0;
for (const s of streamList) {
  process.stdout.write(`  [${++done}/${streamList.length}] ${s.client} ${s.vendor}\n`);
  let buf: Buffer;
  try { buf = fs.readFileSync(s.file); } catch (e) {
    skipped.push(`${s.client} ${s.vendor} (unreadable: ${(e as Error).message})`);
    continue;
  }

  let parsed;
  try { parsed = parseDispo(buf); } catch (e) {
    skipped.push(`${s.client} ${s.vendor} (unparseable: ${(e as Error).message})`);
    continue;
  }

  const cols = [...parsed.dateColumns, FIXED_QUANTITY_COLUMN];
  const newUnits = parsed.rows.reduce(
    (a, r) => a + cols.reduce((x, c) => x + readQty(r[c]), 0), 0);

  // Re-parse RAW for the old-behaviour baseline: parseDispo has already
  // collapsed and rescaled, so its rows cannot show what was lost.
  const rawRows = rawParse(buf);
  const oldUnits = oldTotal(rawRows, cols);

  const multiUom = rawRows.some((r) => String(r["UOM"] ?? "").trim() === "**");
  results.push({
    client: s.client, vendor: s.vendor, file: s.file,
    months: parsed.dateColumns.slice().sort().join(" "),
    multiUom, thousands: parsed.thousands.applies,
    rescaled: parsed.thousands.cellsRescaled,
    note: duplicateNote(s),
    oldUnits, newUnits,
    shortPct: newUnits > 0 ? ((newUnits - oldUnits) / newUnits) * 100 : 0,
  });
}

/* Minimal raw read — same sheet and header discovery as the parser, but no
   collapsing and no rescaling, so the old behaviour can be reconstructed. */
function rawParse(buf: Buffer): Record<string, unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  let sheetName = wb.SheetNames[0];
  for (const n of wb.SheetNames) if (/^\d/.test(n.trim())) { sheetName = n; break; }
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
  let hi = -1;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const cells = (aoa[i] || []).map((c) => String(c ?? "").toLowerCase().trim());
    if (cells.includes("article") || cells.includes("vendor")) { hi = i; break; }
  }
  if (hi < 0) return [];
  const hdr = (aoa[hi] as unknown[]).map((c) => String(c ?? "").trim());
  const out: Record<string, unknown>[] = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const row = aoa[i]; if (!Array.isArray(row)) continue;
    const o: Record<string, unknown> = {};
    hdr.forEach((h, j) => { if (h) o[h.replace(/\s+/g, " ").trim()] = row[j] ?? ""; });
    // normalise the two headers we rely on, which carry padding in some exports
    o["SOH"] = o["SOH"] ?? "";
    out.push(o);
  }
  return out;
}

/* ── Report ───────────────────────────────────────────────────────────────*/
const affected = results.filter((r) => r.multiUom || r.thousands);
const clean = results.filter((r) => !r.multiUom && !r.thousands);

const primary = affected.filter((r) => !r.note.startsWith("OLDER COPY"));
const olderCopies = affected.filter((r) => r.note.startsWith("OLDER COPY"));

console.log("═══ RELOAD THESE ═══════════════════════════════════════════════\n");
if (primary.length === 0) console.log("  (none)\n");
console.log("  client                    vendor   under-reported   why                    months the reload repairs");
for (const r of primary.sort((a, b) => b.shortPct - a.shortPct)) {
  const why = [r.multiUom ? "multi-UOM" : "", r.thousands ? `thousands(${r.rescaled})` : ""]
    .filter(Boolean).join(" + ");
  console.log(
    "  " + r.client.slice(0, 24).padEnd(25) +
    r.vendor.padEnd(8) +
    (r.shortPct >= 0.05 ? `-${r.shortPct.toFixed(1)}%` : "~0%").padStart(14) + "   " +
    why.padEnd(22) + " " + r.months
  );
  if (r.note) console.log(" ".repeat(27) + `↳ ${r.note}`);
}

if (olderCopies.length) {
  console.log(
    "\n  ── same vendor, older copy in another folder — RELOAD ONLY IF you want the\n" +
    "     earlier months it carries; it is the same ledger stream ───────────────\n"
  );
  for (const r of olderCopies.sort((a, b) => b.shortPct - a.shortPct)) {
    console.log(
      "  " + r.client.slice(0, 24).padEnd(25) + r.vendor.padEnd(8) +
      (r.shortPct >= 0.05 ? `-${r.shortPct.toFixed(1)}%` : "~0%").padStart(14) + "   " + r.months
    );
  }
}

console.log("\n═══ DO NOT RELOAD (nothing to gain) ════════════════════════════\n");
for (const r of clean.sort((a, b) => a.client.localeCompare(b.client))) {
  console.log(`  ${r.client.slice(0, 24).padEnd(25)}${r.vendor.padEnd(8)}one row per Article|Site — neither defect applies`);
}

if (skipped.length) {
  console.log(`\n⚠️  ${skipped.length} stream(s) NOT checked — treat as UNKNOWN, not as clean:`);
  for (const s of skipped) console.log(`  ${s}`);
}


console.log(`\nTotal: ${affected.length} stream(s) to reload, ${clean.length} to skip.`);
console.log(
  "\nReload the NEWEST file per stream first — `Curr Y/S` is period-gated, so only a\n" +
  "same-or-newer load can repair it. Each file repairs only the months listed above.\n" +
  "Then run the price-snapshot sweep (Control Centre → Data Health), in that order."
);

if (CSV) {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    "client,vendor,reload,reason,note,underReportedPct,oldUnits,newUnits,months,file",
    ...results.map((r) => [
      esc(r.client), esc(r.vendor), r.multiUom || r.thousands ? "YES" : "no",
      esc([r.multiUom ? "multi-UOM" : "", r.thousands ? "period-thousands" : ""].filter(Boolean).join(" + ") || "-"), esc(r.note),
      r.shortPct.toFixed(2), Math.round(r.oldUnits), Math.round(r.newUnits),
      esc(r.months), esc(r.file),
    ].join(",")),
  ];
  fs.writeFileSync(CSV, lines.join("\n"), "utf8");
  console.log(`\nCSV written to ${CSV}`);
}
