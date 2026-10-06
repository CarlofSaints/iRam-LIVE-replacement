/* Retail calendar years loaded from Massmart planning-calendar PDFs.
   See lib/retailCalendar.ts for how they are used. One small JSON blob; only
   an admin writes it, about once a year, so no index or lock is needed. */

import { readJsonStrict, writeJson } from "./blob";
import { registerRetailCalendar, toWeeksMap } from "./retailCalendar";

const KEY = "config/retail-calendar.json";

export interface RetailCalendarYear {
  year: number;
  weeks: number[];          // Jan..Dec
  monthEndWeeks?: number[]; // running total of weeks, derived on save
  fileName: string;
  loadedAt: string;
  loadedBy: string;
}

type Store = Record<string, RetailCalendarYear>;

/* STRICT: a failed read throws rather than returning "no years", so a Blob
   blip can never present as "nothing loaded" and swap a real calendar for the
   pattern. Absent is still {}. */
async function readStore(skipCache = false): Promise<Store> {
  return readJsonStrict<Store>(KEY, {}, { skipCache });
}

export async function getRetailCalendarYears(): Promise<RetailCalendarYear[]> {
  return Object.values(await readStore()).sort((a, b) => a.year - b.year);
}

/* Call before anything server-side that asks lib/retailCalendar about weeks.
   Memoised for a minute per instance (the portfolio cron calls it per
   channel). On a read failure the last good calendar stays registered; with
   none yet, the built-in 2026 + pattern apply, which is what the app did
   before this existed. A DISPO load is never blocked by it. */
const TTL_MS = 60_000;
let lastLoad = 0;

export async function ensureRetailCalendar(): Promise<void> {
  if (Date.now() - lastLoad < TTL_MS) return;
  try {
    registerRetailCalendar(toWeeksMap(await getRetailCalendarYears()));
    lastLoad = Date.now();
  } catch {
    /* keep whatever was registered last */
  }
}

// The read-modify-writes skip the 30s write cache: another instance may have
// saved a different year since this one last looked.
export async function saveRetailCalendarYear(entry: RetailCalendarYear): Promise<void> {
  const store = await readStore(true);
  store[String(entry.year)] = entry;
  await writeJson(KEY, store);
  lastLoad = 0;
}

export async function deleteRetailCalendarYear(year: number): Promise<boolean> {
  const store = await readStore(true);
  if (!store[String(year)]) return false;
  delete store[String(year)];
  await writeJson(KEY, store);
  lastLoad = 0;
  return true;
}
