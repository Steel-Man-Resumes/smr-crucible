"use client";
import { containDialogTab } from "./dialog-keyboard";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native modal focus containment, Escape, and return focus. Never changes the run. */
export function FocusDialog({ open, title, onClose, children, closeLabel = "Back to my work" }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog onKeyDown={containDialogTab} ref={ref} aria-label={title} onCancel={(event) => { event.preventDefault(); close.current(); }}
      className="fixed inset-0 m-auto max-h-[94dvh] w-[min(96vw,1100px)] max-w-none overflow-y-auto overscroll-contain border border-t-amber bg-t-bg p-0 text-t-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-t-line bg-t-bg px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" onClick={() => close.current()} className="t-focus min-h-touch shrink-0 px-3 text-sm underline underline-offset-4">{closeLabel}</button>
      </div>
      <div className="p-5 sm:p-7">{children}</div>
    </dialog>, document.body,
  );
}
