/* ──────────────────────────────────────────────────────────────
   Store Report engine — per-store, all-clients "stock action list".

   For ONE store (site code) this computes, across every loaded client,
   the per-product action flags a rep can work on the floor:

     • Out of Stock      — in base, SOH ≤ 0          (reorder / find stock)
     • Low Stock Cover   — SOH > 0, days cover ≤ N, still selling (DROS>0)
     • Phantom           — SOH > 0, no sale AND no receipt for N months
                                                     (physically count / verify)
     • Status (negative) — PR ST classified NEGATIVE (query block / delist)
     • Margin Risk       — SOH > 0, MAC > Nett       (claim support / sell-through)
     • Margin Opportunity— SOH > 0, MAC < Nett       (drop price / push sales)

   One pass over each client's store-filtered, enriched ledger rows produces a
   flat list of product lines. Every line carries ALL the flags it triggers
   (so a line can be e.g. OOS *and* a status negative — shown as tags), the
   collapsed-row metric each list sorts on, and the full expanded-detail fields.

   DROS (Daily Rate Of Sale) is OUR analog of Mark's daily metric: we have only
   monthly DISPO data, so DROS = YTD units ÷ days elapsed in the year. Days
   cover = SOH ÷ DROS (falls back to the DISPO's Act DSC).

   Classification reuses the Month-End engine verbatim (classifyRowStatus,
   parseDispoDate) so the store report and Month-End never disagree.
   ────────────────────────────────────────────────────────────── */

import type { StatusDefinition, StatusScenario } from "./types";
import { classifyRowStatus, parseDispoDate, VAT_RATE } from "./monthEndReport";

type Row = Record<string, unknown>;

// ── Tunables (sensible defaults; can be lifted to report config later) ──
export const LOW_COVER_DAYS = 14;     // SOH>0 with this many days cover or fewer
export const PHANTOM_MONTHS = 3;      // stale-sale AND stale-receipt threshold

export type StoreCategory =
  | "oos"
  | "lowCover"
  | "phantom"
  | "status"
  | "marginRisk"
  | "marginOpp";

export interface StoreLineFlags {
  oos: boolean;
  lowCover: boolean;
  phantom: boolean;
  status: boolean;
  marginRisk: boolean;
  marginOpp: boolean;
}

export interface StoreLine {
  clientId: string;
  clientName: string;
  article: string;
  barcode: string;
  productCode: string;          // _clientProductId
  description: string;
  category: string;             // product category (from PMF)

  soh: number;
  dros: number;                 // Daily Rate Of Sale = YTD units ÷ days elapsed
  daysCover: number | null;     // SOH ÷ DROS (fallback Act DSC)

  lastSold: string;             // raw, for display
  lastReceived: string;         // raw, for display
  lastSoldDays: number | null;  // age in days vs the report reference date
  lastReceivedDays: number | null;

  prst: string;                 // PR ST code (display)
  statusLabel: string;          // status definition description (e.g. "Active") or ""
  statusClass: "POSITIVE" | "NEGATIVE" | "UNCLASSIFIED";  // per-line classification
  vendorStatus: string;         // PMF product status (Active / Discontinued)
  ranging: "TRUE" | "FALSE" | "";  // "" when no ranging file loaded for the client
  rpType: string;               // RP replenishment code

  mac: number | null;             // Moving Average Cost (store's cost)
  nett: number | null;            // our Nett Cost
  marginRiskRand: number | null;  // SOH × (MAC − Nett) when MAC > Nett
  marginOppRand: number | null;   // SOH × (Nett − MAC) when Nett > MAC

  // Margin-Opportunity pricing advice — what the rep tells the store manager.
  sellPrice: number | null;       // effective selling price Incl VAT (Prom SP if > 0 else Incl SP)
  stkMargin: number | null;       // (SPexVat − MAC) / SPexVat — margin on stock-on-hand — fraction
  prodMargin: number | null;      // (SPexVat − Nett) / SPexVat — standard product margin — fraction
  rrp: number | null;             // recommended drop-to price (Incl VAT) that still holds prodMargin on MAC

