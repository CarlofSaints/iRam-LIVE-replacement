/* Weekly rep action report — gather the trailing 7 send-days of action claims,
   build the spreadsheet, and email it to managers/CAMs (users flagged
   receiveActionReport). Shared by the Monday cron and the manual "run now" /
   "dry run" buttons. Reps do NOT receive a copy (managers/CAMs only). */

import { getClaimsForDays, recentClaimDays, type StoreReportClaim } from "./storeReportClaims";
import { buildActionWorkbook } from "./storeReportActionSheet";
import { getUsers } from "./userData";
import { sendActionReportEmail } from "./email";

export interface ActionReportResult {
  rangeLabel: string;
  days: string[];
  totalClaims: number;
  repCount: number;
  suspect: number;
  pending: number;
  recipients: string[];
  emailed: boolean;
  note?: string;
}

function labelDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export async function runActionReport(opts: { send: boolean; asOf?: Date; windowDays?: number }): Promise<ActionReportResult> {
  const days = recentClaimDays(opts.windowDays ?? 7, opts.asOf);
  // Only genuine, still-ticked claims (drop test sends + un-ticked).
  const claims = (await getClaimsForDays(days)).filter((c) => c.active && !c.test);

  const oldest = days[days.length - 1];
  const newest = days[0];
  const rangeLabel = `${labelDay(oldest)} to ${labelDay(newest)}`;

  const reps = new Set(claims.map((c) => c.repEmail || c.repName));
  const suspect = claims.filter((c) => c.verification?.outcome === "suspect").length;
  const pending = claims.filter((c) => !c.verification).length;

  const users = await getUsers();
  const recipients = users.filter((u) => u.active && u.receiveActionReport && u.email).map((u) => u.email);

  const result: ActionReportResult = {
    rangeLabel, days, totalClaims: claims.length, repCount: reps.size,
    suspect, pending, recipients, emailed: false,
  };

  if (!opts.send) return result;
  if (claims.length === 0) { result.note = "No claimed actions this week — nothing sent."; return result; }
  if (recipients.length === 0) { result.note = "No users have the weekly action report enabled — nothing sent."; return result; }

  const content = await buildActionWorkbook(claims as StoreReportClaim[], rangeLabel);
  const filename = `Rep Action Report - ${newest}.xlsx`;
  await sendActionReportEmail({
    to: recipients, rangeLabel, totalClaims: claims.length, repCount: reps.size, suspect, filename, content,
  });
  result.emailed = true;
  return result;
}
