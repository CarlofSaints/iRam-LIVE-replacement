/* A main channel's DISPO export can carry sites belonging to companion channels
   — the Makro export also contains the Walmart, Food Store and Cash & Carry
   sites. At UPLOAD those rows are routed into the companion channel's own
   ledger (uploads/route.ts), which is right: the data belongs with the channel
   that owns the store.

   But the REPORTS only ever read the channel you ticked, so the live rows were
   invisible and what you saw instead were the copies left behind in the Makro
   ledger by loads that pre-date the split — frozen at whatever they held then.
   On VERIGREEN 9677 that meant A01/A02/A03 printing 0 units and 0 SOH while the
   DISPO carried 379/357/271 SOH and 23/31/52 Aug units.

   So the group has to be built the SAME way on both sides. It used to be built
   inline in the upload route only; putting it here is deliberate, so the read
   side and the write side cannot drift apart. */

import type { Channel } from "./types";

export interface ChannelRef {
  id: string;
  name: string;
}

/**
 * Every channel whose stores may appear in `mainChannelId`'s DISPO: itself plus
 * its companions. The link is read BOTH ways, so loading or reporting from
 * either side of a pair yields the same group.
 */
export function buildChannelGroup(
  mainChannelId: string,
  allChannels: Channel[],
): ChannelRef[] {
  const byId = new Map(allChannels.map((c) => [c.id, c]));
  const main = byId.get(mainChannelId);

  const ids = new Set<string>([mainChannelId]);
  for (const cid of main?.companionChannelIds ?? []) ids.add(cid);
  // …and any main channel that names this one as ITS companion.
  for (const c of allChannels) {
    if (!c.parentId && c.companionChannelIds?.includes(mainChannelId)) ids.add(c.id);
  }

  return [...ids]
    .map((id) => byId.get(id))
    .filter((c): c is Channel => !!c)
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Expand a report's selected channel ids to include each one's companions,
 * de-duplicated and with the caller's own selections kept first.
 */
export function expandToChannelGroups(
  channelIds: string[],
  allChannels: Channel[],
): string[] {
  const byId = new Map(allChannels.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };

  for (const id of channelIds) push(id);
  for (const id of channelIds) {
    // Companions hang off the MAIN channel, so resolve a sub-channel first.
    const mainId = byId.get(id)?.parentId ?? id;
    for (const c of buildChannelGroup(mainId, allChannels)) push(c.id);
  }
  return out;
}

/** The ledger key, matching salesData's buildRowKey. */
function rowKey(row: Record<string, unknown>): string | null {
  const a = String(row["Article"] ?? "").trim().toLowerCase();
  const s = String(row["Site"] ?? "").trim().toLowerCase();
  if (!a || !s) return null;
  return `${a}|${s}`;
}

const loadedAt = (row: Record<string, unknown>): number => {
  const t = Date.parse(String(row["_lastLoadedAt"] ?? ""));
  return Number.isFinite(t) ? t : 0;
};

export interface DedupeResult {
  rows: Record<string, unknown>[];
  /** Rows discarded because a fresher copy of the same Article|Site existed. */
  supersededRows: number;
  /** …of those, how many were the all-zero fossils this exists to kill. */
  supersededStale: number;
}

/**
 * Collapse rows gathered from several ledgers in one channel group to one row
 * per Article|Site, keeping the copy that was loaded most recently.
 *
 * Safe because a site belongs to exactly ONE channel within a group — that is
 * what the upload split guarantees — so two rows sharing an Article|Site here
 * are two copies of the same store, not two different stores. (Across unrelated
 * channels a site code is NOT unique, which is why this must never be used to
 * merge arbitrary channels.)
 *
 * `_lastLoadedAt` is re-stamped on every load that contains the row, even when
 * no value changed, so a row that no recent load has touched is exactly the
 * stale copy we want to drop.
 */
export function dedupeByFreshestLoad(
  rows: Record<string, unknown>[],
  dateColumns: string[],
): DedupeResult {
  const best = new Map<string, Record<string, unknown>>();
  const out: Record<string, unknown>[] = [];
  const order: (string | Record<string, unknown>)[] = [];
  let supersededRows = 0;
  let supersededStale = 0;

  const isEmpty = (r: Record<string, unknown>): boolean => {
    const num = (v: unknown) => {
      const n = Number(String(v ?? "").replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    if (num(r["SOH"]) !== 0) return false;
    return dateColumns.every((c) => num(r[c]) === 0);
  };

  for (const r of rows) {
    const k = rowKey(r);
    if (!k) { order.push(r); continue; }          // unkeyed rows pass through
    const prev = best.get(k);
    if (!prev) { best.set(k, r); order.push(k); continue; }

    supersededRows++;
    const loser = loadedAt(r) > loadedAt(prev) ? prev : r;
    if (isEmpty(loser)) supersededStale++;
    if (loser === prev) best.set(k, r);
  }

  for (const item of order) {
    if (typeof item !== "string") out.push(item);
    else out.push(best.get(item)!);
  }
  return { rows: out, supersededRows, supersededStale };
}
