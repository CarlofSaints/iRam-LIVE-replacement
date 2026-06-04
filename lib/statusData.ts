import type { StatusDefinition, StatusClassification } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "status-definitions.json";

export function normalizeStatusCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function getStatusDefinitions(): Promise<StatusDefinition[]> {
  return readJson<StatusDefinition[]>(KEY, []);
}

export async function getStatusesByChannel(
  channelId: string
): Promise<StatusDefinition[]> {
  const all = await getStatusDefinitions();
  return all.filter((s) => s.channelId === channelId);
}

/**
 * Upsert a status definition. Deduplicates on (normalizedCode, channelId).
 * When auto-detected, only creates new entries — never overwrites admin edits.
 * Returns { definition, isNew }.
 */
export async function upsertStatus(data: {
  code: string;
  channelId: string;
  classification?: StatusClassification;
  description?: string;
  notes?: string;
  autoDetected?: boolean;
}): Promise<{ definition: StatusDefinition; isNew: boolean }> {
  const all = await getStatusDefinitions();
  const normalized = normalizeStatusCode(data.code);
  const existing = all.find(
    (s) => s.code === normalized && s.channelId === data.channelId
  );

  if (existing) {
    // If auto-detected, don't overwrite anything — just return existing
    if (data.autoDetected) {
      return { definition: existing, isNew: false };
    }
    // Manual upsert — only overwrite fields that were explicitly passed
    if (data.classification !== undefined)
      existing.classification = data.classification;
    if (data.description !== undefined) existing.description = data.description;
    if (data.notes !== undefined) existing.notes = data.notes;
    existing.updatedAt = new Date().toISOString();
    await writeJson(KEY, all);
    return { definition: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const definition: StatusDefinition = {
    id: uuid(),
    code: normalized,
    channelId: data.channelId,
    classification: data.classification ?? "UNCLASSIFIED",
    description: data.description ?? "",
    notes: data.notes,
    autoDetected: data.autoDetected ?? false,
    createdAt: now,
    updatedAt: now,
  };

  all.push(definition);
  await writeJson(KEY, all);
  return { definition, isNew: true };
}

export async function updateStatusDefinition(
  id: string,
  updates: Partial<
    Pick<StatusDefinition, "classification" | "description" | "notes" | "code">
  >
): Promise<StatusDefinition> {
  const all = await getStatusDefinitions();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Status definition not found");

  if (updates.code !== undefined) {
    all[idx].code = normalizeStatusCode(updates.code);
  }
  if (updates.classification !== undefined) {
    all[idx].classification = updates.classification;
  }
  if (updates.description !== undefined) {
    all[idx].description = updates.description;
  }
  if (updates.notes !== undefined) {
    all[idx].notes = updates.notes;
  }
  all[idx].updatedAt = new Date().toISOString();

  await writeJson(KEY, all);
  return all[idx];
}

export async function deleteStatusDefinition(id: string): Promise<void> {
  const all = await getStatusDefinitions();
  const filtered = all.filter((s) => s.id !== id);
  await writeJson(KEY, filtered);
}
