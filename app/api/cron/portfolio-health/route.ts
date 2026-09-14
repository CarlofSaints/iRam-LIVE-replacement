import { NextRequest } from "next/server";
import { getChannels } from "@/lib/channelData";
import { loadPortfolioHealth } from "@/lib/portfolioLoad";
import { saveSnapshot, snapshotDate } from "@/lib/portfolioSnapshot";
import { addLog } from "@/lib/activityLog";

/* Weekly Portfolio Stock Health capture — the thing that makes the comparison
 * columns possible at all.
 *
 * iRam keeps no stock history: a newer DISPO overwrites SOH rather than adding
 * to a series (lib/dispoSnapshot.ts). So "vs last week" cannot be derived at
 * read time, only REMEMBERED, and this is what does the remembering. Skip a
 * week and that week is gone for good — there is no backfill, because the
 * numbers it would need no longer exist anywhere.
 *
 * ── Why Thursday ──────────────────────────────────────────────
 * The DISPO files are dated Monday and are usually all in by Wednesday. A
 * capture taken before they land would record a half-loaded portfolio as the
 * week's truth, and every later comparison would measure against it. Thursday
 * 04:00 UTC is 06:00 SAST.
 *
 * ── Failing loudly ────────────────────────────────────────────
 * A capture that silently stops is worse than none: the page keeps rendering,
 * the comparison columns keep saying "no data for this period", and nothing
 * says why. So every channel's outcome is written to the activity log whether
 * it succeeded or not, one channel's failure never aborts the others, and the
 * response carries per-channel errors. The page separately shows the age of
 * the newest capture, which goes stale visibly if this stops running.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const onlyChannel = url.searchParams.get("channelId");

  const results: {
    channelId: string;
    channelName: string;
    ok: boolean;
    lines?: number;
    sites?: number;
    error?: string;
  }[] = [];

  try {
    const channels = await getChannels();
    // Main channels only — a sub-channel is a slice of one of these, not a
    // portfolio in its own right.
    const mains = channels.filter(
      (c) => !c.parentId && c.active !== false && (!onlyChannel || c.id === onlyChannel),
    );

    const now = new Date();
    const date = snapshotDate(now);

    for (const channel of mains) {
      try {
        const loaded = await loadPortfolioHealth({ channelId: channel.id });

        // A channel with no data at all should not mint an empty capture that
        // later weeks then compare against and read as a total collapse.
        if (loaded.health.activeLines === 0) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            ok: true,
            lines: 0,
            sites: 0,
          });
          continue;
        }

        await saveSnapshot({
          date,
          channelId: channel.id,
          channelName: loaded.channelName,
          capturedAt: now.toISOString(),
          periodLabel: loaded.periodLabel,
          health: loaded.health,
        });

        results.push({
          channelId: channel.id,
          channelName: channel.name,
          ok: true,
          lines: loaded.health.activeLines,
          sites: loaded.health.sites,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "capture failed";
        console.error(`[portfolio-health] ${channel.name} failed`, err);
        results.push({ channelId: channel.id, channelName: channel.name, ok: false, error: msg });
      }
    }

    const failed = results.filter((r) => !r.ok);
    await addLog({
      userId: "system",
      userName: "Portfolio Health capture",
      action: "Weekly portfolio stock health capture",
      details:
        `${date} — ${results.length - failed.length} of ${results.length} channel(s) captured` +
        (failed.length ? `; FAILED: ${failed.map((f) => `${f.channelName} (${f.error})`).join(", ")}` : ""),
      status: failed.length ? "error" : "success",
    }).catch(() => {});

    return Response.json(
      { ok: failed.length === 0, date, results },
      { status: failed.length ? 500 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[portfolio-health] capture aborted", err);
    const msg = err instanceof Error ? err.message : "capture aborted";
    await addLog({
      userId: "system",
      userName: "Portfolio Health capture",
      action: "Weekly portfolio stock health capture",
      details: `ABORTED before any channel was captured: ${msg}`,
      status: "error",
    }).catch(() => {});
    return Response.json({ ok: false, error: msg, results }, { status: 500 });
  }
}
