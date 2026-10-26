/* Game DISPO (26 Oct 2026). Game names its keys "Material" and "Location
   Hierarchy", so every row loaded with no Article and no Site; and its sales
   columns are WEEKS ("37-26" = week 37 of 2026), which must never be read as
   months. Makro and Massbuild-style headers must read exactly as before.

   Run: npx tsx scripts/test-game-dispo.ts                                     */

import * as XLSX from "xlsx";
import { parseDispo } from "../lib/dispoParser";
import { normalizeDateCol } from "../lib/salesData";

let fails = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails++;
};
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n"));
const xlsx = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

// ── Game: header shape copied from GAME 101026.csv ──
const gameHead = ["Material", "Material Description", "UOM", "Compo", "Order Unit", "Category", "Material Status", "RP Type",
  "Vendor", "Vendor Name", "Vendor Material Number", "Location Hierarchy", "Location Hierarchy Description",
  "37-26", "38-26", "42-25", "Curr Y/S", "SOH", "Actual Stock Value", "Rounding Rule", "Last Recived", "Last Sold"];
const game = parseDispo(csv([
  gameHead,
  ["414420", "Aqua Pool Noodle", "EA", "1.00", "SW", "GEED", "T", "Z4", "101026", "9TH MOON", "PPS-1", "G003",
    "GAME & GAME LIQ. BLOEMFONTEIN", "7.00", "1.00", "2.00", "32.00", "40.000", "929.60", "RP30", "2026-08-27", "2026-10-18"],
]));
const g = game.rows[0];
check("Game: Material -> Article", g["Article"] === "414420", g["Article"]);
check("Game: Location Hierarchy -> Site", g["Site"] === "G003", g["Site"]);
check("Game: site name", g["Site Name"] === "GAME & GAME LIQ. BLOEMFONTEIN", g["Site Name"]);
check("Game: Material Status -> Status", g["Status"] === "T", g["Status"]);
check("Game: RP Type -> RP", g["RP"] === "Z4", g["RP"]);
check("Game: Rounding Rule -> R. Profile", g["R. Profile"] === "RP30", g["R. Profile"]);
check("Game: Last Recived -> Last Recv", g["Last Recv"] === "2026-08-27", g["Last Recv"]);
check("Game: Vendor Material Number -> Vendor Prod Code", g["Vendor Prod Code"] === "PPS-1", g["Vendor Prod Code"]);
check("Game: vendor", game.vendorNumber === "101026", game.vendorNumber);
check("Game: NO month columns", game.dateColumns.length === 0, game.dateColumns);
check("Game: week columns renamed", JSON.stringify(game.weekColumns) === JSON.stringify(["Wk37-2026", "Wk38-2026", "Wk42-2025"]), game.weekColumns);
check("Game: week value kept", g["Wk37-2026"] === "7.00", g["Wk37-2026"]);
check("Game: no raw '37-26' key left", !("37-26" in g), Object.keys(g));
check("Game: week key never reads as a month", normalizeDateCol("Wk37-2026") === null);
check("Game: extra fields stored", g["Actual Stock Value"] === "929.60" && g["Category"] === "GEED");

// Early in the year every Game week is <= 12; the Game header still makes them weeks.
const early = parseDispo(csv([["Material", "Vendor", "Location Hierarchy", "05-27", "06-27"], ["1", "101026", "G001", "3", "4"]]));
check("Game: weeks 05/06 still weeks", early.dateColumns.length === 0 && early.weekColumns.join() === "Wk05-2027,Wk06-2027", early);

// ── Makro-style (2667): numeric MM-YYYY months must stay months ──
const makro = parseDispo(xlsx([
  ["Vendor", "Name", "Article", "Article Desc", "09-2025", "10-2025", "Curr Y/S", "UOM", "Compo", "Site", "Site Name", "Status", "SOH"],
  ["2667", "X", "100", "Thing", 5, 6, 11, "EA", 1, "M01", "MAKRO X", "", 3],
]));
check("Makro: months unchanged", makro.dateColumns.join() === "09-2025,10-2025" && makro.weekColumns.length === 0, makro.dateColumns);
check("Makro: article + site", makro.rows[0]["Article"] === "100" && makro.rows[0]["Site"] === "M01");

// ── Massbuild long-form (42): Mon-YY months must stay months ──
const mb = parseDispo(xlsx([
  ["Article", "Article Description", "Vendor Number", "Name", "Site", "RP", "PR ST", "Sep26", "Sep25", "Curr Y/S", "SOH"],
  ["200", "Other", "42", "Y", "B01", "Z4", "", 1, 2, 3, 4],
]));
check("Massbuild: months unchanged", mb.dateColumns.join() === "Sep26,Sep25" && mb.weekColumns.length === 0, mb.dateColumns);

// A numeric "07-26" in a NON-Game file is a month, as before.
const mm = parseDispo(xlsx([["Vendor", "Article", "Site", "07-26", "08-26"], ["9", "1", "S1", 1, 2]]));
check("Non-Game: '07-26' stays a month", mm.dateColumns.join() === "07-26,08-26" && mm.weekColumns.length === 0, mm.dateColumns);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
