import { NextRequest } from "next/server";
import { requirePermission, assertClientAccess, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getReportConfig, classifyDSC } from "@/lib/reportConfig";
import { getClientById } from "@/lib/clientData";
import {
  buildDateContext,
  buildSalesSummary,
  buildMarginAnalysis,
  buildNumericalDistribution,
  buildOpenToOrder,
  buildChartsData,
} from "@/lib/monthEndReport";
import { calcMonthLastSold } from "@/lib/vitalSigns";
import { getStatusDefinitions } from "@/lib/statusData";
import { getStatusScenarios } from "@/lib/statusScenarioData";
import { getMergedStores } from "@/lib/storeFileData";
import { getProductLookup } from "@/lib/productMasterData";
import { getControlFileData } from "@/lib/controlFileData";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const session = await requirePermission(req, "view_charts");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const channelIdsParam = url.searchParams.get("channelIds");
    if (!clientId || !channelIdsParam) {
      return Response.json({ error: "clientId and channelIds are required" }, { status: 400, headers: noCacheHeaders() });
    }
    // Client-scoped users may only query their assigned client(s).
    assertClientAccess(session, clientId);
    const channelIds = channelIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (channelIds.length === 0) {
      return Response.json({ error: "At least one channelId is required" }, { status: 400, headers: noCacheHeaders() });
    }

    const yearParam = url.searchParams.get("year");
    const monthParam = url.searchParams.get("month");
    const listParam = (k: string) => (url.searchParams.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const subChFilter = listParam("subChannels");
    const catFilter = listParam("categories");
    const provFilter = listParam("provinces");
    const skuFilter = listParam("skus");
    const siteFilter = listParam("sites");

    const parseMonths = (v: string | null): number | null => {
      const n = v ? parseInt(v, 10) : NaN;
      return !isNaN(n) && n > 0 ? n : null;
    };
    const phLastSold = parseMonths(url.searchParams.get("phLastSold")) ?? 3;
    const phLastReceived = parseMonths(url.searchParams.get("phLastReceived")) ?? 3;
    const ndMonthsRaw = parseInt(url.searchParams.get("ndMonths") || "", 10);
    const ndMonths = !isNaN(ndMonthsRaw) && ndMonthsRaw >= 1 && ndMonthsRaw <= 24 ? ndMonthsRaw : 6;

    // 1. Load + merge ledgers
    const ledgerResults = await Promise.all(
      channelIds.map(async (chId) => {
        const [rows, meta] = await Promise.all([getSalesLedger(clientId, chId), getSalesLedgerMeta(clientId, chId)]);
        return { rows, meta, channelId: chId };
      })
    );

    const allRows: Record<string, unknown>[] = [];
    const allDateCols = new Set<string>();
    const channelNames: string[] = [];
    let clientName = "";
    for (const { rows, meta } of ledgerResults) {
      if (rows.length > 0) allRows.push(...rows);
      if (meta) {
        for (const dc of meta.dateColumns ?? []) allDateCols.add(dc);
        if (meta.channelName) channelNames.push(meta.channelName);
        if (meta.clientName) clientName = meta.clientName;
      }
    }
    if (allRows.length === 0) {
      return Response.json({ error: "No sales data found for the selected channels" }, { status: 404, headers: noCacheHeaders() });
    }
    const dateColumns = Array.from(allDateCols);

    // 2. Enrich + DSC/date-last-sold
    const enriched = await enrichLedger(allRows, clientId);
    const config = await getReportConfig(clientId);
    const enrichedRows: Record<string, unknown>[] = enriched.rows.map((row) => ({
      ...row,
      _dscAlert: classifyDSC(Number((row as Record<string, unknown>)["Act DSC"] ?? 0), config.dscBrackets),
      _dateLastSold: calcMonthLastSold(row, dateColumns),
    }));

    // 2b. Distinct filter options (from the UNfiltered rows, so the dropdowns
    // always offer the full set regardless of what's currently selected).
    const subOpts = new Set<string>(), catOpts = new Set<string>(), provOpts = new Set<string>();
    const skuMap = new Map<string, string>(), siteMap = new Map<string, string>();
    const subOf = (r: Record<string, unknown>) => String(r["_storeSubChannel"] || r["_storeChannel"] || "").trim();
    const catOf = (r: Record<string, unknown>) => String(r["_category"] || "").trim();
    const provOf = (r: Record<string, unknown>) => String(r["_province"] || "").trim();
    const skuOf = (r: Record<string, unknown>) => String(r["Article"] ?? "").trim();
    const siteOf = (r: Record<string, unknown>) => String(r["Site"] ?? "").trim();
    for (const row of enrichedRows) {
      const sub = subOf(row), cat = catOf(row), prov = provOf(row), article = skuOf(row), site = siteOf(row);
      if (sub) subOpts.add(sub);
      if (cat) catOpts.add(cat);
      if (prov) provOpts.add(prov);
      if (article && !skuMap.has(article)) {
        const desc = String(row["_productDescription"] || row["Article Desc"] || "").trim();
        skuMap.set(article, desc ? `${article} — ${desc}` : article);
      }
      if (site && !siteMap.has(site)) {
        const name = String(row["_storeName"] || row["Site Name"] || "").trim();
        siteMap.set(site, name ? `${site} — ${name}` : site);
      }
    }
    const filterOptions = {
      subChannels: [...subOpts].sort(),
      categories: [...catOpts].sort(),
      provinces: [...provOpts].sort(),
      skus: [...skuMap.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      sites: [...siteMap.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };

    // 2c. Apply the five optional dimension filters.
    const subSet = new Set(subChFilter), catSet = new Set(catFilter), provSet = new Set(provFilter);
    const skuSet = new Set(skuFilter), siteSet = new Set(siteFilter);
    const anyFilter = subSet.size || catSet.size || provSet.size || skuSet.size || siteSet.size;
    const reportRows = anyFilter
      ? enrichedRows.filter((row) => {
          if (subSet.size && !subSet.has(subOf(row))) return false;
          if (catSet.size && !catSet.has(catOf(row))) return false;
          if (provSet.size && !provSet.has(provOf(row))) return false;
          if (skuSet.size && !skuSet.has(skuOf(row))) return false;
          if (siteSet.size && !siteSet.has(siteOf(row))) return false;
          return true;
        })
      : enrichedRows;

    // 3. Period + analyses
    const ctx = buildDateContext(dateColumns);
    const [statusDefs, statusScenarios] = await Promise.all([getStatusDefinitions(), getStatusScenarios()]);
    const client = await getClientById(clientId);

    const latestMeta = ledgerResults.find(({ meta }) => meta?.reportYear)?.meta;
    const rYear = yearParam ? parseInt(yearParam, 10) : (latestMeta?.reportYear ?? ctx.maxYear ?? new Date().getFullYear());
    const rMonth = monthParam ? parseInt(monthParam, 10) : (latestMeta?.reportMonth ?? ctx.maxMonth ?? new Date().getMonth() + 1);
    const referenceDate = new Date(Date.UTC(rYear, rMonth, 0));

    const salesSummary = buildSalesSummary(reportRows, ctx);
    const marginAnalysis = buildMarginAnalysis(reportRows);
    const otoAnalysis = buildOpenToOrder({
      rows: reportRows,
      statusDefs,
      statusScenarios,
      otoMultipliers: config.otoMultipliers,
      hasRanging: !!client?.controlFiles?.ranging,
      rangingRows: !!client?.controlFiles?.ranging ? await getControlFileData<Record<string, unknown>>(clientId, "ranging") : [],
    });

    // ND detail (for the not-distributed opportunity) — best-effort
    let ndDetail: Awaited<ReturnType<typeof buildNumericalDistribution>>["detail"] = [];
    try {
      const hasRanging = !!client?.controlFiles?.ranging;
      const [ndStores, ndProducts, ndRanging] = await Promise.all([
        getMergedStores(),
        getProductLookup(clientId),
        hasRanging ? getControlFileData<Record<string, unknown>>(clientId, "ranging") : Promise.resolve([]),
      ]);
      ndDetail = buildNumericalDistribution({
        rows: reportRows, dateColumns, refYear: rYear, refMonth: rMonth, rollingMonths: ndMonths,
        hasRanging, rangingRows: ndRanging, stores: ndStores, products: ndProducts, channelNames,
      }).detail;
    } catch (e) {
      console.error("Charts: ND build failed — ND opportunity = 0", e);
    }

    const charts = buildChartsData({
      rows: reportRows,
      dateColumns,
      ctx,
      salesSummary,
      otoTotalValue: otoAnalysis.totalValue,
      marginSupport: marginAnalysis.summary.totalMarginSupport,
      ndDetail,
      otoMultipliers: config.otoMultipliers,
      referenceDate,
      phLastSold,
      phLastReceived,
    });

    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Response.json(
      {
        ...charts,
        filterOptions,
        meta: {
          clientName: clientName || client?.name || "",
          channelLabel: channelNames.join(", ") || channelIds.join(", "),
          periodLabel: `${monthNames[rMonth] || rMonth} ${rYear}`,
          rowCount: reportRows.length,
        },
      },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