  flags: StoreLineFlags;
}

export interface StoreReportCounts {
  oos: number;
  lowCover: number;
  phantom: number;
  status: number;
  marginRisk: number;
  marginOpp: number;
}

export interface StoreReportClient {
  clientId: string;
  clientName: string;
  asOf?: string;       // freshness label, e.g. "Wk 25 · Jun 2026"
  loadedAt?: string;   // ISO of the last DISPO load for this client
}

export interface StoreReport {
  siteCode: string;
  storeName: string;
  storeType: string;
  subChannel: string;
  province: string;
  clients: StoreReportClient[];
  totalProducts: number;        // distinct in-base lines = "All products"
  counts: StoreReportCounts;
  totalActions: number;         // distinct lines carrying ≥1 flag
  lines: StoreLine[];
}

export interface ClientStoreInput {
  clientId: string;
  clientName: string;
  rows: Row[];                  // enriched ledger rows already filtered to the site
  dateColumns: string[];
  statusDefs: StatusDefinition[];
  scenarios: StatusScenario[];  // already scoped to this client's channels
  hasRanging: boolean;          // client.controlFiles.ranging != null
}

export interface BuildStoreReportOpts {
  siteCode: string;
  referenceDate: Date;          // end of report month — DROS + phantom anchor
  lowCoverDays?: number;
  phantomMonths?: number;
}

// ── small numeric helper (mirrors monthEndReport.parseNum) ──
function num(v: unknown, blankAs: number): number {
  if (typeof v === "number") return v;
  if (v == null) return blankAs;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return blankAs;
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

function minusMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() - months);
  return r;
}

const MS_PER_DAY = 86400000;

// YTD units = sum of the report year's date columns up to the report month.
function ytdUnits(row: Row, dateColumns: string[], year: number, month: number): number {
  let total = 0;
  for (const col of dateColumns) {
    const m = col.match(/^(\d{2})-(\d{4})$/);
    if (!m) continue;
    if (Number(m[2]) !== year) continue;
    if (Number(m[1]) > month) continue;
    const v = num(row[col], 0);
    if (!isNaN(v)) total += v;
  }
  return total;
}

// A SKU×store is "in base" if it has stock and/or any sales across the ledger's
// date columns — the same universe Month-End uses for OOS / Status.
function classifyBase(row: Row, dateColumns: string[]): { inBase: boolean; soh: number } {
  const soh = num(row["SOH"], 0);
  const hasStock = !isNaN(soh) && soh > 0;
  let sales = 0;
  for (const col of dateColumns) {
    const v = num(row[col], 0);
    if (!isNaN(v)) sales += v;
  }
  return { inBase: hasStock || sales > 0, soh: isNaN(soh) ? 0 : soh };
}

const BLANK = "(blank)";
function prstDisplay(row: Row): string {
  const raw = String(row["Status"] ?? row["PR ST"] ?? "").trim();
  return raw === "" ? BLANK : raw.toUpperCase();
}
function pmfStatusDisplay(row: Row): string {
  const raw = String(row["_productStatus"] ?? "").trim();
  return raw === "" ? BLANK : raw.toUpperCase();
}

function ageDays(raw: unknown, ref: Date): number | null {
  const d = parseDispoDate(raw);
  if (d === null) return null;
  return Math.max(0, Math.round((ref.getTime() - d.getTime()) / MS_PER_DAY));
}

function emptyFlags(): StoreLineFlags {
  return { oos: false, lowCover: false, phantom: false, status: false, marginRisk: false, marginOpp: false };
}

