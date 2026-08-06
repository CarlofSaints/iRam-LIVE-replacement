"use client";

import { useMemo, useState } from "react";
import { useDismissable } from "@/lib/useDismissable";

export interface SearchSelectOption {
  value: string;
  label: string;
}

/**
 * Single-select dropdown with a type-to-filter search box. Options are always
 * presented in alphabetical order (by label) regardless of input order. An
 * empty value ("") represents the "all"/reset choice shown at the top.
 */
export default function SearchSelect({
  value,
  options,
  onChange,
  allLabel = "All",
  searchLabel = "options",
  widthClass = "w-64",
  disabled = false,
}: {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  allLabel?: string;
  searchLabel?: string;
  widthClass?: string;
  disabled?: boolean;
}) {
  const { open, setOpen, containerRef, triggerRef, onBlurCapture } = useDismissable();
  const [q, setQ] = useState("");

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.label.localeCompare(b.label)),
    [options],
  );
  const filtered = q
    ? sorted.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : sorted;

  const selectedLabel =
    value ? options.find((o) => o.value === value)?.label ?? value : allLabel;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ("");
  }

  return (
    <div className="relative" ref={containerRef} onBlurCapture={onBlurCapture}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex ${widthClass} items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${
          value
            ? "border-[var(--color-primary,#1f5fa8)] bg-[var(--color-primary,#1f5fa8)]/5 font-medium text-[var(--color-text)]"
            : "border-[var(--color-border)] bg-white text-[var(--color-text)]"
        }`}
      >
        <span className="truncate" title={selectedLabel}>
          {selectedLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          {/* No full-screen overlay — see lib/useDismissable.ts. It used to
              swallow the click that dismissed it, so moving to the next
              filter took two clicks. */}
          <div className={`absolute z-20 mt-1 ${widthClass} rounded-lg border border-[var(--color-border)] bg-white p-2 shadow-lg`}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${searchLabel}…`}
              className="mb-2 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm"
            />
            <div className="max-h-60 overflow-y-auto">
              <button
                type="button"
                onClick={() => pick("")}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-bg-subtle,#f5f5f5)] ${
                  value === "" ? "font-medium text-[var(--color-primary,#1f5fa8)]" : "text-[var(--color-text-muted)]"
                }`}
              >
                {allLabel}
              </button>
              {filtered.length === 0 && (
                <div className="px-2 py-2 text-xs text-[var(--color-text-muted)]">No matches</div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-bg-subtle,#f5f5f5)] ${
                    o.value === value ? "font-medium text-[var(--color-primary,#1f5fa8)]" : "text-[var(--color-text)]"
                  }`}
                  title={o.label}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
