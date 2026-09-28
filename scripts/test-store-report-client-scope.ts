/* A rep limited to ONE client must never see another client's data, in any
   channel the report reaches them through.

   Seeds a throwaway data/ folder with two clients stocked in the same store
   (ALPHA and BRAVO), then drives the REAL code paths:
     • loadStoreReport with and without a client list
     • the /r page handler (the hosted report, incl. its embedded saved counts)
     • the phantom-export handler (the Excel count sheet the page downloads)
     • the email renderer
   and asserts nothing of BRAVO's appears when the link is limited to ALPHA.

   Negative controls prove the test CAN see a leak: the unscoped report does
   carry BRAVO, and the counts file on disk does hold a BRAVO count.

   Run: npx tsx scripts/test-store-report-client-scope.ts                     */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { tmpdir } from "os";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
}

const SITE = "M27";
const CH = "ch-makro";
const ALPHA = { id: "client-alpha", name: "ALPHA FOODS" };
const BRAVO = { id: "client-bravo", name: "BRAVO SECRETCO" };
// Every string of BRAVO's that could surface anywhere. Any hit = a leak.
const BRAVO_MARKERS = ["client-bravo", "BRAVO", "SECRETCO", "900111", "900222", "BRAVO-WIDGET", "7777"];

function rows(client: { id: string }, articles: [string, string][], vendor: string) {
  return articles.map(([article, desc], i) => ({
    Site: SITE,
    "Site Name": "MAKRO WOODMEAD",
    Article: article,
    "Article Desc": desc,
    Vendor: `${vendor} SUPPLIER`,
    _vendor: vendor,
    _lastLoadedAt: "2026-09-20T08:00:00.000Z",
    // Line 0: phantom (stock, nothing sold or received for a year).
    // Line 1: out of stock.
    SOH: i === 0 ? 12 : 0,
    "Last Sold": "2025-06-01",
    "Last Recv": "2025-06-01",
    "08-2026": i === 0 ? 0 : 5,
    Status: "A",
    _clientId: client.id,
  }));
}

function seed(dir: string) {
  const d = (p: string) => join(dir, "data", p);
  mkdirSync(d(`sales/${ALPHA.id}`), { recursive: true });
  mkdirSync(d(`sales/${BRAVO.id}`), { recursive: true });
  mkdirSync(d("store-reports/counts/2026-9-3"), { recursive: true });

  const client = (c: { id: string; name: string }, vendor: string) => ({
    id: c.id, name: c.name, vendorNumbers: [vendor], active: true, createdAt: "2026-01-01T00:00:00.000Z",
    channelIds: [CH], linkedClientIds: [], controlFiles: {}, sendConsolidatedStoreReports: true,
  });
  writeFileSync(d("clients.json"), JSON.stringify([client(ALPHA, "1063"), client(BRAVO, "7777")]));

  const meta = (c: { id: string; name: string }, vendor: string) => [{
    clientId: c.id, clientName: c.name, channelId: CH, channelName: "MAKRO", vendorNumber: vendor,
    totalRows: 2, dateColumns: ["08-2026"], mergedUploadIds: [], lastMergedAt: "2026-09-20T08:00:00.000Z",
    reportYear: 2026, reportMonth: 9, reportWeek: 3,
  }];
  writeFileSync(d(`sales/${ALPHA.id}/index.json`), JSON.stringify(meta(ALPHA, "1063")));
  writeFileSync(d(`sales/${BRAVO.id}/index.json`), JSON.stringify(meta(BRAVO, "7777")));
  writeFileSync(d(`sales/${ALPHA.id}/${CH}.json`), JSON.stringify(rows(ALPHA, [["100111", "ALPHA TINNED BEANS"], ["100222", "ALPHA RICE"]], "1063")));
  writeFileSync(d(`sales/${BRAVO.id}/${CH}.json`), JSON.stringify(rows(BRAVO, [["900111", "BRAVO-WIDGET"], ["900222", "BRAVO GADGET"]], "7777")));

  // Counts captured at this store: one per client. BRAVO's must not reach an ALPHA rep.
  const count = (c: { id: string; name: string }, article: string, found: number) => ({
    clientId: c.id, clientName: c.name, vendor: "", article, description: "", found, at: "2026-09-21T09:00:00.000Z",
  });
  writeFileSync(d(`store-reports/counts/2026-9-3/${SITE.toLowerCase()}.json`), JSON.stringify({
    siteCode: SITE, storeName: "MAKRO WOODMEAD", year: 2026, month: 9, week: 3, updatedAt: "2026-09-21T09:00:00.000Z",
    lines: {
      [`${ALPHA.id}|100111`]: count(ALPHA, "100111", 4),
      [`${BRAVO.id}|900111`]: count(BRAVO, "900111", 9),
    },
  }));
}

