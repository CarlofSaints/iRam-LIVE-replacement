/* The weekly Portfolio Stock Health email.

   The assertions that matter most are the LEAK ones: a client-scoped recipient
   must never see another client's numbers, name, or store, no matter which
   part of the mail it would have appeared in. */
import { buildPortfolioHealthEmail } from "../lib/portfolioHealthEmail";
import { FLAG_OOS, FLAG_PHANTOM, FLAG_LOW, type PortfolioCube } from "../lib/portfolioCube";
import type { PortfolioHealth } from "../lib/portfolioHealth";
import type { ComparisonPoint } from "../lib/portfolioSnapshot";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

const cube: PortfolioCube = {
  version: 1,
  channelId: "ch1",
  date: "2026-09-17",
  sites: [
    { code: "M10", name: "MAKRO WOODMEAD", province: "GAUTENG", profile: "STORE" },
    { code: "M19", name: "MAKRO CAPE GATE", province: "WESTERN CAPE", profile: "STORE" },
  ],
  clients: [
    { id: "c1", name: "CLIPPA SALES" },
    { id: "c2", name: "FUNKI LINES" },
  ],
  articles: [
    { code: "A1", description: "MENTOS ROLL FRUIT" },
    { code: "A2", description: "DREMEL ENGRAVER" },
  ],
  rows: [
    [0, 0, 0, FLAG_OOS],
    [0, 0, 1, FLAG_PHANTOM],
    [1, 1, 0, FLAG_OOS | FLAG_LOW],
    [1, 1, 1, FLAG_OOS],
  ],
  activeLines: 500,
};

const health: PortfolioHealth = {
  sites: 2, clients: 2, productsFlagged: 2, activeLines: 500, baseLines: 500,
  totals: { oos: 3, lowCover: 1, phantom: 1, negSoh: 0, discontinued: 0 },
  byProvince: [], bySiteProfile: [], byClient: [], bySite: [], byProduct: [],
  excluded: [
    { clientId: "c2", clientName: "FUNKI LINES", vendor: "8069", lastData: "2026-09-02T06:00:00.000Z", linesRemoved: 12 },
  ],
  freshness: [
    { clientId: "c1", clientName: "CLIPPA SALES", lastData: "2026-09-16T05:00:00.000Z", hasStaleVendor: false },
    { clientId: "c2", clientName: "FUNKI LINES", lastData: "2026-09-02T06:00:00.000Z", hasStaleVendor: true },
  ],
  discontinuedConfigured: false,
};

const comparisons: ComparisonPoint[] = [
  { label: "Previous capture", date: "2026-09-10", driftDays: 0,
    counts: { oos: 5, lowCover: 2, phantom: 3, negSoh: 0, discontinued: 0 } },
];

function build(clientIds: string[]) {
  return buildPortfolioHealthEmail({
    channelName: "MAKRO",
    periodLabel: "Sep 2026 Wk2",
    captureDate: "2026-09-17",
    health, cube, comparisons,
    reportUrl: "https://example.test/portfolio-health",
    recipient: { name: "Test", email: "t@example.test", clientIds },
  });
}

// ── Internal staff: everything ──
const internal = build([]);
check("internal recipient gets a mail", internal.hasContent, true);
check("subject names the channel and period", internal.subject, "MAKRO stock health — Sep 2026 Wk2");
check("headline out of stock is the whole channel", internal.html.includes(">3<"), true);
check("both clients appear in the freshness table",
  internal.html.includes("CLIPPA SALES") && internal.html.includes("FUNKI LINES"), true);
check("the excluded-vendor note is shown", internal.html.includes("excluded from every figure"), true);
check("week-on-week arrow is shown", internal.html.includes("▼"), true);

// ── Scoped recipient: ONLY their client ──
const scoped = build(["c1"]);
check("scoped recipient gets a mail", scoped.hasContent, true);
check("subject says it is scoped", scoped.subject, "MAKRO stock health — your clients — Sep 2026 Wk2");

/* 🔴 THE LEAK TESTS. Clippa's numbers are 1 OOS and 1 phantom; Funki's are
   2 OOS and 1 low cover. None of Funki's name, stores or figures may appear. */
check("the other client's NAME is nowhere in the mail", scoped.html.includes("FUNKI LINES"), false);
check("the other client's STORE is nowhere in the mail", scoped.html.includes("CAPE GATE"), false);
check("their own client is present", scoped.html.includes("CLIPPA SALES"), true);
check("their own store is present", scoped.html.includes("WOODMEAD"), true);
check("the excluded note (another client's vendor) is withheld", scoped.html.includes("excluded from every figure"), false);

/* The comparison figures are PORTFOLIO-WIDE totals from an older capture with
   no cube to filter. Showing them to a scoped reader would put everybody's
   numbers in their mail through the back door. */
check("no week-on-week arrows for a scoped reader", scoped.html.includes("▲") || scoped.html.includes("▼"), false);
check("...the prior total does not appear either", scoped.html.includes("vs 5"), false);

// ── A scoped recipient with nothing wrong gets NO mail ──
const quietCube: PortfolioCube = { ...cube, rows: [[0, 0, 0, FLAG_OOS]] };
const quiet = buildPortfolioHealthEmail({
  channelName: "MAKRO", periodLabel: "Sep 2026 Wk2", captureDate: "2026-09-17",
  health, cube: quietCube, comparisons,
  reportUrl: "https://example.test/portfolio-health",
  recipient: { name: "T", email: "t@example.test", clientIds: ["c2"] },
});
check("a scoped reader with nothing wrong is not mailed", quiet.hasContent, false);

// ── No cube (an older capture) ──
const noCubeScoped = buildPortfolioHealthEmail({
  channelName: "MAKRO", periodLabel: "Sep 2026 Wk2", captureDate: "2026-09-17",
  health, cube: null, comparisons,
  reportUrl: "https://example.test/portfolio-health",
  recipient: { name: "T", email: "t@example.test", clientIds: ["c1"] },
});
check("without a cube a SCOPED reader is not mailed at all", noCubeScoped.hasContent, false);
const noCubeInternal = buildPortfolioHealthEmail({
  channelName: "MAKRO", periodLabel: "Sep 2026 Wk2", captureDate: "2026-09-17",
  health, cube: null, comparisons,
  reportUrl: "https://example.test/portfolio-health",
  recipient: { name: "T", email: "t@example.test", clientIds: [] },
});
check("but an internal reader still gets the stored totals", noCubeInternal.hasContent, true);

// ── The freshness table, which is the whole point of the send-time answer ──
check("freshness table is present", internal.html.includes("When each client&#39;s data last arrived") ||
  internal.html.includes("When each client's data last arrived"), true);
check("a client's last DISPO date is printed", internal.html.includes("16 Sept 2026") || internal.html.includes("16 Sep 2026"), true);
check("a stale client is called out", internal.html.includes("a vendor was excluded"), true);

// ── An unconfigured measure says so rather than printing zero ──
check("discontinued reads Not configured", internal.html.includes("Not configured"), true);

// ── The overlap warning travels with the numbers ──
check("the do-not-add note is in the mail", internal.html.includes("must not be added together"), true);

// ── Escaping ──
const nasty = buildPortfolioHealthEmail({
  channelName: `MAKRO <script>alert(1)</script>`,
  periodLabel: "Sep 2026 Wk2", captureDate: "2026-09-17",
  health, cube, comparisons,
  reportUrl: "https://example.test/portfolio-health",
  recipient: { name: "T", email: "t@example.test", clientIds: [] },
});
check("channel name is HTML-escaped in the body", nasty.html.includes("<script>"), false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
