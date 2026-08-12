/* Checks the client-name → SharePoint-folder matcher and the week-folder rule
   against the real names on both sides (30 clients that have loaded a DISPO,
   102 folders under CLIENTS, 12 Aug 2026).

   Run: npx tsx scripts/test-dispo-folder-match.ts
        npx tsx scripts/test-dispo-folder-match.ts --root "<path>"   (live check)
*/

import fs from "node:fs";
import { resolveClientFolder, WEEK_DIR, isDispoDir } from "./check-dispo-folders";

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) pass++;
  else fails.push(`${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// ── The real folder list under "IRAM - Clients\CLIENTS" ──
const FOLDERS = [
  "ADMIN", "AFRICAN LUBRICANT - MOBIL", "ANDROWARE", "ATOMIC MARKETING", "All Plug Sales", "Astrum",
  "BISCO", "BME Group", "BRC", "BRIGHT STAR", "BRUMMER ADHESIVES", "BUCO 2025", "CARTOON CANDY",
  "CLIENT SET-UP", "CLIPPA SALES", "Clover Leaf +Newden", "DARIOPRO", "DAY", "DREAM", "Dream Textile",
  "ELEV8R", "EUROCHOC", "EUROGAS", "EUROLUX", "EVOCARE", "Econo Com", "FUNKI LINES", "GENERAL",
  "GENKEM", "HALEWOOD", "HELLERMAN TYTON", "HOME OF KOT - KISSKIDS", "HQ FOODS", "LADY BOBA",
  "LIBRA MARKETING", "Lumoss", "MAJOR TECH", "MAKRO SARAH-JANE", "MIDEA", "NARAYAN TEXTILES",
  "PROTON", "REITZER HEALTHCARE", "ROBERT BOSCH", "ROVIC LEERS", "SAFE TOP", "SEAGULL",
  "STANLEY B&D", "TALBORNE", "TOPLINE", "TRAMONTINA", "ULTRA CHEM", "USABCO", "VALEMOUNT TRADING",
  "VERIGREEN", "VERMONT SALES", "VITA 24",
];

// ── Every client that has loaded a DISPO, and the folder it must land on ──
// null = no folder exists for them yet, and the matcher must say so rather
// than guessing at a neighbour.
const EXPECTED: [string, string | null][] = [
  ["BISCO PLUS (PTY) LTD", "BISCO"],
  ["CARTOON CANDY", "CARTOON CANDY"],
  ["CLIPPA SALES (Pty) Ltd", "CLIPPA SALES"],
  ["DARIOPRO (PTY) LTD", "DARIOPRO"],
  ["EUROCHOC CC", "EUROCHOC"],
  ["FUNKI LINES (PTY) LTD", "FUNKI LINES"],
  ["HALEWOOD", "HALEWOOD"],
  ["HELLERMANN TYTON (PTY) LTD", "HELLERMAN TYTON"],   // folder drops an N
  ["HOME OF KOT", "HOME OF KOT - KISSKIDS"],
  ["HQ FOODS CC", "HQ FOODS"],
  ["LIBRA MARKETING & SALES CC", "LIBRA MARKETING"],
  ["LUMOSS MOULDINGS (Pty) Ltd", "Lumoss"],
  ["MAJOR TECH (PTY) LTD", "MAJOR TECH"],
  ["NARAYAN TEXTILES (Pty) Ltd", "NARAYAN TEXTILES"],
  ["QUALICHEM GENKEM (PTY) LTD", "GENKEM"],            // only the second word matches
  ["LUMOSS MOULDINGS (Pty) Ltd", "Lumoss"],            // folder keeps only the first word
  ["REITZER HEALTHCARE (PTY) LTD", "REITZER HEALTHCARE"],
  ["ROBERT BOSCH (PTY) LIMITED", "ROBERT BOSCH"],
  ["ROVIC AND LEERS (PTY) LTD", "ROVIC LEERS"],        // folder drops the "AND"
  ["SAFE TOP RETAIL DISTRIBUTORS (PTY)", "SAFE TOP"],
  ["SEAGULL INDUSTRIES (PTY) LTD", "SEAGULL"],
  ["TALBORNE URBAN ORGANICS (PTY) LTD", "TALBORNE"],
  ["TOPLINE DISTRIBUTORS (PTY) LTD.", "TOPLINE"],
  ["TRAMONTINA AFRICA (PTY) LTD", "TRAMONTINA"],
  ["ULTRA CHEM", "ULTRA CHEM"],
  ["USABCO (PTY) LTD", "USABCO"],
  ["VALEMOUNT TRADING (PTY) LTD", "VALEMOUNT TRADING"],
  ["VERIGREEN PTY LTD", "VERIGREEN"],
  ["VERMONT SALES (PTY) LTD", "VERMONT SALES"],
  ["VITA 24 (PTY) LTD", "VITA 24"],
  ["GASPRO TECHNOLOGIES (PTY) LTD", null],             // no folder exists
];

// Every one of these must resolve with NO override file present.
for (const [client, want] of EXPECTED) {
  const got = resolveClientFolder(client, FOLDERS);
  eq(got.folder ?? null, want, `resolveClientFolder("${client}")`);
}

// A client with no folder must never be silently attached to a near-miss.
eq(resolveClientFolder("GASPRO TECHNOLOGIES (PTY) LTD", FOLDERS).folder, undefined,
  "an unmatched client returns nothing");

// The override file is the escape hatch for anything the matcher won't take.
eq(resolveClientFolder("GASPRO TECHNOLOGIES (PTY) LTD", FOLDERS, { "GASPRO TECHNOLOGIES (PTY) LTD": "GASPRO" }).folder,
  "GASPRO", "an override wins over the matcher");

// A word must not match a longer word that merely starts the same, or SAFE TOP
// lands in TOPLINE's folder.
eq(resolveClientFolder("SAFE TOP RETAIL DISTRIBUTORS (PTY)", FOLDERS).folder, "SAFE TOP",
  "SAFE TOP does not collide with TOPLINE");
eq(resolveClientFolder("TOPLINE DISTRIBUTORS (PTY) LTD.", FOLDERS).folder, "TOPLINE",
  "TOPLINE does not collide with SAFE TOP");

// ── Week folder names: every spelling that exists in the tree ──
const WEEKS: [string, number | null][] = [
  ["W1", 1], ["W5", 5], ["WK1", 1], ["WK4", 4],
  ["Week 1", 1], ["Week 5", 5], ["Week-01", 1],
  ["W-1", 1], ["W-3", 3],
  // real folders in the tree that are NOT week folders
  ["New folder", null], ["W-3-Brighton-iRam", null], ["2023-11", null], ["MASTERFILE", null],
];
for (const [name, want] of WEEKS) {
  const m = name.match(WEEK_DIR);
  eq(m ? parseInt(m[1], 10) : null, want, `WEEK_DIR("${name}")`);
}

// ── DISPO directory spellings seen across the 43 client folders ──
for (const d of ["DISPO's & DATA SOURCES", "DISPO'S & DATA SOURCES", "DISPOS & DATA SOURCES",
                 "DISPO'S and DATA SOURCE", "DISPO AND DATA", "Dispo & Data Sources", "DISPOs", "Dispo"]) {
  eq(isDispoDir(d), true, `isDispoDir("${d}")`);
}
for (const d of ["MASTERFILES", "REPORTS", "OPERATIONS", "ADMIN"]) {
  eq(isDispoDir(d), false, `isDispoDir("${d}") is not a DISPO folder`);
}

// ── Optional: re-check the folder list against the live disk ──
const rootArg = process.argv.indexOf("--root");
if (rootArg >= 0) {
  const root = process.argv[rootArg + 1];
  const live = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const gone = FOLDERS.filter((f) => !live.includes(f));
  console.log(gone.length === 0
    ? `\nLive check: all ${FOLDERS.length} pinned folders still exist.`
    : `\nLive check: ${gone.length} pinned folder(s) no longer on disk — ${gone.join(", ")}`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("All folder-matching assertions passed.\n");