function leaks(text: string): string[] {
  return BRAVO_MARKERS.filter((m) => text.includes(m));
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "scope-test-"));
  const projectRoot = process.cwd();
  try {
    seed(dir);
    delete process.env.BLOB_READ_WRITE_TOKEN;          // local data/ folder, never Blob
    process.env.REPORT_LINK_SECRET = "scope-test-secret";
    process.chdir(dir);                                // blob.ts reads DATA_DIR from cwd at import

    const imp = (p: string) => import(pathToFileURL(join(projectRoot, p)).href);
    const { loadStoreReport } = await imp("lib/storeReportLoad.ts");
    const { signReportLink } = await imp("lib/reportLink.ts");
    const { renderStoreReportEmail } = await imp("lib/storeReportEmail.ts");
    const { getPhantomCounts } = await imp("lib/phantomCounts.ts");
    const rRoute = await imp("app/r/route.ts");
    const exportRoute = await imp("app/api/store-reports/phantom-export/route.ts");
    const ExcelJS = (await import("exceljs")).default;

    console.log("\nNegative controls (the test can see a leak)");
    const all = await loadStoreReport({ siteCode: SITE });
    const allIds = all.report.clients.map((c: { clientId: string }) => c.clientId).sort();
    check("unscoped report carries both clients", allIds.join(",") === `${ALPHA.id},${BRAVO.id}`, allIds.join(","));
    check("unscoped report has BRAVO lines", leaks(JSON.stringify(all.report.lines)).length > 0);
    const file = await getPhantomCounts({ siteCode: SITE, year: 2026, month: 9, week: 3 });
    check("counts file on disk holds a BRAVO count", `${BRAVO.id}|900111` in file.lines);

    console.log("\nloadStoreReport limited to ALPHA");
    const scoped = await loadStoreReport({ siteCode: SITE, clientIds: [ALPHA.id] });
    check("only ALPHA participates", scoped.report.clients.map((c: { clientId: string }) => c.clientId).join(",") === ALPHA.id);
    check("ALPHA lines present", scoped.report.lines.length === 2, String(scoped.report.lines.length));
    check("a phantom line exists (so the export test means something)", scoped.report.lines.some((l: { flags: { phantom: boolean } }) => l.flags.phantom));
    check("no BRAVO anywhere in the report object", leaks(JSON.stringify(scoped.report)).length === 0, leaks(JSON.stringify(scoped.report)).join(","));

    const none = await loadStoreReport({ siteCode: SITE, clientIds: [] });
    check("an EMPTY client list means no clients, not all", none.report.clients.length === 0 && none.report.lines.length === 0);

    console.log("\nEmail body (shows COUNTS only, so the counts must be ALPHA's alone)");
    check("scoped counts are half the store's", scoped.report.totalActions === 2 && all.report.totalActions === 4,
      `${scoped.report.totalActions} vs ${all.report.totalActions}`);
    const html = renderStoreReportEmail(scoped.report, {
      repName: "Test Rep", periodLabel: scoped.periodLabel, reportUrl: "https://example.test/r?r=x",
      generatedAt: "now", version: "test",
    });
    check("email has no BRAVO", leaks(html).length === 0, leaks(html).join(","));

    console.log("\n/r page (real handler) with an ALPHA-only signed link");
    const r = signReportLink({ site: SITE, clientIds: [ALPHA.id], year: 2026, month: 9, week: 3 });
    const pageRes: Response = await rRoute.GET(new Request(`https://example.test/r?r=${encodeURIComponent(r)}`));
    const page = await pageRes.text();
    check("page renders (200)", pageRes.status === 200, String(pageRes.status));
    check("page shows ALPHA", page.includes("ALPHA"));
    check("page source has no BRAVO (incl. embedded saved counts)", leaks(page).length === 0, leaks(page).join(","));
    check("ALPHA's own saved count is still embedded", page.includes(`${ALPHA.id}|100111`));

    console.log("\n/r page with an UNSCOPED link (iRam rep, unchanged behaviour)");
    const rAll = signReportLink({ site: SITE, year: 2026, month: 9, week: 3 });
    const pageAll = await (await rRoute.GET(new Request(`https://example.test/r?r=${encodeURIComponent(rAll)}`))).text();
    check("unscoped page still shows BRAVO", pageAll.includes("BRAVO"));

    console.log("\nTampered link");
    const [body, tag] = r.split(".");
    const decoded = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    decoded.cs = [ALPHA.id, BRAVO.id];
    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const forgedRes: Response = await rRoute.GET(new Request(`https://example.test/r?r=${encodeURIComponent(`${forgedBody}.${tag}`)}`));
    const forged = await forgedRes.text();
    check("adding BRAVO to the link is refused", forgedRes.status === 400 && leaks(forged).length === 0, String(forgedRes.status));

    console.log("\nExcel count sheet (real export handler)");
    for (const mode of ["empty", "counts"]) {
      const req = new Request("https://example.test/api/store-reports/phantom-export", {
        method: "POST",
        body: JSON.stringify({ r, action: "download", mode, vendor: "all", oneSheet: true }),
      });
      const res: Response = await exportRoute.POST(req);
      check(`export (${mode}) succeeds`, res.status === 200, `${res.status} ${res.status !== 200 ? await res.clone().text() : ""}`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      const cells: string[] = [];
      wb.eachSheet((ws) => { cells.push(ws.name); ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? "")))); });
      const text = cells.join("\n");
      check(`export (${mode}) contains ALPHA's phantom article`, text.includes("100111"));
      check(`export (${mode}) has no BRAVO`, leaks(text).length === 0, leaks(text).join(","));
    }

    console.log("\nCount save cannot write into another client");
    const countRoute = await imp("app/api/store-reports/phantom-count/route.ts");
    const saveRes: Response = await countRoute.POST(new Request("https://example.test/api/store-reports/phantom-count", {
      method: "POST",
      body: JSON.stringify({ r, counts: [
        { clientId: BRAVO.id, article: "900111", found: 0, at: "2026-09-28T09:00:00.000Z" },
        { clientId: ALPHA.id, article: "100111", found: 6, at: "2026-09-28T09:00:00.000Z" },
      ] }),
    }));
    const after = await getPhantomCounts({ siteCode: SITE, year: 2026, month: 9, week: 3 });
    check("save accepted", saveRes.status === 200, String(saveRes.status));
    check("ALPHA count updated", after.lines[`${ALPHA.id}|100111`]?.found === 6);
    check("BRAVO count untouched by an ALPHA link", after.lines[`${BRAVO.id}|900111`]?.found === 9, String(after.lines[`${BRAVO.id}|900111`]?.found));
  } finally {
    process.chdir(projectRoot);
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
