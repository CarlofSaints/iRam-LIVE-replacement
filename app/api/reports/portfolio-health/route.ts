import { NextRequest } from "next/server";
import { requirePermission, handleAuthError, noCacheHeaders } from "@/lib/auth";
import { loadPortfolioHealth } from "@/lib/portfolioLoad";
import {
  readSnapshot,
  listSnapshotDates,
  resolveComparisons,
  saveSnapshot,
  saveCube,
  readCube,
  snapshotDate,
  type PortfolioSnapshot,
} from "@/lib/portfolioSnapshot";
import type { PortfolioCube } from "@/lib/portfolioCube";

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

    /* The cube is fetched on its own (`?part=cube`) once the page has painted,
       because it is ~1MB and the tiles should not wait for it. The exception is
       a live computation: that already has the cube in hand, and making the
       page ask for it separately would re-run the whole twenty-second load. */
    if (url.searchParams.get("part") === "cube") {
      const dates = await listSnapshotDates(channelId);
      const newest = dates.length ? dates[dates.length - 1] : null;
      const cube = newest ? await readCube(channelId, newest) : null;
      if (!cube) {
        return Response.json(
          { error: "No stored cube for this channel yet. Use Recalculate now." },
          { status: 404, headers: noCacheHeaders() },
        );
      }
      return Response.json({ cube }, { headers: noCacheHeaders() });
    }

    let snapshot: PortfolioSnapshot | null = null;
    let computedLive = false;
    let cube: PortfolioCube | null = null;
    let cubeAvailable = false;

    if (!live) {
      const dates = await listSnapshotDates(channelId);
      const newest = dates.length ? dates[dates.length - 1] : null;
      if (newest) {
        snapshot = await readSnapshot(channelId, newest);
        if (snapshot) cubeAvailable = (await readCube(channelId, newest)) !== null;
      }
    }

    if (!snapshot) {
      const now = new Date();
      const date = snapshotDate(now);
      const loaded = await loadPortfolioHealth({
        channelId,
        date,
        year: url.searchParams.get("year"),
        month: url.searchParams.get("month"),
        week: url.searchParams.get("week"),
      });
      snapshot = {
        date,
        channelId,
        channelName: loaded.channelName,
        capturedAt: now.toISOString(),
        periodLabel: loaded.periodLabel,
        health: loaded.health,
      };
      computedLive = true;
      cube = loaded.cube;
      cubeAvailable = true;
      // Only ever saved on an explicit ask. A read that quietly writes would
      // let anyone opening the page mint a capture the comparison columns then
      // measure against, and the history would record page views, not weeks.
      if (save) {
        await saveSnapshot(snapshot);
        await saveCube(loaded.cube);
      }
    }

    const comparisons = await resolveComparisons(channelId, snapshot.date);
    const captureDates = await listSnapshotDates(channelId);

    return Response.json(
      {
        snapshot,
        comparisons,
        computedLive,
        cube,
        cubeAvailable,
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
