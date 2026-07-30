import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getActiveClients } from "@/lib/clientData";
import { getAllSalesLedgers, getSalesLedger } from "@/lib/salesData";
import { getUploadsByClient } from "@/lib/uploadData";
import { getReportCounts } from "@/lib/reportCounts";
import { analyzeCoverage, coverageMessageLines } from "@/lib/dataCoverage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VAT_RATE = 0.15;

/** Sales value-of-sales convention: (Prom SP > 0 ? Prom SP : Incl SP) / 1.15. Matches the reports. */
function effectivePriceExVat(row: Record<string, unknown>): number {
  const promSP = Number(row["Prom SP"] ?? 0);
  const inclSP = Number(row["Incl SP"] ?? 0);
  const price = !isNaN(promSP) && promSP > 0 ? promSP : !isNaN(inclSP) ? inclSP : 0;
  return price / (1 + VAT_RATE);
}

export interface DashboardClientRow {
  clientId: string;
  clientName: string;
  skuCount: number;
  ytdUnits: number;
  ytdValue: number;
  contributionPct: number; // share of total YTD value across all clients
  dispoCount: number;
  agedStockCount: number;
  vitalSignsRuns: number;
  monthEndRuns: number;
  /** Data-coverage flag: true when the monthly series has gaps (esp. prior-year). */
  hasDataGaps: boolean;
  /** Human-readable warning lines (empty when no gaps). */
  dataGapLines: string[];
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_dashboard");

    const [clients, reportCounts] = await Promise.all([
      getActiveClients(),
      getReportCounts(),
    ]);

    const rows: DashboardClientRow[] = [];

    for (const client of clients) {
      // ── Sales metrics: unique SKUs + YTD units/value across all the client's ledgers ──
      const ledgerMetas = await getAllSalesLedgers(client.id);
      const uniqueArticles = new Set<string>();
      const clientDateCols = new Set<string>();
      let ytdUnits = 0;
      let ytdValue = 0;

      for (const meta of ledgerMetas) {
        const dateCols = meta.dateColumns ?? [];
        for (const dc of dateCols) clientDateCols.add(dc);
        // YTD = the most recent year present in this ledger's date columns
        let maxYear = 0;
        for (const dc of dateCols) {
          const m = dc.match(/^(\d{2})-(\d{4})$/);
          if (m) {
            const yr = parseInt(m[2], 10);
            if (yr > maxYear) maxYear = yr;
          }
        }
        const currentYearCols =
          maxYear > 0
            ? dateCols.filter((dc) => {
                const m = dc.match(/^(\d{2})-(\d{4})$/);
                return m != null && parseInt(m[2], 10) === maxYear;
              })
            : dateCols;

        const rowsForChannel = await getSalesLedger(client.id, meta.channelId);
        for (const row of rowsForChannel) {
          const article = String(row["Article"] ?? "").trim();
          if (article) uniqueArticles.add(article);

          const price = effectivePriceExVat(row);
          for (const col of currentYearCols) {
            const units = Number(row[col] ?? 0);
            if (!isNaN(units)) {
              ytdUnits += units;
              ytdValue += units * price;
            }
          }
        }
      }

      // ── Upload counts: split DISPO vs aged stock, deduplicated by file name ──
      const uploads = await getUploadsByClient(client.id);
      const dispoFiles = new Set<string>();
      const agedFiles = new Set<string>();
      for (const u of uploads) {
        if (u.fileType === "aged_stock") agedFiles.add(u.fileName);
        else dispoFiles.add(u.fileName);
      }

      const counts = reportCounts[client.id] ?? { vitalSigns: 0, monthEnd: 0 };

      const coverage = analyzeCoverage([...clientDateCols]);

      rows.push({
        clientId: client.id,
        clientName: client.name,
        skuCount: uniqueArticles.size,
        ytdUnits: Math.round(ytdUnits),
        ytdValue: Math.round(ytdValue * 100) / 100,
        contributionPct: 0, // filled in below once the grand total is known
        dispoCount: dispoFiles.size,
        agedStockCount: agedFiles.size,
        vitalSignsRuns: counts.vitalSigns ?? 0,
        monthEndRuns: counts.monthEnd ?? 0,
        hasDataGaps: coverage.hasGaps,
        dataGapLines: coverageMessageLines(coverage),
      });
    }

    // ── Contribution: each client's share of total YTD value ──
    const totalValue = rows.reduce((sum, r) => sum + r.ytdValue, 0);
    for (const r of rows) {
      r.contributionPct =
        totalValue > 0 ? Math.round((r.ytdValue / totalValue) * 1000) / 10 : 0;
    }

    rows.sort((a, b) => b.ytdValue - a.ytdValue);

    return Response.json({ clients: rows }, { headers: noCacheHeaders() });
  } catch (err) {
    return handleAuthError(err);
  }
}
