"use client";

import { useEffect, useState } from "react";
import { authFetch } from "./useAuth";
import { registerRetailCalendar, toWeeksMap } from "./retailCalendar";
import type { RetailCalendarYear } from "./retailCalendarData";

/* Loads the admin-loaded calendar years into lib/retailCalendar for this tab.
   Until it arrives the pickers use the built-in 2026 + 4-5-4 pattern, which is
   right for every year that hasn't been loaded anyway. A failed or non-OK
   response (expired session, 500) registers NOTHING and is retried on the next
   mount, so it can never pin "no years loaded" for the life of the tab. */

let pending: Promise<RetailCalendarYear[]> | null = null;

export function loadRetailCalendar(): Promise<RetailCalendarYear[]> {
  pending ??= authFetch("/api/retail-calendar")
    .then(async (r) => {
      if (!r.ok) throw new Error(`Retail calendar: HTTP ${r.status}`);
      const d: { years?: RetailCalendarYear[] } = await r.json();
      const years = d.years ?? [];
      registerRetailCalendar(toWeeksMap(years));
      return years;
    })
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

/** Call after saving or deleting a year so the next load refetches. */
export function invalidateRetailCalendar(): void {
  pending = null;
}

/** True once the loaded years are registered; use it as a memo dependency. */
export function useRetailCalendar(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadRetailCalendar().then(() => { if (live) setReady(true); }, () => {});
    return () => { live = false; };
  }, []);
  return ready;
}
