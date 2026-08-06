"use client";

import { useMemo, useState } from "react";
import { useDismissable } from "@/lib/useDismissable";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Tick-many dropdown with a type-to-filter box. Shared by the Charts
 * dimension filters and the Month-End "Sheets to include" picker, which used
 * to be a native <details> that could only be closed by clicking its own
 * summary again.
 *
 * A multi-select deliberately stays open while you tick — closing on each
 * choice would make selecting five things take five re-opens. So it needs an
 * obvious way OUT: click anywhere else, press Escape, tab away, or press
 * Done. See lib/useDismissable.ts.
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  widthClass = "w-72",
  searchable = true,
  summary,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  widthClass?: string;
  searchable?: boolean;
  /** Override the button text (e.g. "3 of 16 sheets"). */
  summary?: string;
}) {
  const { open, setOpen, close, containerRef, triggerRef, onBlurCapture } = useDismissable();
  const [q, setQ] = useState("");

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label)),
    [options],
  );
  const filtered = q
    ? sorted.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : sorted;

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="relative" ref={containerRef} onBlurCapture={onBlurCapture}>
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${
          selected.length
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 font-medium"
            : "border-[var(--color-border)] bg-white"
        }`}
      >
        {summary ?? `${label}${selected.length ? ` · ${selected.length}` : ""}`}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-20 mt-1 ${widthClass} rounded-lg border border-[var(--color-border)] bg-white p-2 shadow-lg`}
        >
          {searchable && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="mb-2 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm"
            />
          )}

          <div className="mb-1 flex justify-between px-1 text-xs">
            <button
              type="button"
              onClick={() => onChange(Array.from(new Set([...selected, ...filtered.map((o) => o.value)])))}
              className="text-[var(--color-primary)] hover:underline"
            >
              {q ? "Select shown" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[var(--color-text-muted)] hover:underline"
            >
              Clear
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-1 py-2 text-xs text-[var(--color-text-muted)]">No matches</div>
            )}
            {filtered.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[var(--color-bg-subtle,#f5f5f5)]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="truncate" title={o.label}>{o.label}</span>
              </label>
            ))}
          </div>

          {/* The visible way out. Clicking elsewhere and Escape both work,
              but neither is discoverable, and this dropdown does not close
              on selection the way a single-select does. */}
          <div className="mt-2 flex justify-end border-t border-[var(--color-border)] pt-2">
            <button
              type="button"
              onClick={() => close(true)}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--color-primary-dark)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
