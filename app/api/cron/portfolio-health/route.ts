import { NextRequest } from "next/server";
import { getChannels } from "@/lib/channelData";
import { loadPortfolioHealth } from "@/lib/portfolioLoad";
import { saveSnapshot, saveCube, snapshotDate } from "@/lib/portfolioSnapshot";
import { addLog } from "@/lib/activityLog";
import { getUsers } from "@/lib/userData";
import { sendPortfolioHealthEmail } from "@/lib/email";
import { buildPortfolioHealthEmail } from "@/lib/portfolioHealthEmail";
import { resolveComparisons } from "@/lib/portfolioSnapshot";
import type { PortfolioHealth } from "@/lib/portfolioHealth";
import type { PortfolioCube } from "@/lib/portfolioCube";
import type { ComparisonPoint } from "@/lib/portfolioSnapshot";

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

/* Resend accepts roughly two a second. Nineteen users is nothing, but the
   list grows and a burst that trips the rate limit fails the tail of it
   silently from the reader's point of view. */
const SEND_GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MailOutcome {
  sent: number;
  /** Subscribers whose clients had nothing in this channel — no mail sent. */
  skipped: number;
  errors: string[];
}

/**
 * One mail per subscriber for one channel, each scoped to that person's
 * clients.
 *
 * A recipient with no `clientIds` is internal and gets the whole channel; one
 * with client scoping gets only their own, re-aggregated from the cube so the
 * mail and the page agree by construction. A scoped recipient with nothing
 * wrong in this channel gets no mail at all — a weekly "nothing to report"
 * forever is how a report gets filtered to a folder and never read again.
 */
async function emailChannel(args: {
  channelName: string;
  periodLabel: string;
  captureDate: string;
  health: PortfolioHealth;
  cube: PortfolioCube;
  comparisons: ComparisonPoint[];
  reportUrl: string;
  send: boolean;
}): Promise<MailOutcome> {
  const out: MailOutcome = { sent: 0, skipped: 0, errors: [] };

  const users = (await getUsers()).filter(
    (u) => u.active !== false && u.receivePortfolioHealth === true && u.email,
  );

  for (const user of users) {
    const body = buildPortfolioHealthEmail({
      channelName: args.channelName,
      periodLabel: args.periodLabel,
      captureDate: args.captureDate,
      health: args.health,
      cube: args.cube,
      comparisons: args.comparisons,
      reportUrl: args.reportUrl,
      recipient: {
        name: user.name,
        email: user.email,
        clientIds: user.clientIds ?? [],
      },
    });

    if (!body.hasContent) {
      out.skipped++;
      continue;
    }
    if (!args.send) {
      // Dry run: prove who WOULD get what without sending anything.
      out.sent++;
      continue;
    }

    try {
      await sendPortfolioHealthEmail({ to: user.email, subject: body.subject, html: body.html });
      out.sent++;
    } catch (err) {
      out.errors.push(`${user.email}: ${err instanceof Error ? err.message : "send failed"}`);
    }
    await sleep(SEND_GAP_MS);
  }

  return out;
}

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
  /* ?send=0 captures and reports who WOULD be mailed without sending. The
     first real run is worth doing this way. */
  const send = url.searchParams.get("send") !== "0";
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    new URL(req.url).origin;

  const results: {
    channelId: string;
    channelName: string;
    ok: boolean;
    lines?: number;
    sites?: number;
    emailed?: number;
    skipped?: number;
    emailErrors?: string[];
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
        const loaded = await loadPortfolioHealth({ channelId: channel.id, date });

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
        // The cube is what makes the page filterable. Saved second and to its
        // own key: an aggregate capture with no cube still renders (the page
        // falls back to the stored tables), but a cube with no capture would
        // be an orphan nothing reads.
        await saveCube(loaded.cube);

        /* Email the subscribers for THIS channel before moving to the next, so
           a failure later on does not silently cost this channel its mail. The
           send is deliberately part of the capture job rather than a second
           cron: the mail must describe the capture that was just stored, and a
           separate schedule would eventually race it and send last week's. */
        const mailed = await emailChannel({
          channelName: loaded.channelName,
          periodLabel: loaded.periodLabel,
          captureDate: date,
          health: loaded.health,
          cube: loaded.cube,
          comparisons: await resolveComparisons(channel.id, date),
          reportUrl: `${baseUrl}/portfolio-health`,
          send,
        });

        results.push({
          channelId: channel.id,
          channelName: channel.name,
          ok: true,
          lines: loaded.health.activeLines,
          sites: loaded.health.sites,
          emailed: mailed.sent,
          skipped: mailed.skipped,
          emailErrors: mailed.errors,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "capture failed";
        console.error(`[portfolio-health] ${channel.name} failed`, err);
        results.push({ channelId: channel.id, channelName: channel.name, ok: false, error: msg });
      }
    }

    const failed = results.filter((r) => !r.ok);
    const mailErrors = results.flatMap((r) => r.emailErrors ?? []);
    await addLog({
      userId: "system",
      userName: "Portfolio Health capture",
      action: "Weekly portfolio stock health capture",
      details:
        `${date} — ${results.length - failed.length} of ${results.length} channel(s) captured` +
        `; emailed ${results.reduce((n, r) => n + (r.emailed ?? 0), 0)}` +
        `, skipped ${results.reduce((n, r) => n + (r.skipped ?? 0), 0)} (nothing for their clients)` +
        (send ? "" : " [DRY RUN — nothing sent]") +
        (mailErrors.length ? `; MAIL FAILURES: ${mailErrors.join(", ")}` : "") +
        (failed.length ? `; FAILED: ${failed.map((f) => `${f.channelName} (${f.error})`).join(", ")}` : ""),
      // A mail failure is a real failure. Recording it as success would leave
      // the only trace of a send that never happened in a 200 nobody reads.
      status: failed.length || mailErrors.length ? "error" : "success",
    }).catch(() => {});

    return Response.json(
      { ok: failed.length === 0 && mailErrors.length === 0, date, send, results },
      { status: failed.length || mailErrors.length ? 500 : 200, headers: { "Cache-Control": "no-store" } },
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
