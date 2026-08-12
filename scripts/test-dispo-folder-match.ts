/* Checks the client-name → SharePoint-folder matcher and the week-folder rule
   against the real names on both sides (30 clients that have loaded a DISPO,
   102 folders under CLIENTS, 12 Aug 2026).

   Run: npx tsx scripts/test-dispo-folder-match.ts
        npx tsx scripts/test-dispo-folder-match.ts --root "<path>"   (live check)
*/

import fs from "node:fs";
import {
  resolveClientFolder, WEEK_DIR, isDispoDir, checkClientFiling,
  type Entry, type ListChildren,
} from "../lib/dispoFiling";

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

// ── The verdict logic, against a stand-in folder tree ──
// Mirrors the real shapes: Verigreen files under "WK1", Rovic under "W1",
// Talborne has a week folder with nothing in it, Topline has no August at all.
const TREE: Record<string, Entry[]> = {
  "": [
    { name: "VERIGREEN", isFolder: true }, { name: "ROVIC LEERS", isFolder: true },
    { name: "TALBORNE", isFolder: true }, { name: "TOPLINE", isFolder: true },
    { name: "GENKEM", isFolder: true }, { name: "readme.txt", isFolder: false },
  ],
  "VERIGREEN": [{ name: "DISPO's & DATA SOURCES", isFolder: true }, { name: "MASTERFILES", isFolder: true }],
  "VERIGREEN/DISPO's & DATA SOURCES/2026": [{ name: "2026-07", isFolder: true }, { name: "2026-08", isFolder: true }],
  "VERIGREEN/DISPO's & DATA SOURCES/2026/2026-08": [{ name: "WK1", isFolder: true }],
  "VERIGREEN/DISPO's & DATA SOURCES/2026/2026-08/WK1": [{ name: "VD VERIGREEN (1544-W1).xlsx", isFolder: false }],

  "ROVIC LEERS": [{ name: "DISPO's & DATA SOURCES", isFolder: true }],
  "ROVIC LEERS/DISPO's & DATA SOURCES/2026": [{ name: "2026-08", isFolder: true }],
  "ROVIC LEERS/DISPO's & DATA SOURCES/2026/2026-08": [{ name: "W1", isFolder: true }],
  "ROVIC LEERS/DISPO's & DATA SOURCES/2026/2026-08/W1": [{ name: "dispo.xlsx", isFolder: false }],

  "TALBORNE": [{ name: "DISPOs", isFolder: true }],
  "TALBORNE/DISPOs/2026": [{ name: "2026-08", isFolder: true }],
  "TALBORNE/DISPOs/2026/2026-08": [{ name: "Week 1", isFolder: true }],
  "TALBORNE/DISPOs/2026/2026-08/Week 1": [],

  "TOPLINE": [{ name: "DISPO'S & DATA SOURCES", isFolder: true }],
  "TOPLINE/DISPO'S & DATA SOURCES/2026": [{ name: "2026-07", isFolder: true }],

  "GENKEM": [{ name: "MASTERFILES", isFolder: true }],

  // Vermont files with NO year level — the month folders sit directly under
  // the DISPO folder. Both layouts are live and both are correct; checking
  // only the nested one reported five clients as "no year folder" when their
  // DISPO was filed properly.
  "VERMONT SALES": [{ name: "DISPO'S & DATA SOURCES", isFolder: true }],
  "VERMONT SALES/DISPO'S & DATA SOURCES/2026-08": [{ name: "W1", isFolder: true }],
  "VERMONT SALES/DISPO'S & DATA SOURCES/2026-08/W1": [{ name: "vermont.xlsx", isFolder: false }],

  // Clippa really has TWO folders starting with "Dispo". The first one listed
  // is the empty legacy folder; the file is in the other. Checking only the
  // first reported Clippa as unfiled when it was filed correctly.
  "CLIPPA SALES": [
    { name: "Dispo", isFolder: true },
    { name: "DISPO's & DATA SOURCES", isFolder: true },
  ],
  "CLIPPA SALES/Dispo/2026": null as unknown as Entry[],
  "CLIPPA SALES/DISPO's & DATA SOURCES/2026": [{ name: "2026-08", isFolder: true }],
  "CLIPPA SALES/DISPO's & DATA SOURCES/2026/2026-08": [{ name: "W1", isFolder: true }],
  "CLIPPA SALES/DISPO's & DATA SOURCES/2026/2026-08/W1": [{ name: "VD CLIPPA (892-W1) MB.xlsx", isFolder: false }],
};
const listTree: ListChildren = async (p) => {
  const v = TREE[p.join("/")];
  return v == null ? null : v;
};
const AUG_W1 = { year: 2026, month: 8, week: 1 };

