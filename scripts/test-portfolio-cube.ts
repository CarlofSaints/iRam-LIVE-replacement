/* The filterable cube — the drill-down maths, and the trap it exists to dodge. */
import {
  aggregateCube,
  cubeLines,
  flagNames,
  emptyFilter,
  filterIsEmpty,
  toggleFilter,
  FLAG_DISC,
  FLAG_LOW,
  FLAG_NEG,
  FLAG_OOS,
  FLAG_PHANTOM,
  type PortfolioCube,
} from "../lib/portfolioCube";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
  else console.log(`ok    ${name}`);
}

/* Two provinces, two profiles, two clients, four sites, three products. */
const cube: PortfolioCube = {
  version: 1,
  channelId: "ch1",
  date: "2026-09-14",
  sites: [
    { code: "M10", name: "MAKRO WOODMEAD", province: "GAUTENG", profile: "STORE" },
    { code: "M15", name: "MAKRO STRUBENS", province: "GAUTENG", profile: "STORE" },
    { code: "M19", name: "MAKRO CAPE GATE", province: "WESTERN CAPE", profile: "STORE" },
    { code: "D01", name: "MAKRO DC", province: "WESTERN CAPE", profile: "DC" },
  ],
  clients: [
    { id: "c1", name: "CLIPPA SALES" },
    { id: "c2", name: "FUNKI LINES" },
  ],
  articles: [
    { code: "A1", description: "MENTOS ROLL FRUIT" },
    { code: "A2", description: "FAUNA WILD BIRD 8KG" },
    { code: "A3", description: "" },
  ],
  rows: [
    [0, 0, 0, FLAG_OOS],                        // M10 GAUTENG STORE c1 A1
    [0, 1, 1, FLAG_OOS | FLAG_PHANTOM],         // M10 GAUTENG STORE c2 A2
    [1, 0, 0, FLAG_PHANTOM],                    // M15 GAUTENG STORE c1 A1
    [2, 0, 2, FLAG_OOS | FLAG_NEG],             // M19 W CAPE  STORE c1 A3
    [3, 1, 1, FLAG_LOW | FLAG_DISC],            // D01 W CAPE  DC    c2 A2
  ],
  activeLines: 9999,
};

// ── Unfiltered ──
const all = aggregateCube(cube, emptyFilter());
check("out of stock across the portfolio", all.totals.oos, 3);
check("phantom", all.totals.phantom, 2);
check("negative SOH", all.totals.negSoh, 1);
check("low cover", all.totals.lowCover, 1);
check("discontinued", all.totals.discontinued, 1);
check("a line carrying two flags counts in both", all.lines, 5);
check("distinct sites", all.sites, 4);
check("distinct clients", all.clients, 2);
check("distinct products", all.products, 3);

// ── Filter to a province ──
const wc = aggregateCube(cube, { ...emptyFilter(), provinces: ["WESTERN CAPE"] });
check("province filter narrows the headline", wc.totals.oos, 1);
check("...and the other measures", [wc.totals.negSoh, wc.totals.lowCover, wc.totals.discontinued], [1, 1, 1]);
check("...and phantom drops out entirely", wc.totals.phantom, 0);
check("...sites narrow", wc.sites, 2);

/* ⚠️ THE TRAP: the dimension you filtered ON must keep every row, or the table
   collapses to the one row you clicked and there is no way back to Gauteng
   without clearing first. Every OTHER table narrows. */
check("the province table still shows BOTH provinces", wc.byProvince.map((r) => r.label).sort(), ["GAUTENG", "WESTERN CAPE"]);
check("the province table's own numbers are unfiltered", wc.byProvince.find((r) => r.label === "GAUTENG")?.counts.oos, 2);
check("but the client table narrows to Western Cape", wc.byClient.map((r) => r.label).sort(), ["CLIPPA SALES", "FUNKI LINES"]);
check("client counts are the Western Cape ones", wc.byClient.find((r) => r.label === "CLIPPA SALES")?.counts.oos, 1);
check("and the site table narrows", wc.bySite.map((r) => r.label).sort(), ["D01", "M19"]);
check("and the profile table narrows to profiles present in W Cape", wc.bySiteProfile.map((r) => r.label).sort(), ["DC", "STORE"]);

// ── Filters stack across dimensions ──
const wcClippa = aggregateCube(cube, { ...emptyFilter(), provinces: ["WESTERN CAPE"], clients: ["c1"] });
check("province + client stack", wcClippa.totals.oos, 1);
check("...excluding the other client's line", wcClippa.totals.lowCover, 0);
check("...one site left", wcClippa.sites, 1);
check("the client table still lists both clients", wcClippa.byClient.length, 2);
check("the province table still lists both provinces", wcClippa.byProvince.length, 2);

