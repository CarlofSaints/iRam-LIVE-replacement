import { NextRequest } from "next/server";
import { requirePermission, noCacheHeaders, handleAuthError } from "@/lib/auth";
import { getUploadIndex } from "@/lib/uploadData";
import { getActiveClients } from "@/lib/clientData";
import { periodKey } from "@/lib/storeReportState";
import { runFilingChecks, dispoRootUrl } from "@/lib/dispoFilingCheck";
import type { FilingResult } from "@/lib/dispoFiling";

/**
 * SharePoint filing status for the most recent stamped periods — the grid
 * behind /dispo-filing, and the same rules the weekly email reports on.
 *
 * A client only appears in a period it actually LOADED a DISPO for: filing is
 * only expected where there was something to file.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodScore = (y: number, m: number, w: number) => y * 10000 + m * 100 + w;

// Fewer columns than the load checklist's 8: each one costs real Graph calls,
// and the weeks that matter for chasing filing are the recent ones.
const WINDOW = 4;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_uploads");

    const [uploads, clients] = await Promise.all([getUploadIndex(), getActiveClients()]);
    const activeIds = new Set(clients.map((c) => c.id));
    const nameById = new Map(clients.map((c) => [c.id, c.name]));

    const dispos = uploads.filter(
      (u) =>
        u.fileType === "dispo" && u.status === "processed" && activeIds.has(u.clientId) &&
        u.reportYear != null && u.reportMonth != null && u.reportWeek != null,
    );

    // Most recent N distinct stamped periods, oldest first — same ordering as
    // the DISPO Load Checklist so the two pages read the same way.
    const periodMap = new Map<string, { year: number; month: number; week: number; key: string; label: string }>();
    for (const u of dispos) {
      const y = u.reportYear!, m = u.reportMonth!, w = u.reportWeek!;
      const key = periodKey(y, m, w);
      if (!periodMap.has(key)) periodMap.set(key, { year: y, month: m, week: w, key, label: `Wk${w} ${MON[m] ?? m} ${y}` });
    }
    const requested = req.nextUrl.searchParams.get("period");
    let periods = [...periodMap.values()]
      .sort((a, b) => periodScore(b.year, b.month, b.week) - periodScore(a.year, a.month, a.week))
      .slice(0, WINDOW)
      .reverse();
    if (requested) periods = periods.filter((p) => p.key === requested);

    // Which clients loaded in each period, when, and how many DISPO files that
    // implies. Expected file count is the number of DISTINCT FILE NAMES the
    // client uploaded — the file they filed is the file they uploaded.
    //
    // Not the vendor count: a client with four vendor numbers where only two
    // loaded this week would be accused of filing half its files. And not the
    // vendor×channel count either: Cartoon Candy loads ONE file to both MAKRO
    // and WALMART, which counted as two and reported every such client "1/2".
    const loadedBy = new Map<string, Map<string, { at: string; by: string; files: Set<string> }>>();
    for (const u of dispos) {
      const pk = periodKey(u.reportYear!, u.reportMonth!, u.reportWeek!);
      if (!periods.some((p) => p.key === pk)) continue;
      const name = nameById.get(u.clientId)!;
      const forPeriod = loadedBy.get(pk) ?? new Map();
      const prev = forPeriod.get(name) ?? { at: "", by: "", files: new Set<string>() };
      if (u.uploadDate > prev.at) { prev.at = u.uploadDate; prev.by = u.uploadedByName; }
      if (u.fileName) prev.files.add(u.fileName.trim().toLowerCase());
      forPeriod.set(name, prev);
      loadedBy.set(pk, forPeriod);
    }

    const batch = await runFilingChecks(
      periods.map((p) => {
        const forPeriod = loadedBy.get(p.key);
        return {
          key: p.key,
          period: p,
          clientNames: [...(forPeriod?.keys() ?? [])],
          expectedFiles: Object.fromEntries(
            [...(forPeriod?.entries() ?? [])].map(([name, v]) => [name, v.files.size]),
          ),
        };
      }),
    );

    // One row per client, one cell per period — clients that loaded nothing in
    // a period get no cell rather than a false "not filed".
    const clientNames = [...new Set(periods.flatMap((p) => [...(loadedBy.get(p.key)?.keys() ?? [])]))].sort();
    const rows = clientNames.map((name) => ({
      clientName: name,
      cells: Object.fromEntries(
        periods.map((p) => {
          const r = (batch.byPeriod[p.key] ?? []).find((x: FilingResult) => x.clientName === name);
          const load = loadedBy.get(p.key)?.get(name);
          return [p.key, r ? { ...r, loadedAt: load?.at, loadedBy: load?.by } : null];
        }),
      ),
    }));

    const perPeriod = Object.fromEntries(
      periods.map((p) => {
        const rs = batch.byPeriod[p.key] ?? [];
        return [p.key, {
          checked: rs.length,
          filed: rs.filter((r: FilingResult) => r.verdict === "filed").length,
          problems: rs.filter((r: FilingResult) => r.verdict !== "filed").length,
        }];
      }),
    );

    return Response.json(
      { ran: batch.ran, error: batch.error, rootUrl: batch.rootUrl ?? dispoRootUrl(), periods, rows, perPeriod },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
