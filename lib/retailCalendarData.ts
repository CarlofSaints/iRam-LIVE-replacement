/* Retail calendar years loaded from Massmart planning-calendar PDFs.
   See lib/retailCalendar.ts for how they are used. One small JSON blob; only
   an admin writes it, about once a year, so no index or lock is needed. */

import { readJson, readJsonStrict, writeJson } from "./blob";
import { registerRetailCalendar, type RetailCalendarYears } from "./retailCalendar";

const KEY = "config/retail-calendar.json";

export interface RetailCalendarYear {
  year: number;
  weeks: number[];          // Jan..Dec
  monthEndWeeks?: number[]; // as read from the PDF
  fileName: string;
  loadedAt: string;
  loadedBy: string;
}

type Store = Record<string, RetailCalendarYear>;

export async function getRetailCalendarYears(): Promise<RetailCalendarYear[]> {
  const store = await readJson<Store>(KEY, {});
  return Object.values(store).sort((a, b) => a.year - b.year);
}

export function toWeeksMap(years: RetailCalendarYear[]): RetailCalendarYears {
  const out: RetailCalendarYears = {};
  for (const y of years) out[y.year] = y.weeks;
  return out;
}

/* Call before anything server-side that asks lib/retailCalendar about weeks.
   Fails OPEN to the built-in 2026 + pattern: a blob blip must not stop a DISPO
   load, and the pattern is what the app used before this existed. */
export async function ensureRetailCalendar(): Promise<void> {
  try {
    registerRetailCalendar(toWeeksMap(await getRetailCalendarYears()));
  } catch {
    /* keep whatever was registered last */
  }
}

export async function saveRetailCalendarYear(entry: RetailCalendarYear): Promise<void> {
  // Strict: a failed read must not save one year over every other year.
  const store = await readJsonStrict<Store>(KEY, {});
  store[String(entry.year)] = entry;
  await writeJson(KEY, store);
}

export async function deleteRetailCalendarYear(year: number): Promise<boolean> {
  const store = await readJsonStrict<Store>(KEY, {});
  if (!store[String(year)]) return false;
  delete store[String(year)];
  await writeJson(KEY, store);
  return true;
}
