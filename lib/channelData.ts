import type { Channel } from "./types";
import { readJson, writeJson, deleteBlob } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "channels.json";
const SEEDED_KEY = "channels-seeded.json";
const MIGRATION_KEY = "channels-migrated-v2.json";

const DEFAULT_CHANNELS: Channel[] = [
  { id: "makro", name: "MAKRO", active: true, createdAt: new Date().toISOString() },
  { id: "game", name: "GAME", active: true, createdAt: new Date().toISOString() },
  { id: "massbuild", name: "MASSBUILD", active: true, createdAt: new Date().toISOString() },
];

/** Names that should be main channels (no parentId) */
const MAIN_CHANNEL_NAMES = new Set(["MAKRO", "GAME", "MASSBUILD"]);

/**
 * One-time migration: fix the channel hierarchy.
 * Old defaults had MASSMART as the sole main channel with MAKRO/GAME/MASSBUILD
 * as sub-channels. This promotes MAKRO/GAME/MASSBUILD to main channels,
 * re-parents any remaining MASSMART sub-channels under MAKRO, and removes MASSMART.
 */
async function migrateChannelHierarchy(channels: Channel[]): Promise<Channel[]> {
  const migrated = await readJson<{ done: boolean }>(MIGRATION_KEY, { done: false });
  if (migrated.done) return channels;

  const massmart = channels.find(
    (c) => !c.parentId && c.name.toUpperCase() === "MASSMART"
  );

  if (!massmart) {
    // No MASSMART parent — nothing to migrate
    await writeJson(MIGRATION_KEY, { done: true });
    return channels;
  }

  // Promote MAKRO, GAME, MASSBUILD to main channels
  let updated = channels.map((c) => {
    if (c.parentId === massmart.id && MAIN_CHANNEL_NAMES.has(c.name.toUpperCase())) {
      // Remove parentId to make it a main channel
      const { parentId: _removed, ...rest } = c;
      return rest as Channel;
    }
    return c;
  });

  // Re-parent any remaining MASSMART sub-channels under MAKRO
  const makro = updated.find(
    (c) => !c.parentId && c.name.toUpperCase() === "MAKRO"
  );
  if (makro) {
    updated = updated.map((c) => {
      if (c.parentId === massmart.id) {
        return { ...c, parentId: makro.id };
      }
      return c;
    });
  }

  // Remove MASSMART
  updated = updated.filter((c) => c.id !== massmart.id);

  await writeJson(KEY, updated);
  await writeJson(MIGRATION_KEY, { done: true });
  return updated;
}

export async function getChannels(): Promise<Channel[]> {
  let channels = await readJson<Channel[]>(KEY, []);
  if (channels.length === 0) {
    // Only seed defaults once — check the flag to avoid overwriting user data on transient read failures
    const seeded = await readJson<{ done: boolean }>(SEEDED_KEY, { done: false });
    if (!seeded.done) {
      await writeJson(KEY, DEFAULT_CHANNELS);
      await writeJson(SEEDED_KEY, { done: true });
      return DEFAULT_CHANNELS;
    }
  }
  channels = await migrateChannelHierarchy(channels);
  return channels;
}

export async function getChannelById(id: string): Promise<Channel | null> {
  const channels = await getChannels();
  return channels.find((c) => c.id === id) ?? null;
}

export function getMainChannels(channels: Channel[]): Channel[] {
  return channels.filter((c) => !c.parentId);
}

export function getSubChannels(channels: Channel[], parentId?: string): Channel[] {
  if (parentId) return channels.filter((c) => c.parentId === parentId);
  return channels.filter((c) => !!c.parentId);
}

export async function createChannel(data: {
  name: string;
  parentId?: string;
}): Promise<Channel> {
  const channels = await getChannels();
  const channel: Channel = {
    id: uuid(),
    name: data.name.trim().toUpperCase(),
    parentId: data.parentId,
    active: true,
    createdAt: new Date().toISOString(),
  };
  channels.push(channel);
  await writeJson(KEY, channels);
  return channel;
}

export async function updateChannel(
  id: string,
  updates: Record<string, unknown>
): Promise<Channel> {
  const channels = await getChannels();
  const idx = channels.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Channel not found");
  if (typeof updates.name === "string") {
    channels[idx].name = updates.name.trim().toUpperCase();
  }
  if (typeof updates.active === "boolean") {
    channels[idx].active = updates.active;
  }
  // parentId: null or "" = convert to main channel, string = set parent
  if ("parentId" in updates) {
    if (!updates.parentId) {
      delete channels[idx].parentId;
    } else {
      channels[idx].parentId = updates.parentId as string;
    }
  }
  await writeJson(KEY, channels);
  return channels[idx];
}

/**
 * Ensure sub-channels exist under a main channel.
 * Creates any that are missing (case-insensitive match).
 * Returns all sub-channels (existing + newly created).
 */
export async function ensureSubChannels(
  mainChannelId: string,
  subChannelNames: string[]
): Promise<Channel[]> {
  const channels = await getChannels();
  const existing = channels.filter(
    (c) => c.parentId === mainChannelId
  );

  const result: Channel[] = [...existing];

  for (const name of subChannelNames) {
    const upper = name.trim().toUpperCase();
    if (!upper) continue;
    const found = existing.find((c) => c.name.toUpperCase() === upper);
    if (!found) {
      const created = await createChannel({ name, parentId: mainChannelId });
      result.push(created);
    }
  }

  return result;
}

export async function deleteChannel(id: string): Promise<void> {
  const channels = await getChannels();
  // Check for sub-channels
  const subs = channels.filter((c) => c.parentId === id);
  if (subs.length > 0) {
    throw new Error(
      `Cannot delete — ${subs.length} sub-channel(s) depend on this channel`
    );
  }
  const filtered = channels.filter((c) => c.id !== id);
  await writeJson(KEY, filtered);
}

/**
 * Wipe all channel data and flags.
 * Next call to getChannels() will re-seed the defaults (MAKRO, GAME, MASSBUILD).
 */
export async function resetAllChannels(): Promise<void> {
  await deleteBlob(KEY);
  await deleteBlob(SEEDED_KEY);
  await deleteBlob(MIGRATION_KEY);
}
