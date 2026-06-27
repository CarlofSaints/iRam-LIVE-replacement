/* Daily store-report digest — compute per-channel engagement for a day and
   email the managers (users flagged receiveStoreReportDigest). Shared by the
   digest cron and the manual "send digest now" button. */

import { getTrackingDay, summariseByChannel, trackingDay } from "./storeReportTracking";
import { getUsers } from "./userData";
import { sendStoreReportDigestEmail } from "./email";

export interface DigestResult {
  day: string;
  dayLabel: string;
  totalSent: number;
  rows: { channel: string; sent: number; opened: number; used: number }[];
  recipients: string[];
  emailed: boolean;
}

export async function runStoreReportDigest(opts: { day?: string; send: boolean }): Promise<DigestResult> {
  const day = opts.day || trackingDay();
  const records = (await getTrackingDay(day)).filter((r) => !r.test);
  const rows = summariseByChannel(records);
  const totalSent = records.length;

  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const users = await getUsers();
  const recipients = users
    .filter((u) => u.active && u.receiveStoreReportDigest && u.email)
    .map((u) => u.email);

  let emailed = false;
  if (opts.send && recipients.length > 0) {
    await sendStoreReportDigestEmail({ to: recipients, dayLabel, totalSent, rows });
    emailed = true;
  }

  return { day, dayLabel, totalSent, rows, recipients, emailed };
}
