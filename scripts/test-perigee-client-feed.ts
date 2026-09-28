/* Per-client Perigee feed, end to end through the REAL poller.

   The network is faked at fetch(): the SQL proxy (main iRam feed), the Perigee
   /api/visits endpoint (ALPHA's own feed) and Resend (the emails). Everything
   between them is the production code: runStoreReportSync, the scope rules,
   loadStoreReport, link signing, the dedup + audit ledgers.

   Store M27 carries two clients, ALPHA and BRAVO. ALPHA has a feed. On it:
     • ALPHA's own rep (set up under Users, limited to ALPHA)  → ALPHA-only report
     • an iRam rep also in the main feed                       → main feed's report, feed copy skipped
     • a stranger with no account (a wrong, too-wide token)    → nothing
     • BRAVO's rep (limited to BRAVO)                          → nothing
   Then the feed fails (401): the main feed still runs and the failure is named.

   Run: npx tsx scripts/test-perigee-client-feed.ts                            */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

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
const IRAM_REP = "iram.rep@iram.co.za";
const ALPHA_REP = "cust.rep@alpha.co.za";
const STRANGER = "stranger@other.co.za";
const BRAVO_REP = "rep@bravo.co.za";
const MULTI_REP = "both@alpha.co.za";      // ticked for ALPHA and BRAVO
const ALPHA_REP_2 = "second@alpha.co.za";  // only checks in during run 3

function seed(dir: string) {
  const d = (p: string) => join(dir, "data", p);
  for (const p of [`sales/${ALPHA.id}`, `sales/${BRAVO.id}`, "store-reports"]) mkdirSync(d(p), { recursive: true });
  const client = (c: { id: string; name: string }, vendor: string) => ({
    id: c.id, name: c.name, vendorNumbers: [vendor], active: true, createdAt: "2026-01-01T00:00:00.000Z",
    channelIds: [CH], linkedClientIds: [], controlFiles: {}, sendConsolidatedStoreReports: true,
  });
  writeFileSync(d("clients.json"), JSON.stringify([client(ALPHA, "1063"), client(BRAVO, "7777")]));
  const meta = (c: { id: string; name: string }, vendor: string) => [{
    clientId: c.id, clientName: c.name, channelId: CH, channelName: "MAKRO", vendorNumber: vendor, totalRows: 1,
    dateColumns: ["08-2026"], mergedUploadIds: [], lastMergedAt: "2026-09-20T08:00:00.000Z",
    reportYear: 2026, reportMonth: 9, reportWeek: 3,
  }];
  const row = (article: string, desc: string, vendor: string) => [{
    Site: SITE, "Site Name": "MAKRO WOODMEAD", Article: article, "Article Desc": desc, Vendor: `${vendor} X`,
    _vendor: vendor, _lastLoadedAt: "2026-09-20T08:00:00.000Z", SOH: 0, "08-2026": 5, Status: "A",
  }];
  writeFileSync(d(`sales/${ALPHA.id}/index.json`), JSON.stringify(meta(ALPHA, "1063")));
  writeFileSync(d(`sales/${BRAVO.id}/index.json`), JSON.stringify(meta(BRAVO, "7777")));
  writeFileSync(d(`sales/${ALPHA.id}/${CH}.json`), JSON.stringify(row("100111", "ALPHA BEANS", "1063")));
  writeFileSync(d(`sales/${BRAVO.id}/${CH}.json`), JSON.stringify(row("900111", "BRAVO-WIDGET", "7777")));

  const user = (email: string, extra: Record<string, unknown>) => ({
    id: email, name: email, email, password: "", role: "rep", forcePasswordChange: false, active: true,
    createdAt: "2026-09-28T00:00:00.000Z", ...extra,
  });
  writeFileSync(d("users.json"), JSON.stringify([
    user("admin@iram.co.za", { role: "admin" }),
    user(ALPHA_REP, { storeReportOwnClientsOnly: true, storeReportClientIds: [ALPHA.id] }),
    user(BRAVO_REP, { storeReportOwnClientsOnly: true, storeReportClientIds: [BRAVO.id] }),
    user(MULTI_REP, { storeReportOwnClientsOnly: true, storeReportClientIds: [ALPHA.id, BRAVO.id] }),
    user(ALPHA_REP_2, { storeReportOwnClientsOnly: true, storeReportClientIds: [ALPHA.id] }),
  ]));
  writeFileSync(d("store-reports/sync.json"), JSON.stringify({ enabled: true, channels: ["Makro"], minIntervalSeconds: 0 }));
}

