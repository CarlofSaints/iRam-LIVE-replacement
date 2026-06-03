import type { Channel } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "channels.json";

const DEFAULT_CHANNELS: Channel[] = [
  { id: "massmart", name: "MASSMART", active: true, createdAt: new Date().toISOString() },
  { id: "makro", name: "MAKRO", parentId: "massmart", active: true, createdAt: new Date().toISOString() },
  { id: "game", name: "GAME", parentId: "massmart", active: true, createdAt: new Date().toISOString() },
  { id: "massbuild", name: "MASSBUILD", parentId: "massmart", active: true, createdAt: new Date().toISOString() },
  { id: "jumbo", name: "JUMBO CASH AND CARRY", parentId: "massmart", active: true, createdAt: new Date().toISOString() },
];

export async function getChannels(): Promise<Channel[]> {
  const channels = await readJson<Channel[]>(KEY, []);
  if (channels.length === 0) {
    await writeJson(KEY, DEFAULT_CHANNELS);
    return DEFAULT_CHANNELS;
  }
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
  updates: Partial<Pick<Channel, "name" | "parentId" | "active">>
): Promise<Channel> {
  const channels = await getChannels();
  const idx = channels.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Channel not found");
  if (updates.name) updates.name = updates.name.trim().toUpperCase();
  channels[idx] = { ...channels[idx], ...updates };
  await writeJson(KEY, channels);
  return channels[idx];
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
