/* ──────────────────────────────────────────────────────────────
   Phantom stock counts — what a rep physically found on the shelf.

   The hosted /r page shows a "Stock Found" box on every Phantom line. What the
   rep types is beaconed here so it survives a cleared browser, so it can be
   exported/emailed later from any device, and so the business can see what was
   actually counted rather than only what was ticked off.

   STORAGE: one blob per store × period —
       store-reports/counts/{year}-{month}-{week}/{loose site code}.json
   NOT one shared file. A shared file would be a read-modify-write on a hot key
   and two reps saving at once would silently erase each other (the exact
   lost-update that hit the upload index). Per store × period, the only writer is
   normally the one rep standing in that store.

   Even so the merge is timestamp-based per LINE, never a wholesale overwrite:
   the page posts the counts it holds and the server keeps whichever entry is
   newer. So two reps counting the same store keep each other's work, and a
   stale phone coming back online can't roll back a fresher count.
   ────────────────────────────────────────────────────────────── */

import { readJson, writeJson } from "./blob";
import { looseCode } from "./storeReportCodeMap";

export interface PhantomCount {
  clientId: string;
  clientName: string;
  vendor: string;
  article: string;
  description: string;
  found: number;          // units found on the shelf — decimals allowed (metres of rope, etc.)
  at: string;             // ISO timestamp the rep entered it — the merge key
  repEmail?: string;
  repName?: string;
}

export interface PhantomCountFile {
  siteCode: string;
  storeName: string;
  year: number;
  month: number;
  week: number;
  updatedAt: string;
  lines: Record<string, PhantomCount>;   // keyed `clientId|article`
}

export interface PhantomCountContext {
  siteCode: string;
  storeName?: string;
  year: number;
  month: number;
  week: number;
}

export function phantomLineKey(clientId: string, article: string): string {
  return `${clientId}|${article}`;
}

export function phantomPeriodKey(year: number, month: number, week: number): string {
  return `${year}-${month}-${week}`;
}

function fileKey(ctx: PhantomCountContext): string {
  const site = looseCode(ctx.siteCode) || "unknown";
  return `store-reports/counts/${phantomPeriodKey(ctx.year, ctx.month, ctx.week)}/${site}.json`;
}

function emptyFile(ctx: PhantomCountContext): PhantomCountFile {
  return {
    siteCode: ctx.siteCode,
    storeName: ctx.storeName ?? "",
    year: ctx.year,
    month: ctx.month,
    week: ctx.week,
    updatedAt: "",
    lines: {},
  };
}

export async function getPhantomCounts(ctx: PhantomCountContext): Promise<PhantomCountFile> {
  return readJson<PhantomCountFile>(fileKey(ctx), emptyFile(ctx));
}

export type IncomingCount = Omit<PhantomCount, "found"> & { found: number | null };

/* PURE merge — kept free of Blob so the rule that decides whether a rep's count
   survives can be tested directly (scripts/test-phantom-counts.ts). Mutates and
   returns `lines`, and reports whether anything actually changed so an idle page
   re-posting the same counts doesn't cause a pointless write.

   `found: null` is an explicit CLEAR (the rep emptied the box) and removes the
   line — but it obeys the same timestamp rule as a value, so a stale phone
   coming back online can't wipe a fresher count made on another device. */
export function mergePhantomCounts(
  lines: Record<string, PhantomCount>,
  incoming: IncomingCount[],
): { changed: boolean } {
  let changed = false;
  for (const entry of incoming) {
    const key = phantomLineKey(entry.clientId, entry.article);
    const existing = lines[key];
    // Older than what we already hold → the sender is out of date; keep ours.
    if (existing && existing.at && entry.at && entry.at < existing.at) continue;

    if (entry.found === null) {
      // A CLEAR is destructive, so it needs STRICTLY NEWER evidence than what we
      // hold — an equal timestamp means we cannot tell which came first, and
      // losing a real count someone walked the aisle for is far worse than
      // keeping a stale one the rep can simply clear again.
      if (existing && existing.at && !(entry.at > existing.at)) continue;
      if (existing) { delete lines[key]; changed = true; }
      continue;
    }
    // No-op re-send of the same figure — but still take it if it is NEWER, so the
    // stored timestamp advances and a genuinely older entry can't win later.
    if (existing && existing.found === entry.found && !(entry.at > (existing.at || ""))) continue;
    lines[key] = { ...entry, found: entry.found };
    changed = true;
  }
  return { changed };
}

export async function savePhantomCounts(
  ctx: PhantomCountContext,
  incoming: IncomingCount[],
): Promise<PhantomCountFile> {
  const file = await getPhantomCounts(ctx);
  if (!file.storeName && ctx.storeName) file.storeName = ctx.storeName;

  const { changed } = mergePhantomCounts(file.lines, incoming);
  if (!changed) return file;

  file.updatedAt = new Date().toISOString();
  await writeJson(fileKey(ctx), file);
  return file;
}