// ── Fake network ──
const sent: { to: string; html: string }[] = [];
let feedMode: "ok" | "401" | "page2-fails" = "ok";
let sqlDown = false;
const perigeeCalls: { auth: string; body: Record<string, unknown> }[] = [];

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://sql-proxy.test/query")) {
      if (sqlDown) return new Response("proxy down", { status: 502 });
      return json({ count: 1, data: [{ id: "sql-1", storeCode: SITE, channelName: "Makro", StoreName: "MAKRO WOODMEAD", email: IRAM_REP, UserName: "Iram Rep" }] });
    }
    if (url.startsWith("https://perigee.test/api/visits")) {
      const headers = new Headers(init?.headers);
      perigeeCalls.push({ auth: headers.get("authorization") ?? "", body: JSON.parse(String(init?.body ?? "{}")) });
      if (feedMode === "401") return new Response("Unauthenticated. SECRET-ECHO", { status: 401 });
      if (feedMode === "page2-fails") {
        const page = Number(JSON.parse(String(init?.body ?? "{}")).page ?? 1);
        if (page > 1) return new Response("boom", { status: 500 });
        return json({ visits: { current_page: 1, last_page: 2, total: 2, data: [
          { id: 21, storeCode: SITE, email: ALPHA_REP_2, displayName: "Second", channel: "Makro" },
        ] } });
      }
      return json({ visits: { current_page: 1, last_page: 1, total: 5, data: [
        { id: 16, storeCode: SITE, email: MULTI_REP, displayName: "Both", channel: "Makro" },
        { id: 11, store: "MAKRO WOODMEAD - M27", email: ALPHA_REP, displayName: "Alpha Rep", channel: "Makro" },
        { id: 12, storeCode: SITE, email: IRAM_REP, displayName: "Iram Rep", channel: "Makro" },
        { id: 13, storeCode: SITE, email: STRANGER, displayName: "Stranger", channel: "Makro" },
        { id: 14, storeCode: SITE, username: BRAVO_REP, displayName: "Bravo Rep", channel: "Makro" },
      ] } });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      const b = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: Array.isArray(b.to) ? b.to.join(",") : b.to, html: b.html });
      return json({ id: `email-${sent.length}` });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "feed-test-"));
  const root = process.cwd();
  try {
    seed(dir);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.SQL_PROXY_URL = "https://sql-proxy.test";
    process.env.SQL_PROXY_API_KEY = "k";
    process.env.PERIGEE_VISITS_URL = "https://perigee.test/api/visits";
    process.env.RESEND_API_KEY = "re_test";
    process.env.REPORT_LINK_SECRET = "feed-test-secret";
    installFetch();
    process.chdir(dir);
    const imp = (p: string) => import(pathToFileURL(join(root, p)).href);

    const { runStoreReportSync } = await imp("lib/storeReportRunner.ts");
    const { verifyReportLink, linkClientIds } = await imp("lib/reportLink.ts");
    const { trackingDay } = await imp("lib/storeReportTracking.ts");
    const { upsertPerigeeFeed } = await imp("lib/perigeeFeeds.ts");
    await upsertPerigeeFeed(ALPHA.id, { token: "tok-alpha-SECRET", enabled: true }, "test");

    console.log("\nToken at rest");
    const feedsFile = readFileSync(join(dir, "data/store-reports/perigee-feeds.json"), "utf8");
    check("the stored file does NOT contain the token", !feedsFile.includes("tok-alpha-SECRET") && !feedsFile.includes("alpha-SEC"));
    check("…only its ending, for display", JSON.parse(feedsFile)[0].tokenEnding === "CRET");

    console.log("\nRun 1: main feed + ALPHA's feed");
    const res = await runStoreReportSync({ force: true, origin: "https://app.test" });
    const byEmail = (e: string) => res.outcomes.filter((o: { repEmail: string }) => o.repEmail === e);

    check("Perigee called with the decrypted token as a Bearer", perigeeCalls[0]?.auth === "Bearer tok-alpha-SECRET", perigeeCalls[0]?.auth);
    check("…for today (SAST) only", perigeeCalls[0]?.body.startDate === trackingDay() && perigeeCalls[0]?.body.endDate === trackingDay());
    check("6 visits seen (1 main + 5 feed)", res.visitsSeen === 6, String(res.visitsSeen));
    check("exactly 3 emails sent", sent.length === 3, sent.map((s) => s.to).join(","));

    const linkOf = (html: string) => {
      const m = /\/r\?r=([^&"]+)/.exec(html);
      if (!m) return null;
      const v = verifyReportLink(decodeURIComponent(m[1]));
      return v.ok ? linkClientIds(v.payload) ?? "ALL" : "BAD";
    };
    const iram = sent.find((s) => s.to === IRAM_REP);
    const cust = sent.find((s) => s.to === ALPHA_REP);
    check("iRam rep got the consolidated report (unchanged)", !!iram && linkOf(iram.html) === "ALL", String(iram && linkOf(iram.html)));
    check("ALPHA's rep got a report limited to ALPHA", !!cust && JSON.stringify(linkOf(cust.html)) === JSON.stringify([ALPHA.id]), JSON.stringify(cust && linkOf(cust.html)));
    check("ALPHA rep's code parsed from 'NAME - M27'", byEmail(ALPHA_REP)[0]?.siteCode === SITE);
    check("stranger on the feed got nothing", !sent.some((s) => s.to === STRANGER) && byEmail(STRANGER)[0]?.status === "skipped-feed-not-client-rep");
    check("BRAVO's rep on ALPHA's feed got nothing", !sent.some((s) => s.to === BRAVO_REP) && byEmail(BRAVO_REP)[0]?.status === "skipped-feed-not-client-rep",
      JSON.stringify(byEmail(BRAVO_REP)));
    check("iRam rep's feed copy skipped as a duplicate", byEmail(IRAM_REP).some((o: { status: string; feed?: string }) => o.status === "skipped-duplicate" && o.feed));
    const multi = sent.find((s) => s.to === MULTI_REP);
    check("rep ticked for ALPHA+BRAVO, on ALPHA's feed → ALPHA ONLY", !!multi && JSON.stringify(linkOf(multi.html)) === JSON.stringify([ALPHA.id]),
      JSON.stringify(multi && linkOf(multi.html)));

    const runsPath = join(dir, "data/store-reports/perigee-feed-runs.json");
    const runs = JSON.parse(readFileSync(runsPath, "utf8"));
    check("last poll recorded in its OWN file (ok, 5 visits)", runs[ALPHA.id]?.ok === true && runs[ALPHA.id]?.visits === 5, JSON.stringify(runs));
    check("token file not rewritten by the run", readFileSync(join(dir, "data/store-reports/perigee-feeds.json"), "utf8") === feedsFile);

    const audit = JSON.parse(readFileSync(join(dir, `data/store-reports/audit/${trackingDay()}.json`), "utf8"));
    check("audit names the feed on feed rows", audit.some((r: { detail?: string; repEmail: string }) => r.repEmail === STRANGER && r.detail?.startsWith("[ALPHA FOODS feed]")),
      JSON.stringify(audit.find((r: { repEmail: string }) => r.repEmail === STRANGER)));

    console.log("\nRun 2: the feed now refuses the token (401)");
    feedMode = "401";
    const before = sent.length;
    const res2 = await runStoreReportSync({ force: true, origin: "https://app.test" });
    check("run still completes", res2.visitsSeen === 1, String(res2.visitsSeen));
    check("run message names the feed by CLIENT NAME", /ALPHA FOODS feed failed: Perigee refused the token \(401\)/.test(res2.message ?? ""), res2.message);
    check("Perigee's response body is NOT stored or shown", !(res2.message ?? "").includes("SECRET-ECHO")
      && !readFileSync(runsPath, "utf8").includes("SECRET-ECHO"));
    check("run marked not-ok", res2.ok === false);
    check("nothing re-sent (dedup held)", sent.length === before);
    const runs2 = JSON.parse(readFileSync(runsPath, "utf8"));
    check("feed's last poll recorded as failed", runs2[ALPHA.id]?.ok === false && /401/.test(runs2[ALPHA.id]?.error ?? ""));

    console.log("\nRun 3: main feed DOWN, and the client feed's page 2 fails");
    sqlDown = true;
    feedMode = "page2-fails";
    const res3 = await runStoreReportSync({ force: true, origin: "https://app.test" });
    check("client feed still polled while the main feed is down", sent.some((s) => s.to === ALPHA_REP_2), res3.message);
    check("run message names the main feed failure", /Main feed failed/.test(res3.message ?? ""), res3.message);
    const runs3 = JSON.parse(readFileSync(runsPath, "utf8"));
    check("partial read recorded as NOT ok", runs3[ALPHA.id]?.ok === false && /only part/.test(runs3[ALPHA.id]?.error ?? ""), JSON.stringify(runs3[ALPHA.id]));
  } finally {
    process.chdir(root);
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
