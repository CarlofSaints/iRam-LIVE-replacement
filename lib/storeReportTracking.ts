/* ──────────────────────────────────────────────────────────────
   Store-report engagement tracking.

   One TrackRecord per SEND, stored in a per-day file (SAST). The email carries
   a 1×1 pixel and the hosted page beacons page-views + KPI-card clicks, all
   keyed by the send's token. This gives the funnel per store/rep/channel:

     sent    → a report was emailed
     opened  → email pixel fired OR the page was opened (click-through)
     used    → the rep engaged: clicked MORE THAN ONE distinct KPI card

   Counters are updated read-modify-write; volume is low (≈ one rep per token)
   so races are negligible and a rare lost increment is acceptable for analytics.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";

export type TrackEvent = "open" | "view" | "card";

export interface TrackRecord {
  token: string;            // = send id (or a uuid for test sends)
  day: string;              // YYYY-MM-DD (SAST) — which daily file it lives in
  periodKey: string;
  siteCode: string;
  store: string;
  channel: string;          // store sub-channel — the grouping key for the digest
  repEmail: string;
  repName: string;
  sentAt: string;
  test?: boolean;           // test sends are excluded from the manager digest
  opens: number;
  pageViews: number;
  cardClicks: number;
  distinctCards: string[];  // unique KPI-card keys clicked
  firstOpenAt?: string;
  firstViewAt?: string;
  lastEventAt?: string;
}

function dayFileKey(day: string): string {
  return `store-reports/tracking/${day}.json`;
}

// YYYY-MM-DD in SA local time (so "today" matches the working day).
export function trackingDay(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function getTrackingDay(day: string): Promise<TrackRecord[]> {
  return readJson<TrackRecord[]>(dayFileKey(day), []);
}

export async function addTrackingSend(rec: {
  token: string; day: string; periodKey: string; siteCode: string; store: string;
  channel: string; repEmail: string; repName: string; sentAt: string; test?: boolean;
}): Promise<void> {
  const records = await getTrackingDay(rec.day);
  if (records.some((r) => r.token === rec.token)) return; // idempotent
  records.push({
    ...rec, opens: 0, pageViews: 0, cardClicks: 0, distinctCards: [],
  });
  await writeJson(dayFileKey(rec.day), records);
}

export async function recordTrackingEvent(
  day: string, token: string, event: TrackEvent, card?: string,
): Promise<void> {
  if (!day || !token) return;
  const records = await getTrackingDay(day);
  const rec = records.find((r) => r.token === token);
  if (!rec) return; // unknown token — ignore
  const now = new Date().toISOString();
  rec.lastEventAt = now;
  if (event === "open") {
    rec.opens++;
    if (!rec.firstOpenAt) rec.firstOpenAt = now;
  } else if (event === "view") {
    rec.pageViews++;
    if (!rec.firstViewAt) rec.firstViewAt = now;
  } else if (event === "card") {
    rec.cardClicks++;
    const c = (card || "").trim();
    if (c && !rec.distinctCards.includes(c)) rec.distinctCards.push(c);
  }
  await writeJson(dayFileKey(day), records);
}

// ── Derived engagement helpers ───────────────────────────────────────────────

export function isOpened(r: TrackRecord): boolean {
  return r.opens > 0 || r.pageViews > 0;
}
export function isUsed(r: TrackRecord): boolean {
  return r.distinctCards.length > 1;
}

export interface ChannelEngagement {
  channel: string;
  sent: number;
  opened: number;
  used: number;
}

export function summariseByChannel(records: TrackRecord[]): ChannelEngagement[] {
  const map = new Map<string, ChannelEngagement>();
  for (const r of records) {
    if (r.test) continue;
    const key = r.channel || "(unknown)";
    let e = map.get(key);
    if (!e) { e = { channel: key, sent: 0, opened: 0, used: 0 }; map.set(key, e); }
    e.sent++;
    if (isOpened(r)) e.opened++;
    if (isUsed(r)) e.used++;
  }
  return [...map.values()].sort((a, b) => b.sent - a.sent || a.channel.localeCompare(b.channel));
}
