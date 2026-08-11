/* ──────────────────────────────────────────────────────────────
   Store Report — hosted ACTION-LIST page renderer.

   The interactive page behind the email's "Open your report" button
   (matches Mark Blackburn's ARIA layout): navy banner + (i) info, a CLIENT
   filter, KPI cards that act as filters (+ "All products"), search,
   "Most urgent" sort, expandable line items (DROS / days cover / status /
   vendor status / ranging detail), tick-off → Completed, and an info modal
   describing OUR calculations.

   Self-contained HTML: inline CSS + vanilla JS, report data embedded as JSON.
   Tick state persists in localStorage keyed by the report id (site+period).
   ────────────────────────────────────────────────────────────── */

import type { StoreReport } from "./storeReport";

export interface StoreReportPageMeta {
  periodLabel: string;       // e.g. "Week ending 25 Jun 2026" or "Wk 4 · Jun 2026"
  generatedAt: string;       // "26 Jun 2026 at 13:36"
  version: string;           // "iRam LIVE v1.0.0"
  reportId: string;          // stable id for localStorage tick state (e.g. "MW35-2026-06-4")
  iramLogoUrl?: string;
  outerjoinLogoUrl?: string;
  retailerLogoUrl?: string;
  track?: { url: string; token: string; day: string };  // engagement beacons
  // Endpoints + signed token for the page's own calls: saving stock counts and
  // exporting / emailing the phantom count sheet. Absent → those features hide.
  api?: { countUrl: string; exportUrl: string; token: string };
  savedCounts?: Record<string, number>;   // `clientId|article` → units already counted
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Safe-embed JSON into an inline <script>: escape characters that would either
// break out of the <script> tag (`<`, `>`, `&` → `</script>`, `<!--`) or are
// illegal as raw JS string content (U+2028 / U+2029 line separators). Without
// this, a single odd character in real DISPO data blanks the whole page.
function embedJson(value: unknown): string {
  // U+2028 / U+2029 referenced by code point so no literal separator chars sit
  // in this source file (they are invisible and easy to mangle).
  const SEP = new RegExp("[\\u2028\\u2029]", "g");
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(SEP, (ch) => (ch.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"));
}

export function renderStoreReportPage(report: StoreReport, meta: StoreReportPageMeta): string {
  const data = embedJson({ report, meta });
  const subline = [report.siteCode, report.subChannel, meta.periodLabel].filter(Boolean).map(esc).join(" &middot; ");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock Action Report — ${esc(report.storeName || report.siteCode)}</title>
<style>
  :root{--navy:#1c3d5a;--navy-d:#16314a;--red:#df332c;--redbg:#fdecec;--green:#2e9e5b;--blue:#1f5fa8;--ink:#27313b;--grey:#6b7280;--line:#e6eaee;--bg:#eef1f4}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  .wrap{max-width:620px;margin:0 auto;padding:0 0 60px}
  .banner{background:var(--navy);color:#fff;padding:16px 20px;position:sticky;top:0;z-index:5}
  .banner .kicker{font:700 11px/1 Arial;letter-spacing:1px;color:#aebfcf}
  .banner h1{margin:8px 0 4px;font-size:24px}
  .banner .sub{font-size:13px;color:#b9c6d4}
  .ibtn{position:absolute;top:14px;right:16px;width:30px;height:30px;border-radius:50%;background:#2c577d;color:#fff;border:0;font-weight:700;cursor:pointer;font-size:15px}
  .pad{padding:14px 16px}
  select,input{font:inherit}
  .client{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
  .fresh{font-size:11.5px;color:var(--grey);padding:8px 2px 0;line-height:1.6}
  .fresh b{color:#46525e;font-weight:600}
  .fresh .stale{color:var(--red);font-weight:600}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
  .card{border:2px solid transparent;border-radius:12px;padding:14px 8px;text-align:center;cursor:pointer;background:var(--redbg);user-select:none}
  .card .n{font:700 26px/1 Arial;color:var(--red)}
  .card .l{font-size:11px;color:#9a4a46;margin-top:6px}
  .card.green{background:#e9f6ee}.card.green .n{color:var(--green)}.card.green .l{color:#2c6b46}
  .card.all{background:#e9f0f8}.card.all .n{color:var(--blue)}.card.all .l{color:#2b557f}
  .card.sel{border-color:var(--blue)}
  .card.done{background:#e9f6ee!important}.card.done .n{color:var(--green)!important}
  .tools{display:flex;gap:8px;margin-top:12px}
  .tools input{flex:1;padding:11px 14px;border:1px solid var(--line);border-radius:10px}
  .sort{padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);cursor:pointer}
  .listhead{display:flex;justify-content:space-between;color:var(--grey);font-size:12px;padding:14px 4px 6px}
  .item{background:#fff;border-top:1px solid var(--line)}
  .row{display:flex;align-items:flex-start;gap:10px;padding:14px 12px;cursor:pointer}
  .ck{width:20px;height:20px;margin-top:2px;flex:0 0 auto;accent-color:var(--green)}
  .main{flex:1;min-width:0}
  .nm{font-weight:600;font-size:14.5px}
  .meta{color:var(--grey);font-size:11.5px;margin-top:3px}
  .meta b{color:#46525e;font-weight:600}
  .chips{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px}
  .chip{font:600 10px/1 Arial;padding:5px 7px;border-radius:5px;background:var(--redbg);color:#b23b35}
  .chip.g{background:#e9f6ee;color:#2c6b46}
  .metric{flex:0 0 auto;text-align:right;white-space:nowrap}
  .metric .v{color:var(--red);font-weight:700}.metric .u{color:var(--grey);font-size:11px}
  .chev{flex:0 0 auto;color:#aab2bb;font-size:13px;margin-top:2px;transition:transform .15s}
  .item.open .chev{transform:rotate(180deg)}
  .detail{display:none;padding:0 14px 16px 42px}
  .item.open .detail{display:block}
  .alert{background:var(--redbg);color:#b23b35;border-radius:8px;padding:11px 12px;font-weight:600;font-size:13.5px;display:flex;gap:8px;align-items:center}
  .alert.g{background:#e9f6ee;color:#256a41;margin-top:12px}
  .grid{margin-top:12px;border:1px solid var(--line);border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px 10px}
  .g .k{color:var(--grey);font-size:11px}.g .val{font-weight:600;font-size:14px;margin-top:2px}
  .item.tick .nm{text-decoration:line-through;color:#9aa3ad}
  .item{transition:opacity .25s ease, background-color .25s ease}
  .item.tick{opacity:.7}
  .item.leaving{background:#e9f6ee}
  .found{display:flex;align-items:center;gap:8px;margin-top:9px}
  .found label{font-size:11.5px;color:var(--grey);font-weight:600}
  .found input{width:88px;padding:8px 10px;border:1px solid #d3d9df;border-radius:8px;background:#fffbef;font-size:14px;text-align:right}
  .found input:focus{outline:2px solid var(--blue);outline-offset:-1px;background:#fff}
  .found .ok{font-size:11px;color:var(--green);font-weight:600}
  .found .pend{font-size:11px;color:#b07d1a;font-weight:600}
  .xp{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px}
  .xp h3{margin:0 0 4px;font-size:14px}
  .xp .hint{font-size:11.5px;color:var(--grey);line-height:1.5;margin-bottom:12px}
  .xp .fld{margin-bottom:10px}
  .xp .fld > span{display:block;font-size:11.5px;color:var(--grey);font-weight:600;margin-bottom:5px}
  .xp select,.xp input[type=email]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink)}
  .xp .seg{display:flex;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden}
  .xp .seg button{flex:1;padding:10px 8px;border:0;background:#fff;color:var(--ink);font-size:12.5px;cursor:pointer}
  .xp .seg button.on{background:var(--navy);color:#fff;font-weight:600}
  .xp .cb{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:#46525e;margin-bottom:12px;cursor:pointer}
  .xp .cb input{width:18px;height:18px;margin:1px 0 0;flex:0 0 auto;accent-color:var(--navy)}
  .xp .acts{display:flex;gap:8px}
  .xp .acts button{flex:1;padding:12px;border:0;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer}
  .xp .dl{background:var(--navy);color:#fff}
  .xp .em{background:#e9f0f8;color:var(--navy);border:1px solid #c6d6e8!important}
  .xp .acts button:disabled{opacity:.55;cursor:default}
  .xp .msg{margin-top:10px;font-size:12.5px;border-radius:8px;padding:10px 12px;line-height:1.5}
  .xp .msg.good{background:#e9f6ee;color:#256a41}
  .xp .msg.bad{background:var(--redbg);color:#b23b35}
  .secttl{padding:18px 6px 2px;font:700 13px Arial;color:var(--grey)}
  .empty{padding:26px 16px;text-align:center;color:#9aa3ad;font-size:13px}
  .disclaimer{margin:14px 16px 0;padding:13px 15px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--grey);font-size:11.5px;line-height:1.65}
  .foot{text-align:center;color:#9aa3ad;font-size:11px;padding:22px 16px}
  .foot .logos{display:flex;justify-content:center;gap:18px;align-items:center;margin-bottom:10px}
  .foot img{height:24px}
  .modal{position:fixed;inset:0;background:rgba(20,32,48,.55);display:none;z-index:20;padding:18px;overflow:auto}
  .modal.on{display:block}
  .sheet{max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden}
  .sheet .h{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}
  .sheet .h b{font-size:17px}.sheet .x{border:0;background:#eef1f4;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px}
  .sheet .b{padding:16px 18px}
  .note{background:#eef4fb;border-radius:8px;padding:12px 14px;font-size:13px;color:#3a536e;margin-bottom:8px}
  .def{padding:12px 0;border-bottom:1px solid var(--line)}
  .def .t{font-weight:700;font-size:14px}.def .t .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
  .def p{margin:5px 0 0;font-size:13px;color:#55606b}
</style></head>
<body>
<div class="wrap">
  <div class="banner">
    <button class="ibtn" onclick="openInfo()">i</button>
    <div class="kicker">STOCK ACTION REPORT</div>
    <h1 id="storeName"></h1>
    <div class="sub">${subline}</div>
  </div>
  <div class="pad">
    <select class="client" id="clientSel" onchange="render()"></select>
    <div class="fresh" id="fresh"></div>
    <div class="cards" id="cards"></div>
    <div class="tools">
      <input id="search" placeholder="Search article, barcode or client" oninput="render()">
      <button class="sort" onclick="toggleSort()" id="sortBtn">⇅ Most urgent</button>
    </div>
    <div id="exportPanel"></div>
    <div class="listhead"><span id="countLbl"></span><span id="metricLbl"></span></div>
    <div id="list"></div>
    <div id="completedWrap"></div>
  </div>
  <div class="disclaimer">
    This data comes from Massmart DISPO's and it is used to help show you what you need to do in the store.<br><br>
    This report is not linked to the Massmart system. Clicking completed is just so you can track what you have completed, it does not affect the Massmart system.
  </div>
  <div class="foot">
    <div class="logos" id="logos"></div>
    <div id="footMeta"></div>
  </div>
</div>

<div class="modal" id="infoModal">
  <div class="sheet">
    <div class="h"><b>How these lists are calculated</b><button class="x" onclick="closeInfo()">✕</button></div>
    <div class="b" id="infoBody"></div>
  </div>
</div>

<script>
const PAYLOAD = ${data};
const R = PAYLOAD.report, M = PAYLOAD.meta;
// Browser-side HTML escaper (separate from the server esc() in the .ts module).
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
const CATS = [
  {key:"oos",      label:"Out of Stock",       cls:"red",   metric:"dros"},
  {key:"lowCover", label:"Low Stock Cover",     cls:"red",   metric:"days"},
  {key:"phantom",  label:"Phantom",             cls:"red",   metric:"soh"},
  {key:"status",   label:"Status",              cls:"red",   metric:"soh"},
  {key:"marginRisk",label:"Margin Risk",        cls:"red",   metric:"rand"},
  {key:"marginOpp", label:"Margin Opportunity", cls:"green", metric:"randp"},
];
let active = "all";          // active card filter
let sortMode = "urgent";     // urgent | az
const TKEY = "storeReportTicks:" + M.reportId;
let ticks = {};
try { ticks = JSON.parse(localStorage.getItem(TKEY) || "{}"); } catch(e){}

function lineId(l){ return l.clientId + "|" + l.article; }
function rands(n){ return "R " + Number(n).toLocaleString("en-ZA", {minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmt(n){ return (Math.round(n*100)/100).toLocaleString("en-ZA"); }
function pct(n){ return (Math.round(n*1000)/10).toLocaleString("en-ZA") + "%"; }

function flaggedCats(l){ return CATS.filter(c => l.flags[c.key]); }
function metricFor(l, cat){
  const c = CATS.find(x=>x.key===cat) || {metric:"dros"};
  switch(c.metric){
    case "dros":  return {v: fmt(l.dros), u:"/day"};
    case "days":  return {v: l.daysCover==null?"—":fmt(l.daysCover), u:"days"};
    case "soh":   return {v: fmt(l.soh), u:"units"};
    case "rand":  return {v: l.marginRiskRand==null?"—":rands(l.marginRiskRand), u:"at risk"};
    case "randp": return {v: l.marginOppRand==null?"—":rands(l.marginOppRand), u:"upside"};
  }
  return {v: fmt(l.dros), u:"/day"};
}
function metricNum(l, cat){
  const c = CATS.find(x=>x.key===cat) || {metric:"dros"};
  switch(c.metric){
    case "days":  return l.daysCover==null?1e9:l.daysCover;  // fewer days = more urgent
    case "soh":   return -l.soh;
    case "rand":  return -(l.marginRiskRand||0);
    case "randp": return -(l.marginOppRand||0);
    default:      return -l.dros;
  }
}

function curClient(){ return document.getElementById("clientSel").value; }
function visibleLines(){
  const q = document.getElementById("search").value.trim().toLowerCase();
  const cl = curClient();
  return R.lines.filter(l=>{
    if(cl!=="all" && l.clientId!==cl) return false;
    if(active!=="all" && !l.flags[active]) return false;
    if(active==="all" && !flaggedCats(l).length) return false; // All = actionable items
    if(q){
      const hay = (l.description+" "+l.article+" "+l.barcode+" "+l.clientName).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function countFor(cat, cl){
  // Count only items still needing action (un-ticked) so each card counts DOWN
  // as the rep ticks SKUs off, reaching 0 + green when the list is cleared.
  return R.lines.filter(l=> (cl==="all"||l.clientId===cl) && !ticks[lineId(l)] && (cat==="all"? flaggedCats(l).length : l.flags[cat])).length;
}
function allTicked(cat, cl){
  const ls = R.lines.filter(l=> (cl==="all"||l.clientId===cl) && (cat==="all"? flaggedCats(l).length : l.flags[cat]));
  return ls.length>0 && ls.every(l=>ticks[lineId(l)]);
}

function renderCards(){
  const cl = curClient();
  const cards = CATS.map(c=>{
    const n = countFor(c.key, cl);
    const done = allTicked(c.key, cl);
    return '<div class="card '+(c.cls==="green"?"green":"")+(active===c.key?" sel":"")+(done?" done":"")+'" onclick="setCat(\\''+c.key+'\\')">'
      + '<div class="n">'+n+'</div><div class="l">'+c.label+'</div></div>';
  }).join("");
  // "All products" = un-ticked actionable items (matches the All list) so it also
  // counts down as the rep works through them.
  const allN = countFor("all", cl);
  const allDone = allTicked("all", cl);
  const allCard = '<div class="card all '+(active==="all"?" sel":"")+(allDone?" done":"")+'" onclick="setCat(\\'all\\')"><div class="n">'+allN+'</div><div class="l">All products</div></div>';
  document.getElementById("cards").innerHTML = cards + allCard;
}

function itemHtml(l){
  const cats = flaggedCats(l);
  const m = metricFor(l, active==="all" ? (cats[0]?cats[0].key:"oos") : active);
  const chips = cats.map(c=>'<span class="chip '+(c.cls==="green"?"g":"")+'">'+c.label+'</span>').join("");
  const id = lineId(l), ticked = !!ticks[id];
  const age = (d)=> d==null? "" : " &middot; "+d+"d";
  const alert = oosAlert(l);
  // Channel Status = the DISPO PR ST code; Vendor Status = the PMF product status.
  var statusVal = esc(l.prst||"—");
  if(l.statusLabel) statusVal += ' <span style="color:var(--grey)">('+esc(l.statusLabel)+')</span>';
  if(l.statusClass==="NEGATIVE") statusVal += ' <span style="color:#df332c;font-weight:600">&middot; Negative</span>';
  else if(l.statusClass==="POSITIVE") statusVal += ' <span style="color:#2e9e5b;font-weight:600">&middot; Positive</span>';
  // Margin breakdown (only when a margin flag fires) — shows how the at-risk /
  // upside amount is derived: SOH × |MAC − Nett|.
  var marginCells = "";
  var pricingCallout = "";
  if(l.flags.marginRisk || l.flags.marginOpp){
    var isRisk = l.flags.marginRisk;
    var deltaUnit = (l.mac!=null && l.nett!=null) ? (isRisk ? l.mac - l.nett : l.nett - l.mac) : null;
    var totalRand = isRisk ? l.marginRiskRand : l.marginOppRand;
    marginCells =
      g("MAC (store cost)", l.mac==null?"—":rands(l.mac)) +
      g("Nett cost (ours)", l.nett==null?"—":rands(l.nett)) +
      g(isRisk?"Delta (MAC − Nett)":"Delta (Nett − MAC)", deltaUnit==null?"—":rands(deltaUnit)+" /unit") +
      g(isRisk?"At risk (Δ × "+fmt(l.soh)+" SOH)":"Upside (Δ × "+fmt(l.soh)+" SOH)", totalRand==null?"—":rands(totalRand));
    // Margin Opportunity — pricing advice so the rep can tell the store manager
    // exactly what to drop the shelf price to while still holding the margin.
    if(l.flags.marginOpp){
      marginCells +=
        g("Current price (Incl VAT)", l.sellPrice==null?"—":rands(l.sellPrice)) +
        g("STK Margin (now)", l.stkMargin==null?"—":pct(l.stkMargin)) +
        g("Prod. Margin (target)", l.prodMargin==null?"—":pct(l.prodMargin)) +
        g("RRP — drop-to price", l.rrp==null?"—":'<b style="color:var(--green)">'+rands(l.rrp)+'</b>');
      if(l.rrp!=null){
        var holds = l.prodMargin==null ? "" : " and still hold the "+pct(l.prodMargin)+" product margin";
        pricingCallout = '<div class="alert g">💡 Advise the store: drop the shelf price to <b>'+rands(l.rrp)+'</b>'+holds+'.</div>';
      }
    }
  }
  return '<div class="item'+(ticked?" tick":"")+'" data-id="'+esc(id)+'">'
    + '<div class="row" onclick="toggleOpen(this)">'
      + '<input type="checkbox" class="ck" '+(ticked?"checked":"")+' onclick="event.stopPropagation();tick(\\''+esc(id)+'\\',this.checked,this)">'
      + '<div class="main"><div class="nm">'+esc(l.description||l.article)+'</div>'
        + '<div class="meta">#'+esc(l.article)+(l.barcode?'  '+esc(l.barcode):'')+'  <b>'+esc(l.clientName)+'</b></div>'
        + (chips?'<div class="chips">'+chips+'</div>':'')
        + foundHtml(l)
      + '</div>'
      + '<div class="metric"><span class="v">'+m.v+'</span> <span class="u">'+m.u+'</span></div>'
      + '<div class="chev">▾</div>'
    + '</div>'
    + '<div class="detail">'
      + alert
      + '<div class="grid">'
        + g("SOH", fmt(l.soh)) + g("DROS", fmt(l.dros)+" /day") + g("Days cover", l.daysCover==null?"—":fmt(l.daysCover))
        + g("Last sold", (l.lastSold||"—")+age(l.lastSoldDays)) + g("Last received", (l.lastReceived||"—")+age(l.lastReceivedDays))
        + g("Channel Status", statusVal) + g("Vendor Status", esc(l.vendorStatus||"—")) + g("Ranging", l.ranging||"—")
        + g("RP type", esc(l.rpType||"—"))
        + marginCells
      + '</div>'
      + pricingCallout
    + '</div>'
  + '</div>';
}
function g(k,v){ return '<div class="g"><div class="k">'+k+'</div><div class="val">'+v+'</div></div>'; }
function oosAlert(l){
  if(l.flags.oos) return '<div class="alert">⚠ Out of stock — order needed</div>';
  if(l.flags.phantom) return '<div class="alert">⚠ Phantom stock — verify with a physical count</div>';
  if(l.flags.lowCover) return '<div class="alert">⚠ Low stock cover — reorder before it runs out</div>';
  if(l.flags.status) return '<div class="alert">⚠ Negative status — query the block / delist</div>';
  if(l.flags.marginRisk) return '<div class="alert">⚠ Margin risk — store cost above ours</div>';
  return '';
}

function render(){
  document.getElementById("storeName").textContent = R.storeName || R.siteCode;
  renderClientOptionsOnce();
  renderFreshness();
  renderCards();
  renderExportPanel();
  let lines = visibleLines();
  lines.sort((a,b)=> sortMode==="az" ? (a.description||"").localeCompare(b.description||"") : metricNum(a,active)-metricNum(b,active));
  const open = lines.filter(l=>!ticks[lineId(l)]);
  const done = lines.filter(l=>ticks[lineId(l)]);
  document.getElementById("countLbl").textContent = open.length + " to action";
  const c = CATS.find(x=>x.key===active);
  document.getElementById("metricLbl").textContent = c? metricHeader(c.metric) : "Most urgent";
  document.getElementById("list").innerHTML = open.length? open.map(itemHtml).join("") : '<div class="empty">Nothing to action here 🎉</div>';
  document.getElementById("completedWrap").innerHTML = done.length? '<div class="secttl">Completed ('+done.length+')</div>'+done.map(itemHtml).join("") : "";
  document.getElementById("footMeta").innerHTML = (R.totalActions)+' active &middot; '+R.totalProducts+' total &middot; generated '+esc(M.generatedAt);
}
function metricHeader(m){ return {dros:"DROS /day",days:"Days cover",soh:"SOH",rand:"R at risk",randp:"R upside"}[m]||"Most urgent"; }

let clientOptsDone=false;
function renderClientOptionsOnce(){
  if(clientOptsDone) return; clientOptsDone=true;
  const sel=document.getElementById("clientSel");
  const total=R.lines.length;
  let html='<option value="all">All clients ('+total+')</option>';
  for(const c of R.clients){ const n=R.lines.filter(l=>l.clientId===c.clientId).length; var af=c.asOf?(' — '+c.asOf):''; html+='<option value="'+esc(c.clientId)+'">'+esc(c.clientName)+' ('+n+')'+esc(af)+'</option>'; }
  sel.innerHTML=html;
}
function renderFreshness(){
  const el=document.getElementById("fresh");
  if(!el) return;
  const cl=curClient();
  const list=(cl==="all")? R.clients : R.clients.filter(function(c){return c.clientId===cl;});
  if(!list.length || !list.some(function(c){return c.asOf;})){ el.innerHTML=""; return; }
  const parts=list.map(function(c){
    if(!c.asOf) return "<b>"+esc(c.clientName)+"</b>";
    return "<b>"+esc(c.clientName)+"</b> "+esc(c.asOf)+(c.loadedAt?(" · loaded "+esc(c.loadedAt)):"");
  });
  el.innerHTML="Latest data per client — "+parts.join(" &nbsp;·&nbsp; ");
}
function beacon(ev, card){
  try{
    if(!M.track || !M.track.url) return;
    var u = M.track.url + "?t=" + encodeURIComponent(M.track.token) + "&d=" + encodeURIComponent(M.track.day) + "&e=" + ev + (card? "&c=" + encodeURIComponent(card) : "");
    if(navigator.sendBeacon){ navigator.sendBeacon(u); }
    else { fetch(u, {method:"GET", keepalive:true, mode:"no-cors"}).catch(function(){}); }
  }catch(e){}
}
// Send a tick / un-tick to the server so we have a record of what the rep claims
// they actioned (weekly sheet + DISPO verification). Uses the same token as the
// engagement beacon; the server derives rep/store/period from it.
function claimBeacon(l, on){
  try{
    if(!M.track || !M.track.url) return;
    var url = M.track.url.replace(/\\/track$/, "/claim");
    var body = JSON.stringify({
      t: M.track.token, d: M.track.day, on: on?1:0,
      line: {
        clientId:l.clientId, clientName:l.clientName, article:l.article, barcode:l.barcode,
        description:l.description, categories:flaggedCats(l).map(function(c){return c.key;}),
        soh:l.soh, dros:l.dros, daysCover:l.daysCover, prst:l.prst, statusClass:l.statusClass,
        marginRiskRand:l.marginRiskRand, marginOppRand:l.marginOppRand
      }
    });
    if(navigator.sendBeacon){ navigator.sendBeacon(url, body); }
    else { fetch(url,{method:"POST",body:body,keepalive:true,mode:"no-cors",headers:{"Content-Type":"text/plain"}}).catch(function(){}); }
  }catch(e){}
}
/* ── Stock Found (Phantom lines) ───────────────────────────────────────────
   The rep types what they physically found. Kept in localStorage FIRST (store
   floors have poor signal and a lost count means walking the aisle again), then
   synced to the server debounced. Every sync posts the FULL map with per-entry
   timestamps, so a dropped request loses nothing and the server can merge. */
const CKEY = "storeReportCounts:" + M.reportId;
var counts = {};        // lineKey -> { v: number|null, at: ISO }
var dirty = {};         // lineKey -> 1 for counts typed on THIS device, not yet acknowledged
var syncState = "idle"; // idle | pending | error
var syncTimer = null;

(function initCounts(){
  // Server values first (so another device's counts show up), then this phone's
  // own edits on top — the rep's last local entry is the one they just made.
  var saved = M.savedCounts || {};
  for(var k in saved){ if(Object.prototype.hasOwnProperty.call(saved,k)) counts[k] = {v: saved[k], at: ""}; }
  try{
    var local = JSON.parse(localStorage.getItem(CKEY) || "{}");
    var any = false;
    for(var j in local){
      if(!Object.prototype.hasOwnProperty.call(local,j)) continue;
      counts[j] = local[j];
      // Anything this phone holds may never have reached the server — the rep
      // could have lost signal mid-aisle and closed the page. Treat it as
      // unsent and push it again, so counts aren't stranded on the device.
      if(saved[j] === undefined || saved[j] !== local[j].v){ dirty[j] = 1; any = true; }
    }
    if(any) setTimeout(scheduleSync, 1200);
  }catch(e){}
})();

function countVal(id){ var c = counts[id]; return (c && c.v != null) ? c.v : ""; }
function countedTotal(){ var n=0; for(var k in counts){ if(counts[k] && counts[k].v != null) n++; } return n; }

function saveLocalCounts(){
  try{ localStorage.setItem(CKEY, JSON.stringify(counts)); }catch(e){}
}

function setSyncBadge(id, state){
  var el = document.getElementById("fs-" + id);
  if(!el) return;
  if(state === "ok"){ el.className = "ok"; el.textContent = "Saved"; }
  else if(state === "pend"){ el.className = "pend"; el.textContent = "Saving…"; }
  else if(state === "err"){ el.className = "pend"; el.textContent = "Not saved — will retry"; }
  else { el.textContent = ""; }
}

function onFoundInput(id, raw, el){
  var v = String(raw).trim();
  var num = v === "" ? null : Number(v);
  if(v !== "" && (!isFinite(num) || num < 0)){ setSyncBadge(id, "err"); return; }
  // null is kept, not deleted — an emptied box is an explicit "no count", and the
  // server needs to be told to clear it rather than left holding a stale figure.
  counts[id] = { v: num, at: new Date().toISOString() };
  dirty[id] = 1;
  saveLocalCounts();
  setSyncBadge(id, "pend");
  scheduleSync();
  updatePanelCounted();
}

function scheduleSync(){
  if(!M.api || !M.api.countUrl) return;
  if(syncTimer) clearTimeout(syncTimer);
  // Long enough that keying "12" isn't two requests, short enough that a rep who
  // moves straight on to the next aisle has already been saved.
  syncTimer = setTimeout(syncCounts, 900);
}

function syncCounts(){
  if(!M.api || !M.api.countUrl) return;
  var payload = [];
  for(var k in counts){
    if(!Object.prototype.hasOwnProperty.call(counts,k)) continue;
    var l = R.lines.find(function(x){ return lineId(x) === k; });
    if(!l) continue;
    payload.push({
      clientId: l.clientId, clientName: l.clientName, vendor: l.vendor || "",
      article: l.article, description: l.description,
      found: counts[k].v, at: counts[k].at || new Date().toISOString()
    });
  }
  if(!payload.length) return;
  syncState = "pending";
  fetch(M.api.countUrl, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ r: M.api.token, t: M.track && M.track.token, d: M.track && M.track.day, counts: payload })
  }).then(function(res){
    if(!res.ok) throw new Error("save failed");
    syncState = "idle";
    // Badge only what THIS device typed. A count loaded from the server was
    // never at risk, and flagging it "not saved" would send a rep to re-count
    // something that is already safely recorded.
    for(var k in dirty){ if(Object.prototype.hasOwnProperty.call(dirty,k)) setSyncBadge(k, "ok"); }
    dirty = {};
  }).catch(function(){
    // Keep it visible and keep the local copy — the next edit retries, and the
    // counts still export because the sheet can be built from what's on screen.
    syncState = "error";
    for(var k in dirty){ if(Object.prototype.hasOwnProperty.call(dirty,k)) setSyncBadge(k, "err"); }
    setTimeout(function(){ if(syncState === "error") syncCounts(); }, 15000);
  });
}

function foundHtml(l){
  if(!l.flags.phantom) return "";
  var id = lineId(l);
  var v = countVal(id);
  return '<div class="found" onclick="event.stopPropagation()">'
    + '<label for="f-' + esc(id) + '">Stock found</label>'
    + '<input id="f-' + esc(id) + '" type="number" inputmode="decimal" step="any" min="0" placeholder="—" '
    +   'value="' + esc(v) + '" oninput="onFoundInput(\\'' + esc(id) + '\\', this.value, this)">'
    + '<span id="fs-' + esc(id) + '"></span>'
  + '</div>';
}

/* ── Phantom export panel ──────────────────────────────────────────────────── */
var xpVendor = "all", xpMode = "empty", xpOneSheet = true, xpBusy = false, xpPanelFor = null;

function phantomLines(){
  var cl = curClient();
  return R.lines.filter(function(l){ return l.flags.phantom && (cl === "all" || l.clientId === cl); });
}
// Distinct vendors on the phantom list, each with its name — reps do not know
// every vendor number by heart, and the number alone makes the picker a guess.
function phantomVendors(){
  var seen = {}, out = [];
  phantomLines().forEach(function(l){
    var v = l.vendor || "";
    if(!v) return;
    if(!seen[v]){ seen[v] = {code:v, name:l.vendorName || "", n:0}; out.push(seen[v]); }
    // Take a name off whichever row has one — some rows can be blank.
    if(!seen[v].name && l.vendorName) seen[v].name = l.vendorName;
    seen[v].n++;
  });
  out.sort(function(a,b){
    var na=Number(a.code), nb=Number(b.code);
    return (!isNaN(na)&&!isNaN(nb)) ? na-nb : a.code.localeCompare(b.code);
  });
  return out;
}

function renderExportPanel(){
  var host = document.getElementById("exportPanel");
  if(!host) return;
  // Only on the Phantom list, and only when the server gave us the endpoints.
  var show = active === "phantom" && M.api && M.api.exportUrl;
  if(!show){ host.innerHTML = ""; xpPanelFor = null; return; }
  // Rebuild only when the context changes — a rebuild mid-typing would throw the
  // rep out of the email box.
  var sig = "phantom|" + curClient();
  if(xpPanelFor === sig) { updatePanelCounted(); return; }
  xpPanelFor = sig;

  var vendors = phantomVendors();
  var opts = '<option value="all">All vendors (' + phantomLines().length + ' lines)</option>';
  vendors.forEach(function(v){
    var label = v.name ? (v.code + " — " + v.name) : v.code;
    opts += '<option value="' + esc(v.code) + '"' + (xpVendor === v.code ? " selected" : "") + '>' + esc(label) + ' (' + v.n + ')</option>';
  });

  host.innerHTML =
    '<div class="xp">'
    + '<h3>Stock count sheet</h3>'
    + '<div class="hint">Export these phantom lines to Excel to count them in store, or email the sheet out.</div>'
    + '<div class="fld"><span>Vendor</span><select id="xpVendor" onchange="xpSetVendor(this.value)">' + opts + '</select></div>'
    + '<div class="fld"><span>What to send</span><div class="seg">'
      + '<button id="xpModeEmpty" class="' + (xpMode === "empty" ? "on" : "") + '" onclick="xpSetMode(\\'empty\\')">Download empty</button>'
      + '<button id="xpModeCounts" class="' + (xpMode === "counts" ? "on" : "") + '" onclick="xpSetMode(\\'counts\\')">With count submissions</button>'
    + '</div><div class="hint" id="xpCounted" style="margin:6px 0 0"></div></div>'
    + '<label class="cb" id="xpOneWrap"><input type="checkbox" id="xpOne"' + (xpOneSheet ? " checked" : "") + ' onchange="xpOneSheet=this.checked">'
      + '<span>All vendors on one sheet<br><span style="color:var(--grey)">Untick to get a separate tab per vendor.</span></span></label>'
    // The "multiple" attribute lets the browser accept a comma-separated list in
    // an email input; without it the field rejects a perfectly good list.
    // (No backticks in this file's generated-JS comments — they would close the
    // template literal this whole page is built from.)
    + '<div class="fld"><span>Email to (optional)</span><input type="email" id="xpTo" multiple inputmode="email" autocomplete="email" placeholder="name@store.co.za, buyer@store.co.za"></div>'
    + '<div class="hint" style="margin:-4px 0 12px"><b>You can enter more than one address — separate them with commas.</b><br>Sending also copies you and the client\\'s CAM.</div>'
    + '<div class="acts">'
      + '<button class="dl" id="xpDl" onclick="xpRun(\\'download\\')">Download</button>'
      + '<button class="em" id="xpEm" onclick="xpRun(\\'email\\')">Email</button>'
    + '</div>'
    + '<div id="xpMsg"></div>'
  + '</div>';
  xpSyncOneVisibility();
  updatePanelCounted();
}

function xpSetVendor(v){ xpVendor = v; xpSyncOneVisibility(); updatePanelCounted(); }
function xpSetMode(m){
  xpMode = m;
  var a = document.getElementById("xpModeEmpty"), b = document.getElementById("xpModeCounts");
  if(a) a.className = (m === "empty" ? "on" : "");
  if(b) b.className = (m === "counts" ? "on" : "");
  updatePanelCounted();
}
function xpSyncOneVisibility(){
  // One vendor is one sheet by definition — hide the choice rather than offer a
  // tickbox that does nothing.
  var wrap = document.getElementById("xpOneWrap");
  if(wrap) wrap.style.display = (xpVendor === "all") ? "" : "none";
}
function updatePanelCounted(){
  var el = document.getElementById("xpCounted");
  if(!el) return;
  var scoped = phantomLines().filter(function(l){ return xpVendor === "all" || l.vendor === xpVendor; });
  var counted = scoped.filter(function(l){ return countVal(lineId(l)) !== ""; }).length;
  // The vendor picker scopes the SHEET, not the list on screen — so say outright
  // how many lines the sheet will hold, or a rep who picked one vendor wonders
  // why they got fewer rows than they can see.
  var lead = "Sheet will have " + scoped.length + " line" + (scoped.length === 1 ? "" : "s") + ". ";
  el.textContent = lead + (xpMode === "counts"
    ? (counted ? counted + " already counted — these fill Count 1." : "No counts captured yet, so Count 1 will be blank.")
    : "Count 1 blank for writing in store.");
}
function xpMsg(kind, text){
  var el = document.getElementById("xpMsg");
  if(el) el.innerHTML = text ? '<div class="msg ' + kind + '">' + esc(text) + '</div>' : "";
}
function xpSetBusy(on, label){
  xpBusy = on;
  var d = document.getElementById("xpDl"), e = document.getElementById("xpEm");
  if(d){ d.disabled = on; d.textContent = (on && label === "download") ? "Building…" : "Download"; }
  if(e){ e.disabled = on; e.textContent = (on && label === "email") ? "Sending…" : "Email"; }
}

function xpRun(action){
  if(xpBusy) return;
  var toEl = document.getElementById("xpTo");
  var to = toEl ? toEl.value.trim() : "";
  if(action === "email" && !to && !(M.track && M.track.token)){
    xpMsg("bad", "Enter an email address — this report has no rep on file to copy.");
    return;
  }
  xpMsg("", "");
  xpSetBusy(true, action);
  // Flush any pending counts first so "with count submissions" can't export a
  // count the server hasn't been told about yet.
  if(syncTimer){ clearTimeout(syncTimer); syncTimer = null; }
  var pre = (xpMode === "counts") ? new Promise(function(res){ syncCounts(); setTimeout(res, 600); }) : Promise.resolve();

  pre.then(function(){
    return fetch(M.api.exportUrl, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        r: M.api.token, t: M.track && M.track.token, d: M.track && M.track.day,
        vendor: xpVendor, mode: xpMode, oneSheet: (xpVendor !== "all") ? true : xpOneSheet,
        action: action, to: to
      })
    });
  }).then(function(res){
    if(action === "download"){
      if(!res.ok) return res.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || "Could not build the sheet."); });
      var name = "Phantom Stock Count.xlsx";
      var cd = res.headers.get("Content-Disposition") || "";
      var m = cd.match(/filename="([^"]+)"/);
      if(m) name = m[1];
      return res.blob().then(function(blob){
        // A header-authenticated URL can't be used as a plain href, so the file is
        // fetched and handed over as a blob URL.
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
        xpMsg("good", "Downloaded " + name);
      });
    }
    return res.json().catch(function(){ return {}; }).then(function(j){
      if(!res.ok || j.error) throw new Error(j.error || "Could not send the email.");
      var who = (j.to || []).join(", ");
      xpMsg("good", "Sent to " + who + (j.lines != null ? (" — " + j.lines + " line(s).") : "."));
      if(toEl) toEl.value = "";
    });
  }).catch(function(err){
    xpMsg("bad", (err && err.message) ? err.message : "Something went wrong. Please try again.");
  }).then(function(){ xpSetBusy(false, action); });
}

function setCat(k){ active=k; beacon("card", k); render(); }
function toggleOpen(el){ el.parentElement.classList.toggle("open"); }
function toggleSort(){ sortMode = sortMode==="urgent"?"az":"urgent"; document.getElementById("sortBtn").textContent = sortMode==="urgent"?"⇅ Most urgent":"⇅ A–Z"; render(); }
function tick(id,on,box){
  if(on) ticks[id]=1; else delete ticks[id];
  localStorage.setItem(TKEY,JSON.stringify(ticks));
  var _l = R.lines.find(function(x){return lineId(x)===id;});
  if(_l) claimBeacon(_l, on);
  // When ticking ON, briefly show the checked tick + strikethrough in place,
  // then re-render (which moves it down to Completed). Feels less jarring than
  // an instant jump. Unticking re-renders immediately.
  if(on && box){
    const item = box.closest(".item");
    if(item){ item.classList.add("tick","leaving"); setTimeout(render, 650); return; }
  }
  render();
}

function logos(){
  const L=(u,alt)=> u? '<img src="'+esc(u)+'" alt="'+esc(alt)+'">' : '<span style="color:#9aa3ad;font-weight:600;font-size:12px">'+esc(alt)+'</span>';
  document.getElementById("logos").innerHTML = L(M.iramLogoUrl,"iRAM")+L(M.outerjoinLogoUrl,"OUTERJOIN")+L(M.retailerLogoUrl,R.subChannel||"Retailer");
}

const INFO = [
  ["#df332c","Out of Stock","A line that normally sells or holds stock here but is now at 0 or below on hand. Shelf's empty — raise an order. Ranked by DROS so the fastest sellers surface first."],
  ["#df332c","Low Stock Cover","Still selling (DROS &gt; 0) with 14 days cover or less left (days cover = on hand ÷ DROS). About to run out — reorder now."],
  ["#df332c","Phantom","On hand above 0 but no sale and no receipt in the last 3 months (blank/old dates count as stale). The system shows stock that may not be on the shelf — verify with a physical count."],
  ["#df332c","Status","Any SKU carrying a status flag on its store record (PR ST) — open the line to see whether that status is Positive or Negative (shown when we have a rule for it). Action anything negative; query the block or delist."],
  ["#df332c","Margin Risk","On hand above 0 and the store's cost (MAC) is higher than our cost (Nett) — margin eroded; we may owe support or free stock. At risk = on hand × (MAC − Nett)."],
  ["#2e9e5b","Margin Opportunity","On hand above 0 and the store's cost (MAC) is below ours (Nett) — the store bought this stock cheaply, so they can drop the shelf price and still make their margin. Both margins use the selling price minus VAT: Margin = (SP − Cost) ÷ SP. STK Margin uses the store's cost (MAC) = what they make now; Prod. Margin uses our cost (Nett) = the standard target. RRP = the price you can advise them to drop to and still hold the product margin: MAC ÷ (1 − Prod. Margin) × 1.15. Upside = on hand × (Nett − MAC)."],
];
function buildInfo(){
  let h='<div class="note">An article can appear in more than one list when it matches several rules — its chips show the others (e.g. + Margin Risk). Tick it off in any list and it\\'s ticked off everywhere. A card turns <b style="color:#2e9e5b">green</b> once every item in its list is ticked.</div>';
  for(const [c,t,p] of INFO){ h+='<div class="def"><div class="t"><span class="dot" style="background:'+c+'"></span>'+t+'</div><p>'+p+'</p></div>'; }
  h+='<div class="def"><div class="t">DROS</div><p>Daily Rate Of Sale = this year\\'s units ÷ days elapsed in the year. We work from monthly DISPO data, so it\\'s an average daily rate, not an exact day-by-day figure.</p></div>';
  h+='<div class="def"><div class="t">Stock found</div><p>On Phantom lines, type what you physically counted on the shelf. Decimals are fine (e.g. 3.5 metres of rope). It saves as you type \\u2014 to this phone first, so a weak signal in-store can\\'t lose it, then to iRam. From the Phantom list you can download or email a stock count sheet, either blank to write on or already filled in with what you captured here.</p></div>';
  h+='<div class="def"><div class="t">Tick boxes</div><p>Tick an item to mark it done; it drops into the Completed list at the bottom.</p></div>';
  document.getElementById("infoBody").innerHTML=h;
}
function openInfo(){ document.getElementById("infoModal").classList.add("on"); }
function closeInfo(){ document.getElementById("infoModal").classList.remove("on"); }

try { logos(); buildInfo(); render(); beacon("view"); }
catch (e) {
  document.getElementById("list").innerHTML =
    '<div class="empty">Sorry — this report could not be displayed. ' + (e && e.message ? esc(e.message) : "") + '</div>';
}
</script>
</body></html>`;
}
