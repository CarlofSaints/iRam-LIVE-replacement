"use client";

/* A table whose columns sort (click a header, click again to reverse) and
   resize (drag a header's right edge; double-click it to reset). Widths are
   remembered per table in this browser.

   Sorting uses lib/useTableTools, so blanks sort last and numbers sort as
   numbers exactly as in every other grid. Each cell is still rendered by the
   caller, so buttons, pills and links inside cells keep working; `afterRow`
   covers a row that opens beneath another (the Site Code Check's Link picker). */

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useTableTools, type SortDir, type SortValue } from "@/lib/useTableTools";
import { SortArrow } from "@/components/TableTools";

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** How to read the value this column sorts on. Omit for a column that does not sort. */
  sort?: (row: T) => SortValue;
  /** Starting width in px, before anyone drags it. */
  width?: number;
  align?: "left" | "center" | "right";
  /** Extra classes on this column's cells. */
  className?: string;
}

const MIN_WIDTH = 40;
const storageKey = (id: string) => `datatable-widths:${id}`;

export default function DataTable<T>({
  id,
  columns,
  rows,
  rowKey,
  initialSort,
  initialDir,
  afterRow,
  footer,
  empty,
  maxHeightClass = "max-h-96",
  className = "text-xs",
  headClassName = "bg-zinc-50 text-[var(--color-text-muted)]",
  wrapperClassName = "border-[var(--color-border)] bg-white",
  rowClassName,
}: {
  /** Unique per table on the site — the remembered widths are stored under it. */
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  initialSort?: string;
  initialDir?: SortDir;
  afterRow?: (row: T, index: number) => ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  maxHeightClass?: string;
  className?: string;
  headClassName?: string;
  wrapperClassName?: string;
  rowClassName?: (row: T) => string;
}) {
  const accessors: Record<string, (row: T) => SortValue> = {};
  for (const c of columns) if (c.sort) accessors[c.key] = c.sort;
  const tools = useTableTools<T>(rows, accessors, initialSort, undefined, initialDir);

  const [widths, setWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(id));
      if (saved) setWidths(JSON.parse(saved));
    } catch { /* no storage: default widths */ }
  }, [id]);
  const save = (next: Record<string, number>) => {
    try { localStorage.setItem(storageKey(id), JSON.stringify(next)); } catch { /* ignore */ }
  };

  const thRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const widthOf = (c: Column<T>) => widths[c.key] ?? c.width ?? 150;

  function startResize(e: React.PointerEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    // Snapshot every column's REAL width first. The table stretches to fill
    // its box, so rendered widths differ from the stored ones, and dragging
    // from a stored width would make the column jump under the cursor.
    const snapshot: Record<string, number> = {};
    columns.forEach((c, i) => { snapshot[c.key] = thRefs.current[i]?.offsetWidth ?? widthOf(c); });
    const startX = e.clientX;
    const startW = snapshot[key];
    let latest = { ...snapshot };
    setWidths(latest);

    const move = (ev: PointerEvent) => {
      latest = { ...latest, [key]: Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX)) };
      setWidths(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      save(latest);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resetWidth(key: string) {
    setWidths((w) => {
      const next = { ...w };
      delete next[key];
      save(next);
      return next;
    });
  }

  const alignCls = (a?: Column<T>["align"]) =>
    a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";
  const total = columns.reduce((sum, c) => sum + widthOf(c), 0);

  return (
    <div className={`overflow-auto rounded-lg border ${wrapperClassName} ${maxHeightClass}`}>
      <table className={className} style={{ tableLayout: "fixed", width: total, minWidth: "100%" }}>
        <colgroup>
          {columns.map((c) => <col key={c.key} style={{ width: widthOf(c) }} />)}
        </colgroup>
        <thead className={`sticky top-0 z-10 shadow-sm ${headClassName}`}>
          <tr>
            {columns.map((c, i) => {
              const active = tools.sortKey === c.key;
              return (
                <th
                  key={c.key}
                  ref={(el) => { thRefs.current[i] = el; }}
                  aria-sort={active ? (tools.sortDir === "asc" ? "ascending" : "descending") : undefined}
                  className={`relative select-none px-3 py-2 font-semibold ${alignCls(c.align)}`}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => tools.toggleSort(c.key)}
                      title="Sort"
                      className={`group inline-flex max-w-full items-center gap-0.5 hover:text-[var(--color-text)] ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      <span className="truncate">{c.label}</span>
                      <SortArrow active={active} dir={tools.sortDir} />
                    </button>
                  ) : (
                    c.label
                  )}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    title="Drag to resize · double-click to reset"
                    onPointerDown={(e) => startResize(e, c.key)}
                    onDoubleClick={() => resetWidth(c.key)}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-transparent hover:border-[var(--color-primary)]"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {tools.rows.length === 0 && empty != null ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-[var(--color-text-muted)]">{empty}</td>
            </tr>
          ) : (
            tools.rows.map((row, i) => (
              <Fragment key={rowKey(row, i)}>
                <tr className={`border-t border-zinc-100 align-top ${rowClassName ? rowClassName(row) : ""}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={`break-words px-3 py-2 ${alignCls(c.align)} ${c.className ?? ""}`}>
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
                {afterRow?.(row, i)}
              </Fragment>
            ))
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