// ── Drill to a single store, then a single product ──
const site = aggregateCube(cube, { ...emptyFilter(), sites: ["M10"] });
check("one store", [site.totals.oos, site.totals.phantom], [2, 1]);
check("...two products in it", site.products, 2);
const prod = aggregateCube(cube, { ...emptyFilter(), articles: ["A2"] });
check("one product across the channel", [prod.totals.oos, prod.totals.phantom, prod.totals.lowCover], [1, 1, 1]);
check("...in two sites", prod.sites, 2);

// ── Toggling ──
let f = emptyFilter();
check("starts empty", filterIsEmpty(f), true);
f = toggleFilter(f, "provinces", "GAUTENG");
check("click adds", f.provinces, ["GAUTENG"]);
f = toggleFilter(f, "provinces", "WESTERN CAPE");
check("second click on the same dimension adds, not replaces", f.provinces, ["GAUTENG", "WESTERN CAPE"]);
f = toggleFilter(f, "provinces", "GAUTENG");
check("clicking a selected row removes it", f.provinces, ["WESTERN CAPE"]);
f = toggleFilter(f, "provinces", "WESTERN CAPE");
check("and back to empty", filterIsEmpty(f), true);

// Two provinces selected = union, not intersection (which would be nothing)
const bothProv = aggregateCube(cube, { ...emptyFilter(), provinces: ["GAUTENG", "WESTERN CAPE"] });
check("multi-select within a dimension is a UNION", bothProv.totals.oos, 3);

// A filter matching nothing is empty, not everything
const none = aggregateCube(cube, { ...emptyFilter(), sites: ["NOPE"] });
check("a filter that matches nothing yields zero, not all", none.totals.oos, 0);
check("...and no lines", none.lines, 0);

// A blank product description must not collapse two articles into one row
check("products keyed by CODE, not description", all.byProduct.length, 3);

// ── The underlying lines behind a drill-down ──
const woodmead = cubeLines(cube, emptyFilter(), { dim: "sites", value: "M10" }, 25);
check("expanding a site shows its lines", woodmead.total, 2);
check("...with the products in it", woodmead.lines.map((l) => l.article).sort(), ["A1", "A2"]);
check("...and which client each belongs to", woodmead.lines.map((l) => l.clientName).sort(), ["CLIPPA SALES", "FUNKI LINES"]);

check(
  "worst first — a line with two measures outranks one with one",
  woodmead.lines[0].flags,
  FLAG_OOS | FLAG_PHANTOM,
);
check("measures render as names", flagNames(FLAG_OOS | FLAG_PHANTOM), ["Out of stock", "Phantom"]);

/* ⚠️ The arrow means "show me THIS row". Expanding Western Cape while Gauteng
   is also selected must show Western Cape, not nothing — the pinned dimension
   REPLACES its own filter rather than intersecting with it. */
const pinnedAgainstFilter = cubeLines(
  cube,
  { ...emptyFilter(), provinces: ["GAUTENG"] },
  { dim: "provinces", value: "WESTERN CAPE" },
  25,
);
check("expanding a row not in the current filter still shows it", pinnedAgainstFilter.total, 2);
check("...and shows that province's sites", pinnedAgainstFilter.lines.map((l) => l.siteCode).sort(), ["D01", "M19"]);

// Other dimensions' filters still apply while expanded
const pinnedWithOther = cubeLines(
  cube,
  { ...emptyFilter(), clients: ["c1"] },
  { dim: "provinces", value: "WESTERN CAPE" },
  25,
);
check("a filter on ANOTHER dimension still narrows the detail", pinnedWithOther.total, 1);
check("...to that client's line", pinnedWithOther.lines[0].article, "A3");

// Paging the detail
const firstOne = cubeLines(cube, emptyFilter(), null, 1);
check("the limit caps what comes back", firstOne.lines.length, 1);
check("...but the total is the real total", firstOne.total, 5);
const unlimited = cubeLines(cube, emptyFilter(), null, 0);
check("limit 0 means everything", unlimited.lines.length, 5);

// Load more on the breakdown tables: topN 0 must not truncate
const everyProduct = aggregateCube(cube, emptyFilter(), 0);
check("topN 0 returns every product row", everyProduct.byProduct.length, 3);
const cappedProducts = aggregateCube(cube, emptyFilter(), 2);
check("a topN still caps", cappedProducts.byProduct.length, 2);
check("and keeps the worst ones", cappedProducts.byProduct[0].counts.oos >= cappedProducts.byProduct[1].counts.oos, true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
