/* Client names are no longer typed into iRam LIVE - they are picked from the
   list SQL Server holds (EXEC [GetIRAMLiveClientNames]). This covers the two
   pieces of that which can silently go wrong:

     1. Which COLUMN the names are read out of. The SP's shape is not ours to
        fix, and reading the wrong key gives an empty picker that looks exactly
        like "SQL has no clients".
     2. Matching a submitted name against the list. It has to be forgiving
        about case and spacing - or a name that IS on the list gets refused -
        and it has to store SQL's own spelling, because that string is what
        every other stored procedure is keyed on.

   Run: npx tsx scripts/test-sql-client-names.ts                              */

import {
  pickNameColumn, collectColumns, normaliseClientName,
  isKnownClientName, canonicalClientName, looksLikeSameClient, coreTokens,
} from "../lib/sqlClientNames";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const NAMES = ["BISCO PLUS", "CLIPPA SALES", "EUROCHOC", "SNOMASTER", "ULTRA CHEM"];

console.log("Column picking");
eq("prefers Client", pickNameColumn([{ ClientID: 1, Client: "BISCO PLUS" }]), "Client");
eq("accepts ClientName", pickNameColumn([{ Id: 1, ClientName: "BISCO PLUS" }]), "ClientName");
eq("accepts a spaced header", pickNameColumn([{ "Client Name": "BISCO PLUS", Region: "GP" }]), "Client Name");
eq("accepts an underscored header", pickNameColumn([{ client_name: "BISCO PLUS" }]), "client_name");
eq("is case-insensitive about the header", pickNameColumn([{ CLIENT: "BISCO PLUS" }]), "CLIENT");
// Nothing recognisable: take the first column that actually holds text, not a
// numeric id that happens to come first.
eq("falls back to the first textual column",
  pickNameColumn([{ Seq: 1, Descriptor: "BISCO PLUS" }]), "Descriptor");
eq("no rows, no column", pickNameColumn([]), null);

/* These SPs return sparse rows - a column can be missing from row 1 entirely,
   which is why columns are collected across rows and not off the first one. */
const sparse = [{ Client: "A" }, { Client: "B", Region: "GP" }];
ok("columns are collected across rows", collectColumns(sparse).includes("Region"));

console.log("Name matching");
eq("normalises case and inner spacing", normaliseClientName("  bisco   plus "), "BISCO PLUS");
ok("an exact name is known", isKnownClientName("EUROCHOC", NAMES));
ok("a lowercase name is known", isKnownClientName("eurochoc", NAMES));
ok("a padded name is known", isKnownClientName("  Eurochoc  ", NAMES));
ok("a name with doubled spacing is known", isKnownClientName("CLIPPA  SALES", NAMES));
ok("a name that is not on the list is not known", !isKnownClientName("MADE UP CLIENT", NAMES));
// Not a prefix match: "EURO" must not pass because "EUROCHOC" exists.
ok("a prefix of a listed name is not known", !isKnownClientName("EURO", NAMES));
ok("a name containing a listed one is not known", !isKnownClientName("EUROCHOC HOLDINGS", NAMES));

console.log("Canonical spelling");
eq("stores SQL's spelling, not the typed one", canonicalClientName("  eurochoc ", NAMES), "EUROCHOC");
eq("an unknown name has no canonical form", canonicalClientName("NOPE", NAMES), null);
eq("blank is not a client", canonicalClientName("   ", NAMES), null);

/* Same company, two spellings. Every pair below is REAL: left is what
   GetIRAMLiveClientNames returned on 8 Sep 2026, right is what iRam LIVE
   already holds. Of the 19 SQL names, exactly ONE (ULTRA CHEM) matched by
   string - so without this check almost every existing client looks brand new
   in the picker, and adding it would split that client's data in two. */
console.log("Likely-duplicate detection");
const SAME: [string, string][] = [
  ["BISCO", "BISCO PLUS"],
  ["MAJOR TECH", "MAJOR TECH (PTY) LTD"],
  ["CLIPPA SALES", "CLIPPA SALES (Pty) Ltd"],
  ["ROVIC LEERS", "ROVIC AND LEERS (PTY) LTD"],
  ["SAFE TOP", "SAFE TOP RETAIL DISTRIBUTORS (PTY)"],
  ["SEAGULL", "SEAGULL INDUSTRIES (PTY) LTD"],
  ["QUALICHEM", "QUALICHEM GENKEM (PTY) LTD"],
  ["LIBRA MARKETING", "LIBRA MARKETING & SALES CC"],
  ["GASPRO TECHNOLOGIES", "GASPRO TECHNOLOGIES (PTY) LTD"],
  ["HELLERMANN TYTON", "HELLERMANN TYTON (PTY) LTD"],
  ["VERMONT SALES", "VERMONT SALES (PTY) LTD"],
];
for (const [sqlName, iramName] of SAME) {
  ok(`"${sqlName}" ↔ "${iramName}"`, looksLikeSameClient(sqlName, iramName));
}

/* The rule has to stay narrow, or the warning becomes noise nobody reads and
   two different companies get merged by someone trusting it. */
const DIFFERENT: [string, string][] = [
  ["VERMONT SALES", "SAFE TOP RETAIL DISTRIBUTORS (PTY)"],   // share nothing but a shape
  ["SEAGULL", "TOPLINE TOOLS"],
  ["OTIMA", "ULTRA CHEM"],
  ["TALBORNE", "TRAMONTINA"],                                 // same first letters only
  ["CLIPPA SALES", "VERMONT SALES"],                          // share "SALES", not the first word
  ["MAJOR TECH", "TECH MAJOR"],                               // same words, different company
  ["BISCO", "CARTOON CANDY"],
];
for (const [a, b] of DIFFERENT) {
  ok(`"${a}" is NOT "${b}"`, !looksLikeSameClient(a, b));
}

eq("legal-form words are dropped", coreTokens("Major Tech (Pty) Ltd").join(" "), "MAJOR TECH");
eq("an empty name has no tokens", coreTokens("  (Pty) Ltd  ").length, 0);
ok("a name with no letters cannot match anything", !looksLikeSameClient("(Pty) Ltd", "BISCO"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
