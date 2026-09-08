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
  isKnownClientName, canonicalClientName,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
