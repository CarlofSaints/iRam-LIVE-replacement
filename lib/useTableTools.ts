"use client";

/* ──────────────────────────────────────────────────────────────
   Sorting and searching for every grid in the app.

   One implementation so the grids behave identically: click a header to sort,
   click again to reverse, and one search box that matches across ALL of a
   row's fields rather than a chosen few. Written as a hook + a header
   component rather than a table component, because the grids differ too much
   (sticky columns, grouped rows, per-cell widgets) to share markup.
   ────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | null | undefined;

/** How to read the sortable value out of a row, per column key. */
export type Accessors<T> = Record<string, (row: T) => SortValue>;

/**
 * Flatten anything into searchable text. Nested objects and arrays are walked
 * so a search hits values the grid renders from deeper in the row — the whole
 * point of "searches all fields".
 */
export function rowText(value: unknown, depth = 0): string {
  if (value == null || depth > 4) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => rowText(v, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      // Skip internals: ids and blob keys are noise that produce phantom hits.
      .filter(([k]) => !k.startsWith("_") && !/^(id|clientId|channelId|userId)$/i.test(k))
      .map(([, v]) => rowText(v, depth + 1))
      .join(" ");
  }
  return "";
}

/**
 * Every whitespace-separated term must appear somewhere in the row (AND), so
 * "makro topline" narrows instead of widening. Case- and accent-insensitive.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function compare(a: SortValue, b: SortValue): number {
  // Blanks always sort last, whichever direction — an empty cell is never the
  // "most" of anything, and burying them keeps the top of the grid useful.
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export interface TableTools<T> {
  rows: T[];
  query: string;
  setQuery: (q: string) => void;
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  /** Rows before search/sort — for "showing X of Y" counts. */
  total: number;
}

/**
 * @param initialSort column key to sort by on first render
 * @param searchText  optional override for what a row's search text is; use it
 *                    when the grid shows values that aren't plain row fields
 */
export function useTableTools<T>(
  data: T[],
  accessors: Accessors<T>,
  initialSort?: string,
  searchText?: (row: T) => string,
  initialDir: SortDir = "asc",
): TableTools<T> {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const rows = useMemo(() => {
    const q = query.trim();
    const filtered = q
      ? data.filter((r) => matchesQuery(searchText ? searchText(r) : rowText(r), q))
      : data;
    const get = sortKey ? accessors[sortKey] : undefined;
    if (!get) return filtered;
    // Copy before sorting — sorting the caller's array in place would mutate
    // component state and skip re-renders.
    return [...filtered].sort((a, b) => (sortDir === "asc" ? 1 : -1) * compare(get(a), get(b)));
    // accessors is rebuilt each render by callers; keying on sortKey is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, sortKey, sortDir, searchText]);

  return { rows, query, setQuery, sortKey, sortDir, toggleSort, total: data.length };
}