export function buildStoreReport(
  clients: ClientStoreInput[],
  opts: BuildStoreReportOpts,
): StoreReport {
  const lowCoverDays = opts.lowCoverDays ?? LOW_COVER_DAYS;
  const phantomMonths = opts.phantomMonths ?? PHANTOM_MONTHS;
  const cutoff = minusMonths(opts.referenceDate, phantomMonths);

  const refYear = opts.referenceDate.getUTCFullYear();
  const refMonth = opts.referenceDate.getUTCMonth() + 1;
  const startOfYear = Date.UTC(refYear, 0, 1);
  const daysElapsed = Math.max(1, Math.floor((opts.referenceDate.getTime() - startOfYear) / MS_PER_DAY) + 1);

  const lines: StoreLine[] = [];
  const counts: StoreReportCounts = {
    oos: 0, lowCover: 0, phantom: 0, status: 0, marginRisk: 0, marginOpp: 0,
  };
  const participating: StoreReportClient[] = [];

  let storeName = "";
  let storeType = "";
  let subChannel = "";
  let province = "";

  for (const client of clients) {
    let clientHasLines = false;
    const labelByCode = new Map<string, string>();
    for (const d of client.statusDefs) labelByCode.set(d.code, d.description || "");

    for (const row of client.rows) {
      // Include every listed SKU at this store — don't hide SOH=0 lines that have
      // no recent sales; those are exactly the out-of-stock gaps a rep must see.
      const { soh } = classifyBase(row, client.dateColumns);

      // Capture store header off the first usable row.
      if (!storeName) storeName = String(row["_storeName"] || row["Site Name"] || "");
      if (!storeType) storeType = String(row["_storeType"] || "");
      if (!subChannel) subChannel = String(row["_storeSubChannel"] || row["_storeChannel"] || "");
      if (!province) province = String(row["_province"] || "");

      // DROS + days cover
      const ytd = ytdUnits(row, client.dateColumns, refYear, refMonth);
      const dros = ytd > 0 ? ytd / daysElapsed : 0;
      const actDsc = num(row["Act DSC"], NaN);
      const daysCover = dros > 0
        ? soh / dros
        : (isNaN(actDsc) ? null : actDsc);

      const flags = emptyFlags();

      // Out of Stock
      flags.oos = soh <= 0;

      // Low Stock Cover — has stock, thin cover, and still selling
      flags.lowCover = soh > 0 && dros > 0 && daysCover !== null && daysCover <= lowCoverDays;

      // Phantom — stock present but stale sale AND stale receipt (blank = stale)
      if (soh > 0) {
        const lastSoldDate = parseDispoDate(row["Last Sold"]);
        const lastRecDate = parseDispoDate(row["Last Recv"]);
        const soldOld = lastSoldDate === null || lastSoldDate.getTime() <= cutoff.getTime();
        const recOld = lastRecDate === null || lastRecDate.getTime() <= cutoff.getTime();
        flags.phantom = soldOld && recOld;
      }

      // Status — flag any SKU carrying a (non-blank) PR ST status. The per-line
      // classification (positive/negative) is computed too and shown in the detail
      // when a Status Reference rule exists for that code.
      const statusRaw = String(row["Status"] ?? row["PR ST"] ?? "").trim();
      const statusClass = classifyRowStatus(row, client.statusDefs, client.scenarios);
      flags.status = statusRaw !== "";

      // Margin Risk / Opportunity
      const mac = num(row["MAC"], NaN);
      const nett = num(row["Nett Cost"], NaN);
      let marginRiskRand: number | null = null;
      let marginOppRand: number | null = null;
      if (soh > 0 && mac > 0 && nett > 0) {
        if (mac > nett) {
          flags.marginRisk = true;
          marginRiskRand = soh * (mac - nett);
        } else if (nett > mac) {
          flags.marginOpp = true;
          marginOppRand = soh * (nett - mac);
        }
      }

      // Pricing advice for Margin Opportunity. Both margins are computed straight
      // from the ex-VAT selling price and the two costs (not the DISPO margin
      // fields) so they're always available when we have MAC + Nett:
      //   Margin = (SP − Cost) / SP,  SP = (Prom SP > 0 ? Prom SP : Incl SP) / (1 + VAT)
      //   STK Margin uses MAC (store's cost); Prod. Margin uses Nett (our cost).
      // RRP = the shelf price they can drop to and STILL hold Prod. Margin on their
      // low MAC: MAC / (1 − Prod.Margin) × (1 + VAT).
      const inclSP = num(row["Incl SP"], NaN);
      const promSP = num(row["Prom SP"], NaN);
      const sellIncl = !isNaN(promSP) && promSP > 0 ? promSP : inclSP;
      const spExVat = !isNaN(sellIncl) && sellIncl > 0 ? sellIncl / (1 + VAT_RATE) : NaN;
      const stkMargin = !isNaN(spExVat) && spExVat > 0 && !isNaN(mac) ? (spExVat - mac) / spExVat : null;
      const prodMargin = !isNaN(spExVat) && spExVat > 0 && !isNaN(nett) ? (spExVat - nett) / spExVat : null;
      let rrp: number | null = null;
      if (flags.marginOpp && prodMargin != null && !isNaN(mac) && mac > 0 && 1 - prodMargin !== 0) {
        rrp = (mac / (1 - prodMargin)) * (1 + VAT_RATE);
      }

      if (flags.oos) counts.oos++;
      if (flags.lowCover) counts.lowCover++;
      if (flags.phantom) counts.phantom++;
      if (flags.status) counts.status++;
      if (flags.marginRisk) counts.marginRisk++;
      if (flags.marginOpp) counts.marginOpp++;

      const prst = prstDisplay(row);

      clientHasLines = true;
      lines.push({
        clientId: client.clientId,
        clientName: client.clientName,
        article: String(row["Article"] ?? ""),
        barcode: String(row["_barcode"] || ""),
        productCode: String(row["_clientProductId"] || ""),
        // DISPO/channel description first (what the rep sees in-store); PMF as fallback.
        description: String(row["Article Desc"] || row["_productDescription"] || ""),
        category: String(row["_category"] || ""),
        soh,
        dros: round2(dros),
        daysCover: daysCover === null ? null : round2(daysCover),
        lastSold: String(row["Last Sold"] ?? ""),
        lastReceived: String(row["Last Recv"] ?? ""),
        lastSoldDays: ageDays(row["Last Sold"], opts.referenceDate),
        lastReceivedDays: ageDays(row["Last Recv"], opts.referenceDate),
        prst,
        statusLabel: labelByCode.get(prst) || "",
        statusClass,
        vendorStatus: pmfStatusDisplay(row),
        ranging: client.hasRanging ? (row["_rangingStatus"] === true ? "TRUE" : "FALSE") : "",
        rpType: String(row["RP"] ?? ""),
        mac: isNaN(mac) ? null : round2(mac),
        nett: isNaN(nett) ? null : round2(nett),
        marginRiskRand: marginRiskRand === null ? null : round2(marginRiskRand),
        marginOppRand: marginOppRand === null ? null : round2(marginOppRand),
        sellPrice: isNaN(sellIncl) ? null : round2(sellIncl),
        stkMargin: stkMargin,
        prodMargin: prodMargin,
        rrp: rrp === null ? null : round2(rrp),
        flags,
      });
    }

    if (clientHasLines) {
      participating.push({ clientId: client.clientId, clientName: client.clientName });
    }
  }

  const totalActions = lines.filter((l) =>
    l.flags.oos || l.flags.lowCover || l.flags.phantom ||
    l.flags.status || l.flags.marginRisk || l.flags.marginOpp,
  ).length;

  return {
    siteCode: opts.siteCode,
    storeName,
    storeType,
    subChannel,
    province,
    clients: participating,
    totalProducts: lines.length,
    counts,
    totalActions,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
