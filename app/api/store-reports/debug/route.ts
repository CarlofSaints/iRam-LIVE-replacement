import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { enrichLedger } from "@/lib/enrichment";
import { getStatusDefinitions } from "@/lib/statusData";
import { getStatusScenarios } from "@/lib/statusScenarioData";
import { classifyRowStatus } from "@/lib/monthEndReport";

// Per-SKU diagnostic for one store: shows the raw DISPO + enriched values behind
// every line, so a discrepancy (OOS count, description source, status) can be
// traced. Open in-browser while logged in: /api/store-reports/debug?site=<code>
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return NaN;
  return Number(s);
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "manage_store_reports");
    const u = new URL(req.url);
    const site = (u.searchParams.get("site") || "").trim().toLowerCase();
    const article = (u.searchParams.get("article") || "").trim().toLowerCase();
    const clientId = u.searchParams.get("clientId") || undefined;
    if (!site) return Response.json({ error: "site is required" }, { status: 400, headers: noCacheHeaders() });

    const allClients = await getClients();
    const clients = clientId
      ? allClients.filter((c) => c.id === clientId)
      : allClients.filter((c) => c.sendConsolidatedStoreReports);

    const [statusDefs, allScenarios] = await Promise.all([getStatusDefinitions(), getStatusScenarios()]);

    const out: Record<string, unknown>[] = [];
    for (const client of clients) {
      const ledgers = await getAllSalesLedgers(client.id);
      const channelIds: string[] = [];
      const rows: Record<string, unknown>[] = [];
      const dateCols = new Set<string>();
      for (const meta of ledgers) {
        for (const dc of meta.dateColumns ?? []) dateCols.add(dc);
        const ledger = await getSalesLedger(client.id, meta.channelId);
        const filtered = ledger.filter((r) => String(r["Site"] ?? "").trim().toLowerCase() === site);
        if (filtered.length) { rows.push(...filtered); channelIds.push(meta.channelId); }
      }
      if (!rows.length) continue;
      const enriched = await enrichLedger(rows, client.id);
      const scenarios = allScenarios.filter((s) => channelIds.includes(s.channelId));
      const cols = Array.from(dateCols);

      for (const row of enriched.rows) {
        const art = String(row["Article"] ?? "");
        if (article && art.toLowerCase() !== article) continue;
        const soh = num(row["SOH"]);
        let sales = 0;
        for (const c of cols) { const v = num(row[c]); if (!isNaN(v)) sales += v; }
        out.push({
          client: client.name,
          article: art,
          dispoDesc: row["Article Desc"] ?? "",
          pmfDesc: row["_productDescription"] ?? "",
          clientProductId: row["_clientProductId"] ?? "",
          SOH: isNaN(soh) ? null : soh,
          salesYTD: sales,
          isOOS: !isNaN(soh) && soh <= 0,
          prst: row["Status"] ?? row["PR ST"] ?? "",
          pmfStatus: row["_productStatus"] ?? "",
          classification: classifyRowStatus(row, statusDefs, scenarios),
          ranging: row["_rangingStatus"] === true ? "TRUE" : (client.controlFiles?.ranging ? "FALSE" : ""),
          MAC: row["MAC"] ?? "",
          nettCost: row["Nett Cost"] ?? "",
          lastSold: row["Last Sold"] ?? "",
          lastRecv: row["Last Recv"] ?? "",
        });
      }
    }

    out.sort((a, b) => Number(b.isOOS) - Number(a.isOOS) || String(a.article).localeCompare(String(b.article)));
    return Response.json({ site, count: out.length, oosCount: out.filter((r) => r.isOOS).length, rows: out }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
