"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ──────────────────────────────────────────────────────────────
   One dismissal behaviour for every dropdown in the app.

   Two things were wrong before, and both read to users as "I made a
   selection and now I can't get out of the dropdown":

   1. The multi-select "Sheets to include" was a native <details>. A
      <details> only closes when you click its own summary again — not on
      Escape, not on a click elsewhere. Tick a box and you are stuck with a
      panel covering the page.

   2. The other dropdowns closed via an invisible full-screen overlay
      (`fixed inset-0`) layered under the panel. That does close them, but it
      SWALLOWS the click that closed it — so moving from one filter to the
      next took two clicks, and the first one appeared to do nothing.

   This closes on a pointer press outside, on Escape, and on focus leaving
   the control — and because it listens on the document rather than covering
   it, the click that dismisses also lands on whatever you aimed at.
   ────────────────────────────────────────────────────────────── */
export function useDismissable<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    // Escape should hand focus back to the button that opened the panel;
    // a click elsewhere should not steal focus from where the user clicked.
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    // Capture phase: a panel that stops propagation internally must not be
    // able to prevent its own dismissal.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  /* Tabbing out of the panel closes it too, so keyboard users are never
     left with an open dropdown they have moved past. relatedTarget is null
     when focus leaves the window entirely — ignore that, or alt-tabbing
     away and back would find the panel closed for no reason. */
  const onBlurCapture = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next) return;
      if (containerRef.current && !containerRef.current.contains(next)) setOpen(false);
    },
    [],
  );

  return { open, setOpen, close, containerRef, triggerRef, onBlurCapture };
}
