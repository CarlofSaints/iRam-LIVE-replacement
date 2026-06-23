import type { StatusScenario } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "status-scenarios.json";

export async function getStatusScenarios(): Promise<StatusScenario[]> {
  return readJson<StatusScenario[]>(KEY, []);
}

export async function createStatusScenario(data: {
  statusCode: string;
  channelId: string;
  conditions: StatusScenario["conditions"];
  classification: "POSITIVE" | "NEGATIVE";
  description?: string;
}): Promise<StatusScenario> {
  const all = await getStatusScenarios();
  const now = new Date().toISOString();
  const scenario: StatusScenario = {
    id: uuid(),
    statusCode: data.statusCode.trim().toUpperCase(),
    channelId: data.channelId,
    conditions: data.conditions,
    classification: data.classification,
    description: data.description,
    createdAt: now,
    updatedAt: now,
  };
  all.push(scenario);
  await writeJson(KEY, all);
  return scenario;
}

export async function updateStatusScenario(
  id: string,
  updates: Partial<Pick<StatusScenario, "statusCode" | "channelId" | "conditions" | "classification" | "description">>
): Promise<StatusScenario> {
  const all = await getStatusScenarios();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Status scenario not found");

  if (updates.statusCode !== undefined) {
    all[idx].statusCode = updates.statusCode.trim().toUpperCase();
  }
  if (updates.channelId !== undefined) {
    all[idx].channelId = updates.channelId;
  }
  if (updates.conditions !== undefined) {
    all[idx].conditions = updates.conditions;
  }
  if (updates.classification !== undefined) {
    all[idx].classification = updates.classification;
  }
  if (updates.description !== undefined) {
    all[idx].description = updates.description;
  }
  all[idx].updatedAt = new Date().toISOString();

  await writeJson(KEY, all);
  return all[idx];
}

export async function deleteStatusScenario(id: string): Promise<void> {
  const all = await getStatusScenarios();
  const filtered = all.filter((s) => s.id !== id);
  await writeJson(KEY, filtered);
}

/**
 * Evaluate scenarios for a given status code and enriched row.
 * Returns "POSITIVE" | "NEGATIVE" if a scenario matches, null if no match.
 * Most specific match wins (more conditions = higher priority).
 */
export function evaluateScenarios(
  statusCode: string,
  row: Record<string, unknown>,
  scenarios: StatusScenario[]
): "POSITIVE" | "NEGATIVE" | null {
  const upper = statusCode.trim().toUpperCase();
  const matching = scenarios.filter((s) => s.statusCode === upper);
  if (matching.length === 0) return null;

  // Score each by specificity (number of active conditions)
  let bestMatch: StatusScenario | null = null;
  let bestScore = -1;

  for (const s of matching) {
    let score = 0;
    let conditionsMet = true;

    if (s.conditions.clientStatus !== undefined) {
      score++;
      const productStatus = String(row["_productStatus"] ?? "").trim().toUpperCase();
      if (productStatus !== s.conditions.clientStatus.toUpperCase()) {
        conditionsMet = false;
      }
    }

    if (s.conditions.rangingStatus !== undefined) {
      score++;
      const ranging = row["_rangingStatus"] === true;
      if (ranging !== s.conditions.rangingStatus) {
        conditionsMet = false;
      }
    }

    if (conditionsMet && score > bestScore) {
      bestScore = score;
      bestMatch = s;
    }
  }

  return bestMatch ? bestMatch.classification : null;
}
