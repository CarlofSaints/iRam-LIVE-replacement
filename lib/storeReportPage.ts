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
  .grid{margin-top:12px;border:1px solid var(--line);border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px 10px}
  .g .k{color:var(--grey);font-size:11px}.g .val{font-weight:600;font-size:14px;margin-top:2px}
  .item.tick .nm{text-decoration:line-through;color:#9aa3ad}
  .item{transition:opacity .25s ease, background-color .25s ease}
  .item.tick{opacity:.7}
  .item.leaving{background:#e9f6ee}
  .secttl{padding:18px 6px 2px;font:700 13px Arial;color:var(--grey)}
  .empty{padding:26px 16px;text-align:center;color:#9aa3ad;font-size:13px}
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
    <div class="listhead"><span id="countLbl"></span><span id="metricLbl"></span></div>
    <div id="list"></div>
    <div id="completedWrap"></div>
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
function rands(n){ return "R " + Math.round(n).toLocaleString("en-ZA"); }
function fmt(n){ return (Math.round(n*100)/100).toLocaleString("en-ZA"); }

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
  return R.lines.filter(l=> (cl==="all"||l.clientId===cl) && (cat==="all"? flaggedCats(l).length : l.flags[cat])).length;
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
  const allN = R.lines.filter(l=> cl==="all"||l.clientId===cl).length;
  const allCard = '<div class="card all '+(active==="all"?" sel":"")+'" onclick="setCat(\\'all\\')"><div class="n">'+allN+'</div><div class="l">All products</div></div>';
  document.getElementById("cards").innerHTML = cards + allCard;
}

function itemHtml(l){
  const cats = flaggedCats(l);
  const m = metricFor(l, active==="all" ? (cats[0]?cats[0].key:"oos") : active);
  const chips = cats.map(c=>'<span class="chip '+(c.cls==="green"?"g":"")+'">'+c.label+'</span>').join("");
  const id = lineId(l), ticked = !!ticks[id];
  const age = (d)=> d==null? "" : " &middot; "+d+"d";
  const alert = oosAlert(l);
  return '<div class="item'+(ticked?" tick":"")+'" data-id="'+esc(id)+'">'
    + '<div class="row" onclick="toggleOpen(this)">'
      + '<input type="checkbox" class="ck" '+(ticked?"checked":"")+' onclick="event.stopPropagation();tick(\\''+esc(id)+'\\',this.checked,this)">'
      + '<div class="main"><div class="nm">'+esc(l.description||l.article)+'</div>'
        + '<div class="meta">#'+esc(l.article)+(l.barcode?'  '+esc(l.barcode):'')+'  <b>'+esc(l.clientName)+'</b></div>'
        + (chips?'<div class="chips">'+chips+'</div>':'')
      + '</div>'
      + '<div class="metric"><span class="v">'+m.v+'</span> <span class="u">'+m.u+'</span></div>'
      + '<div class="chev">▾</div>'
    + '</div>'
    + '<div class="detail">'
      + alert
      + '<div class="grid">'
        + g("SOH", fmt(l.soh)) + g("DROS", fmt(l.dros)+" /day") + g("Days cover", l.daysCover==null?"—":fmt(l.daysCover))
        + g("Last sold", (l.lastSold||"—")+age(l.lastSoldDays)) + g("Last received", (l.lastReceived||"—")+age(l.lastReceivedDays)) + g("Status", esc((l.prst||"")+(l.statusLabel?" "+l.statusLabel:"")))
        + g("Vendor status", esc(l.vendorStatus||"—")) + g("Ranging", l.ranging||"—") + g("RP type", esc(l.rpType||"—"))
      + '</div>'
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
function setCat(k){ active=k; beacon("card", k); render(); }
function toggleOpen(el){ el.parentElement.classList.toggle("open"); }
function toggleSort(){ sortMode = sortMode==="urgent"?"az":"urgent"; document.getElementById("sortBtn").textContent = sortMode==="urgent"?"⇅ Most urgent":"⇅ A–Z"; render(); }
function tick(id,on,box){
  if(on) ticks[id]=1; else delete ticks[id];
  localStorage.setItem(TKEY,JSON.stringify(ticks));
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
  ["#df332c","Status","The line's store status (PR ST) is flagged negative by the client's status rules (e.g. delisted/blocked while still ranged or holding stock). Query the block or delist."],
  ["#df332c","Margin Risk","On hand above 0 and the store's cost (MAC) is higher than our cost (Nett) — margin eroded; we may owe support or free stock. At risk = on hand × (MAC − Nett)."],
  ["#2e9e5b","Margin Opportunity","On hand above 0 and the store's cost (MAC) is below ours (Nett) — drop the shelf price and hold margin, or push sales. Upside = on hand × (Nett − MAC)."],
];
function buildInfo(){
  let h='<div class="note">An article can appear in more than one list when it matches several rules — its chips show the others (e.g. + Margin Risk). Tick it off in any list and it\\'s ticked off everywhere. A card turns <b style="color:#2e9e5b">green</b> once every item in its list is ticked.</div>';
  for(const [c,t,p] of INFO){ h+='<div class="def"><div class="t"><span class="dot" style="background:'+c+'"></span>'+t+'</div><p>'+p+'</p></div>'; }
  h+='<div class="def"><div class="t">DROS</div><p>Daily Rate Of Sale = this year\\'s units ÷ days elapsed in the year. We work from monthly DISPO data, so it\\'s an average daily rate, not an exact day-by-day figure.</p></div>';
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