async function verdictFor(client: string) {
  const r = await checkClientFiling(client, AUG_W1, FOLDERS.concat(["VERIGREEN", "ROVIC LEERS", "TALBORNE", "TOPLINE", "GENKEM", "CLIPPA SALES", "VERMONT SALES"]), listTree);
  return r.verdict;
}

async function runFilingTests() {
  eq(await verdictFor("VERIGREEN PTY LTD"), "filed", "WK1 spelling counts as filed");
  eq(await verdictFor("ROVIC AND LEERS (PTY) LTD"), "filed", "W1 spelling counts as filed");
  eq(await verdictFor("TALBORNE URBAN ORGANICS (PTY) LTD"), "empty week folder", "an empty week folder is not filed");
  eq(await verdictFor("TOPLINE DISTRIBUTORS (PTY) LTD."), "no month folder", "August missing entirely");
  eq(await verdictFor("QUALICHEM GENKEM (PTY) LTD"), "no DISPO folder", "no folder starting with DISPO");
  eq(await verdictFor("GASPRO TECHNOLOGIES (PTY) LTD"), "no client folder", "unmatched client is reported");

  // A week folder holding only a file still counts — files are what get filed.
  const r = await checkClientFiling("VERIGREEN PTY LTD", AUG_W1, ["VERIGREEN"], listTree);
  eq(r.expectedPath, "CLIENTS/VERIGREEN/DISPO's & DATA SOURCES/2026/2026-08/WK1", "reports the real path it found");

  // A client with several "Dispo*" folders must be judged on the best of them.
  eq(await verdictFor("CLIPPA SALES (Pty) Ltd"), "filed",
    "the second DISPO folder is found when the first is empty");

  // The flat layout (no year folder) is just as valid as the nested one.
  eq(await verdictFor("VERMONT SALES (PTY) LTD"), "filed",
    "month folders directly under the DISPO folder count as filed");

  // ── File count vs DISPOs loaded ──
  // The folder existing is not the same as the DISPOs being in it. Verigreen's
  // Wk1 folder holds exactly one file.
  const one = ["VERIGREEN"];
  eq((await checkClientFiling("VERIGREEN PTY LTD", AUG_W1, one, listTree, {}, 1)).verdict, "filed",
    "1 file for 1 DISPO loaded is filed");
  eq((await checkClientFiling("VERIGREEN PTY LTD", AUG_W1, one, listTree, {}, 3)).verdict, "missing files",
    "1 file for 3 DISPOs loaded is short");
  eq((await checkClientFiling("VERIGREEN PTY LTD", AUG_W1, one, listTree, {}, 3)).fileCount, 1,
    "…and reports how many are actually there");
  eq((await checkClientFiling("VERIGREEN PTY LTD", AUG_W1, one, listTree)).verdict, "filed",
    "with no expectation given, any file counts as filed");
  // An empty folder is still empty, not merely short — it is the worse verdict.
  eq((await checkClientFiling("TALBORNE URBAN ORGANICS (PTY) LTD", AUG_W1, ["TALBORNE"], listTree, {}, 2)).verdict,
    "empty week folder", "an empty folder outranks 'missing files'");

  // Wrong week in the same month must not pass.
  eq((await checkClientFiling("VERIGREEN PTY LTD", { year: 2026, month: 8, week: 3 }, ["VERIGREEN"], listTree)).verdict,
    "no week folder", "Wk3 is not satisfied by the Wk1 folder");
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

// The filing verdicts are async, so the summary has to wait for them —
// otherwise they'd silently never run and the total would still look healthy.
const SYNC_ASSERTIONS = pass;

runFilingTests()
  .then(() => {
    if (pass === SYNC_ASSERTIONS) {
      console.log("\nFAILED: the async filing tests did not run.");
      process.exit(1);
    }
    console.log(`\n${pass} passed (${pass - SYNC_ASSERTIONS} filing verdicts), ${fails.length} failed`);
    if (fails.length) {
      console.log("\nFAILURES:\n  - " + fails.join("\n  - "));
      process.exit(1);
    }
    console.log("All folder-matching assertions passed.\n");
  })
  .catch((e) => { console.error(e); process.exit(1); });
