import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { getAllSalesLedgers, getSalesLedger, getSalesLedgerMeta } from "@/lib/salesData";
import { getUploadsByClient } from "@/lib/uploadData";

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_dashboard");

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    if (!clientId) {
      return Response.json(
        { error: "clientId is required" },
        { status: 400, headers: noCacheHeaders() }
      );
    }

    const channelIdsParam = url.searchParams.get("channelIds");
    const filterChannelIds = channelIdsParam
      ? channelIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    // Load uploads (deduplicate by fileName)
    const uploads = await getUploadsByClient(clientId);
    const uniqueFileNames = new Set(uploads.map((u) => u.fileName));
    const totalDispos = uniqueFileNames.size;

    // Load all ledgers for this client
    const allLedgerMetas = await getAllSalesLedgers(clientId);
    const relevantMetas = filterChannelIds
      ? allLedgerMetas.filter((m) => filterChannelIds.includes(m.channelId))
      : allLedgerMetas;

    // Load ledger rows for each relevant channel
    let ytdVolume = 0;
    let ytdValue = 0;
    const uniqueArticles = new Set<string>();
    const uniqueSites = new Set<string>();

    const DATE_RE = /^\d{2}-\d{4}$/;

    for (const meta of relevantMetas) {
      const rows = await getSalesLedger(clientId, meta.channelId);
      // Determine max year from date columns
      let maxYear = 0;
      for (const dc of meta.dateColumns ?? []) {
        const m = dc.match(/^(\d{2})-(\d{4})$/);
        if (m) {
          const yr = parseInt(m[2], 10);
          if (yr > maxYear) maxYear = yr;
        }
      }
      const currentYearCols = maxYear > 0
        ? (meta.dateColumns ?? []).filter((dc) => {
            const m = dc.match(/^(\d{2})-(\d{4})$/);
            return m != null && parseInt(m[2], 10) === maxYear;
          })
        : (meta.dateColumns ?? []);

      for (const row of rows) {
        const article = String(row["Article"] ?? "").trim();
        const site = String(row["Site"] ?? "").trim();
        if (article) uniqueArticles.add(article);
        if (site) uniqueSites.add(site);

        const nettCost = Number(row["Nett Cost"] ?? 0);
        const nc = isNaN(nettCost) ? 0 : nettCost;

        for (const col of currentYearCols) {
          const val = Number(row[col] ?? 0);
          if (!isNaN(val)) {
            ytdVolume += val;
            ytdValue += val * nc;
          }
        }
      }
    }

    return Response.json(
      {
        totalDispos,
        ytdVolume: Math.round(ytdVolume),
        ytdValue: Math.round(ytdValue * 100) / 100,
        totalSkus: uniqueArticles.size,
        totalStores: uniqueSites.size,
      },
      { headers: noCacheHeaders() }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
