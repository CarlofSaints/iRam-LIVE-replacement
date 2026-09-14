import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { loadPortfolioHealth } from "@/lib/portfolioLoad";
import {
  readSnapshot,
  listSnapshotDates,
  resolveComparisons,
  saveSnapshot,
  snapshotDate,
  type PortfolioSnapshot,
} from "@/lib/portfolioSnapshot";

/* Portfolio Stock Health — one channel's roll-up, plus its comparison columns.
 *
 * By default this serves the LATEST STORED CAPTURE rather than recomputing.
 * That is not a cache: the capture is the thing the comparisons are made
 * against, so serving a freshly computed number beside week-old comparison
 * columns would show a delta between two readings taken on different days and
 * label it a week. `?live=1` recomputes for anyone who wants to see the effect
 * of a DISPO that has just landed, and says plainly that it is doing so.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, "view_dashboard");

    const url = new URL(req.url);
    const channelId = url.searchParams.get("channelId");
    const live = url.searchParams.get("live") === "1";
    const save = url.searchParams.get("save") === "1";

    if (!channelId) {
      return Response.json({ error: "channelId is required" }, { status: 400 });
    }

    let snapshot: PortfolioSnapshot | null = null;
    let computedLive = false;

    if (!live) {
      const dates = await listSnapshotDates(channelId);
      const newest = dates.length ? dates[dates.length - 1] : null;
      if (newest) snapshot = await readSnapshot(channelId, newest);
    }

    if (!snapshot) {
      const loaded = await loadPortfolioHealth({
        channelId,
        year: url.searchParams.get("year"),
        month: url.searchParams.get("month"),
        week: url.searchParams.get("week"),
      });
      const now = new Date();
      snapshot = {
        date: snapshotDate(now),
        channelId,
        channelName: loaded.channelName,
        capturedAt: now.toISOString(),
        periodLabel: loaded.periodLabel,
        health: loaded.health,
      };
      computedLive = true;
      // Only ever saved on an explicit ask. A read that quietly writes would
      // let anyone opening the page mint a capture the comparison columns then
      // measure against, and the history would record page views, not weeks.
      if (save) await saveSnapshot(snapshot);
    }

    const comparisons = await resolveComparisons(channelId, snapshot.date);
    const captureDates = await listSnapshotDates(channelId);

    return Response.json(
      {
        snapshot,
        comparisons,
        computedLive,
        /* How much history exists at all. The page needs this to explain empty
           comparison columns as "we have not been capturing long enough" and
           not as "nothing changed". */
        captureCount: captureDates.length,
        firstCapture: captureDates[0] ?? null,
      },
      { headers: noCacheHeaders() },
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
