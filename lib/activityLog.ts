import type { LogEntry } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const LOG_KEY = "activity-log.json";
const MAX_ENTRIES = 500;

export async function addLog(
  entry: Omit<LogEntry, "id" | "timestamp">
): Promise<void> {
  try {
    const logs = await readJson<LogEntry[]>(LOG_KEY, []);
    logs.unshift({
      ...entry,
      id: uuid(),
      timestamp: new Date().toISOString(),
    });
    if (logs.length > MAX_ENTRIES) logs.length = MAX_ENTRIES;
    await writeJson(LOG_KEY, logs);
  } catch {
    // Never throw on log failure
  }
}

export async function getLogs(): Promise<LogEntry[]> {
  return readJson<LogEntry[]>(LOG_KEY, []);
}
