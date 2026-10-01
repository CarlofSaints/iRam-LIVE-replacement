/* The SQL Name mapping screen's suggestions. A wrong suggestion that gets
   accepted makes a client silently read another client's data, so this
   covers what must NOT be suggested as carefully as what must.

   Run: npx tsx scripts/test-sql-client-mapping.ts                           */

import { buildEntries, normaliseVendorCode } from "../lib/sqlClientNames";
import { buildMappingRows } from "../lib/sqlClientMapping";
import type { Client } from "../lib/types";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function client(name: string, vendorNumbers: string[] = [], extra: Partial<Client> = {}): Client {
  return {
    id: name, name, vendorNumbers, active: true, createdAt: "", channelIds: [], linkedClientIds: [],
    controlFiles: { pmf: null, links: null, ranging: null, custom_sites: null, promotions: null },
    ...extra,
  } as Client;
}

// The shape GetIRAMLiveClientNames returns: one row per client × channel.
const SQL_ROWS = [
  { Client: "BISCO", Channel: "MAKRO", VendorCode: "10548", "Internal CAM Email": "a@x" },
  { Client: "BISCO", Channel: "MASSBUILD", VendorCode: "10548", "Internal CAM Email": "a@x" },
  { Client: "CLIPPA SALES", Channel: "MAKRO", VendorCode: "7629", "Internal CAM Email": "" },
  { Client: "CLIPPA SALES", Channel: "MAKRO", VendorCode: "07425", "Internal CAM Email": "" },
  { Client: "ULTRA CHEM", Channel: "MASSBUILD", VendorCode: "", "Internal CAM Email": "" },
  { Client: "MAJOR TECH", Channel: "MAKRO", VendorCode: "", "Internal CAM Email": "" },
  { Client: "TOPLINE TOOLS", Channel: "MAKRO", VendorCode: "", "Internal CAM Email": "" },
  // Once the SP is opened up to ALL clients, names sharing a first word appear.
  { Client: "VERMONT SALES", Channel: "MAKRO", VendorCode: "2064", "Internal CAM Email": "" },
  { Client: "VERMONT", Channel: "GAME", VendorCode: "", "Internal CAM Email": "" },
  { Client: "HALEWOOD", Channel: "MAKRO", VendorCode: "1239", "Internal CAM Email": "" },
  { Client: "HALEWOOD INTERNATIONAL", Channel: "MAKRO", VendorCode: "1239", "Internal CAM Email": "" },
];

console.log("Entries from the SP rows");
const entries = buildEntries(SQL_ROWS, "Client");
eq("one entry per client name", entries.map((e) => e.name),
  ["BISCO", "CLIPPA SALES", "HALEWOOD", "HALEWOOD INTERNATIONAL", "MAJOR TECH", "TOPLINE TOOLS", "ULTRA CHEM", "VERMONT", "VERMONT SALES"]);
eq("vendor codes collected across rows, leading zeros dropped",
  entries.find((e) => e.name === "CLIPPA SALES")?.vendorCodes, ["7425", "7629"]);
eq("channels collected", entries.find((e) => e.name === "BISCO")?.channels, ["MAKRO", "MASSBUILD"]);
eq("blank vendor gives none", entries.find((e) => e.name === "ULTRA CHEM")?.vendorCodes, []);
eq("normaliseVendorCode keeps 0", normaliseVendorCode("0"), "0");
eq("no vendor column → no codes, still an entry",
  buildEntries([{ Client: "X" }], "Client"), [{ name: "X", vendorCodes: [], channels: [] }]);

const clients: Client[] = [
  client("BISCO PLUS (PTY) LTD", ["10548"]),                       // vendor
  client("CLIPPA SALES (Pty) Ltd", ["7425"]),                       // vendor, SQL has leading zero
  client("ULTRA CHEM", []),                                         // exact
  client("MAJOR TECH (PTY) LTD", []),                               // name
  client("TOPLINE DISTRIBUTORS (PTY) LTD.", []),                    // near-miss: no suggestion
  client("VERMONT SALES", ["2064"]),                                // vendor beats the name ambiguity
  client("HALEWOOD", ["1239"]),                                     // vendor ambiguous, exact name breaks the tie
  client("HWI TRADING", ["1239"]),                                 // vendor ambiguous, nothing breaks it
  client("EUROCHOC CC", []),                                        // nothing in SQL
  client("SNOMASTER", [], { sqlClientName: "SNOMASTER" }),          // stale mapping
  client("SAFE TOP", [], { sqlClientName: "BISCO" }),               // shares with nobody yet
  client("BISCO OLD", ["10548"], { sqlClientName: "BISCO", active: false }),
];
const rows = buildMappingRows(clients, entries);
const row = (n: string) => rows.find((r) => r.name === n)!;

console.log("Suggestions");
eq("vendor match", row("BISCO PLUS (PTY) LTD").suggestion, { sqlName: "BISCO", reason: "vendor" });
eq("vendor match through a leading zero", row("CLIPPA SALES (Pty) Ltd").suggestion, { sqlName: "CLIPPA SALES", reason: "vendor" });
eq("exact name", row("ULTRA CHEM").suggestion, { sqlName: "ULTRA CHEM", reason: "exact" });
eq("similar name", row("MAJOR TECH (PTY) LTD").suggestion, { sqlName: "MAJOR TECH", reason: "name" });
eq("TOPLINE near-miss is NOT suggested", row("TOPLINE DISTRIBUTORS (PTY) LTD.").suggestion, null);
eq("vendor wins over two similar names", row("VERMONT SALES").suggestion, { sqlName: "VERMONT SALES", reason: "vendor" });
eq("ambiguous vendor, exact name breaks the tie", row("HALEWOOD").suggestion, { sqlName: "HALEWOOD", reason: "vendor" });
eq("ambiguous vendor with no tie-break suggests nothing", row("HWI TRADING").suggestion, null);
eq("…and lists the candidates", row("HWI TRADING").candidates.map((c) => c.sqlName), ["HALEWOOD", "HALEWOOD INTERNATIONAL"]);
eq("no evidence → nothing", [row("EUROCHOC CC").suggestion, row("EUROCHOC CC").candidates.length], [null, 0]);

console.log("Existing mappings");
eq("unmapped reads null", [row("ULTRA CHEM").current, row("ULTRA CHEM").currentOnList], [null, null]);
eq("stale mapping flagged", row("SNOMASTER").currentOnList, false);
eq("valid mapping on list", row("SAFE TOP").currentOnList, true);
eq("shared mapping names the other client", row("SAFE TOP").sharedWith, ["BISCO OLD"]);
eq("archived client carried as inactive", row("BISCO OLD").active, false);
eq("suggestion still offered when already mapped", row("BISCO OLD").suggestion, { sqlName: "BISCO", reason: "vendor" });
const wrong = buildMappingRows([client("CLIPPA WRONG", ["7629"], { sqlClientName: "BISCO" })], entries)[0];
eq("a mapping that disagrees with the vendor evidence shows the other name",
  [wrong.current, wrong.suggestion?.sqlName], ["BISCO", "CLIPPA SALES"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
