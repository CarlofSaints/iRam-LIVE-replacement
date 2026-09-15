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

/**
 * The metas that should decide a report's PERIOD: the picked channels' own
 * ledgers, not the companions read alongside them. Falls back to every ledger
 * read when none of the picked ones has a meta, rather than resolving nothing.
 */
export function pickedMetas<M>(
  ledgers: { channelId: string; meta: M | null }[],
  selectedIds: string[],
  allChannels: Channel[],
): (M | null)[] {
  const byId = new Map(allChannels.map((c) => [c.id, c]));
  const mainOf = (id: string) => byId.get(id)?.parentId ?? id;
  const wanted = new Set(selectedIds.map(mainOf));
  const picked = ledgers.filter((l) => wanted.has(mainOf(l.channelId)) && l.meta);
  return (picked.length ? picked : ledgers).map((l) => l.meta);
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

export interface ScopedRows {
  rows: Record<string, unknown>[];
  supersededRows: number;
  supersededStale: number;
  /** Rows whose store belongs to a channel in the group that was NOT picked. */
  droppedOtherChannel: number;
  /** Rows on a picked channel whose store is not in a ticked sub-channel. */
  droppedSubChannel: number;
  /** The picked MAIN channels' names, and only those — for labels and filenames. */
  channelNames: string[];
}

/**
 * Reading the whole group is only half the job: the rows must then be cut back
 * to the channels that were actually PICKED.
 *
 * Reading Makro's companions was added so Walmart's live rows became visible
 * (f613e0c), but nothing filtered them back out, so a Walmart report carried
 * every Makro store and a Makro report every Walmart store, and both files were
 * labelled with the whole group's names (Carl, 15 Sep 2026).
 *
 * Each row belongs to the channel that OWNS its store: the store master's
 * `channel`, matched by name within the group, which is exactly how the upload
 * split decides (uploads/route.ts). A site with no store-master record belongs
 * to the ledger it was read from. The fossil copy of a Walmart store left in
 * the Makro ledger therefore belongs to Walmart too, not to Makro.
 *
 * Deduplication runs per GROUP, never across groups: a site code is unique
 * inside one group but not across unrelated channels, so picking Makro and
 * Massbuild together must not collapse their rows onto each other.
 */
export function scopeRowsToSelection(
  ledgers: { channelId: string; rows: Record<string, unknown>[] }[],
  selectedIds: string[],
  allChannels: Channel[],
  stores: { siteNum?: string; channel?: string; subChannel?: string }[],
  dateColumns: string[],
): ScopedRows {
  const byId = new Map(allChannels.map((c) => [c.id, c]));
  const mainOf = (id: string) => byId.get(id)?.parentId ?? id;
  const selectedMains = [...new Set(selectedIds.map(mainOf))];
  const wanted = new Set(selectedMains);

  /* Ticked SUB-channels narrow their main channel to those stores — the store
     file's SUB_CHANNEL, e.g. Makro's liquor stores vs its main stores (Carl,
     15 Sep 2026: some clients report liquor only, some main only). A main with
     every sub ticked, or none, is not narrowed, and a main that has no
     sub-channels (Walmart) is never touched by another main's ticks. */
  const subsByMain = new Map<string, Set<string>>();
  for (const id of new Set(selectedIds)) {
    const c = byId.get(id);
    if (!c?.parentId) continue;
    const set = subsByMain.get(c.parentId) ?? new Set<string>();
    set.add(c.name.trim().toUpperCase());
    subsByMain.set(c.parentId, set);
  }
  for (const [mainId, set] of [...subsByMain]) {
    const total = allChannels.filter((c) => c.parentId === mainId).length;
    if (set.size >= total) subsByMain.delete(mainId);
  }

  const groupKey = (mainId: string) => {
    const ids = buildChannelGroup(mainId, allChannels).map((c) => c.id).sort();
    return ids.length ? ids.join(",") : mainId;
  };
  const buckets = new Map<string, { mainId: string; ledgers: typeof ledgers }>();
  for (const l of ledgers) {
    const mainId = mainOf(l.channelId);
    const k = groupKey(mainId);
    const b = buckets.get(k) ?? { mainId, ledgers: [] };
    b.ledgers.push(l);
    buckets.set(k, b);
  }

  const out: Record<string, unknown>[] = [];
  let supersededRows = 0, supersededStale = 0, droppedOtherChannel = 0, droppedSubChannel = 0;

  for (const { mainId, ledgers: group } of buckets.values()) {
    const origin = new Map<Record<string, unknown>, string>();
    const all: Record<string, unknown>[] = [];
    for (const l of group) {
      for (const r of l.rows) { origin.set(r, mainOf(l.channelId)); all.push(r); }
    }
    const d = dedupeByFreshestLoad(all, dateColumns);
    supersededRows += d.supersededRows;
    supersededStale += d.supersededStale;

    const byName = new Map<string, string>();
    for (const c of buildChannelGroup(mainId, allChannels)) byName.set(c.name.trim().toUpperCase(), c.id);
    const siteOwner = new Map<string, string>();
    const siteSub = new Map<string, string>();
    for (const s of stores) {
      const owner = byName.get(String(s.channel ?? "").trim().toUpperCase());
      if (owner && s.siteNum) {
        const key = String(s.siteNum).trim().toLowerCase();
        siteOwner.set(key, owner);
        siteSub.set(key, String(s.subChannel ?? "").trim().toUpperCase());
      }
    }

    for (const r of d.rows) {
      const site = String(r["Site"] ?? "").trim().toLowerCase();
      const owner = (site && siteOwner.get(site)) || origin.get(r);
      if (!owner || !wanted.has(owner)) { droppedOtherChannel++; continue; }
      // A store the store master cannot place in a sub-channel cannot be shown
      // to be liquor or main, so a narrowed report leaves it out — counted.
      const subs = subsByMain.get(owner);
      if (subs && !subs.has(siteSub.get(site) ?? "")) { droppedSubChannel++; continue; }
      out.push(r);
    }
  }

  return {
    rows: out,
    supersededRows,
    supersededStale,
    droppedOtherChannel,
    droppedSubChannel,
    // A narrowed channel says so, or a liquor run and a main run carry the same
    // label and filename (and overwrite each other in SharePoint).
    channelNames: selectedMains.map((id) => {
      const name = byId.get(id)?.name ?? id;
      const subs = subsByMain.get(id);
      return subs ? `${name} (${[...subs].sort().join(", ")})` : name;
    }),
  };
}
