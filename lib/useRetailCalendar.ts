"use client";

import { useEffect, useState } from "react";
import { authFetch } from "./useAuth";
import { registerRetailCalendar, type RetailCalendarYears } from "./retailCalendar";

/* Loads the admin-loaded calendar years into lib/retailCalendar for this tab.
   Until it arrives the pickers use the built-in 2026 + 4-5-4 pattern, which is
   right for every year that hasn't been loaded anyway. Returns true once
   loaded, so a component re-renders with the real week counts. */

let pending: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  pending ??= authFetch("/api/retail-calendar")
    .then((r) => (r.ok ? r.json() : { years: [] }))
    .then((d: { years?: { year: number; weeks: number[] }[] }) => {
      const map: RetailCalendarYears = {};
      for (const y of d.years ?? []) map[y.year] = y.weeks;
      registerRetailCalendar(map);
    })
    .catch(() => {
      pending = null; // try again next mount
    });
  return pending;
}

/** Call after saving or deleting a year so the next loadOnce refetches. */
export function invalidateRetailCalendar(): void {
  pending = null;
}

export function useRetailCalendar(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadOnce().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}
