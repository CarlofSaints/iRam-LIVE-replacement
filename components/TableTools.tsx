"use client";

/* Shared grid furniture: a sortable column header and a search box.
   Paired with lib/useTableTools.ts — see the note there on why this is a
   header + hook rather than a whole table component. */

import type { SortDir } from "@/lib/useTableTools";

export function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span
      aria-hidden
      className={`ml-1 inline-block text-[10px] leading-none transition-opacity ${
        active ? "opacity-100 text-[var(--color-primary)]" : "opacity-0 group-hover:opacity-40"
      }`}
    >
      {active && dir === "desc" ? "▼" : "▲"}
    </span>
  );
}

/**
 * A clickable column header. `sortKey` is the key this column sorts on; pass
 * the tools' current sortKey/sortDir so the arrow reflects live state.
 */
export function SortableTh({
  label, sortKey, current, dir, onSort, className = "", align = "left", title,
}: {
  label: React.ReactNode;
  sortKey: string;
  current: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "center" | "right";
  title?: string;
}) {
  const active = current === sortKey;
  const alignCls = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
  return (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title ?? `Sort by ${typeof label === "string" ? label : sortKey}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={`group flex w-full items-center ${alignCls} gap-0.5 rounded uppercase tracking-wide hover:text-[var(--color-text)]`}
      >
        <span>{label}</span>
        <SortArrow active={active} dir={dir} />
      </button>
    </th>
  );
}

/**
 * Search box for a grid. `count`/`total` render the "showing X of Y" hint,
 * which is what stops a filtered grid from being mistaken for an empty one.
 */
export function TableSearch({
  value, onChange, count, total, placeholder = "Search all columns…", className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  count?: number;
  total?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        >
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-64 rounded-lg border border-[var(--color-border)] bg-white py-1.5 pl-8 pr-8 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
        />
        {value && (
          <button
            type="button" onClick={() => onChange("")} aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ×
          </button>
        )}
      </div>
      {value && count != null && total != null && (
        <span className="text-xs text-[var(--color-text-muted)]">
          {count} of {total}
        </span>
      )}
    </div>
  );
}
