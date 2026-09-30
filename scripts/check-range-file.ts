/* Run a real range file through the store-report range lookup.
   npx tsx scripts/check-range-file.ts "<file.xlsx>" <site> <article> */
import * as XLSX from "xlsx";
import { buildSiteRanging, enrichLedgerRow } from "../lib/enrichment";
import { parseRangingSheet } from "../lib/controlFileData";

const [file, site, article] = process.argv.slice(2);
const wb = XLSX.readFile(file, { dense: true });
const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
const rows = parseRangingSheet(raw);
const sr = buildSiteRanging(rows);
console.log(`rows kept ${rows.length}/${raw.length} · stores ${sr?.sites.size ?? 0} · ranged keys ${sr?.ranged.size ?? 0} · channels ${[...(sr?.channels ?? [])].join(",")}`);
const e = enrichLedgerRow({ Site: site, Article: article }, new Map(), new Map(), new Map(), undefined, sr);
console.log(`${site} × ${article}: _rangedAtSite=${e._rangedAtSite}  _rangingStatus=${e._rangingStatus}`);
