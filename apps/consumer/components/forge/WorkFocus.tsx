"use client";
import { containDialogTab } from "./dialog-keyboard";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep one mounted animation while switching between focused and inline views. */
export function WorkFocus({ active, title, children }: { active: boolean; title: string; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focused = active && !dismissed;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.close();
    if (focused) {
      document.body.style.overflow = "hidden";
      dialog.showModal();
    } else dialog.show();
    return () => {
      dialog.close();
      if (focused) {
        document.body.style.overflow = overflow;
        previous?.focus({ preventScroll: true });
      }
    };
  }, [focused]);
  return <dialog onKeyDown={focused ? containDialogTab : undefined} ref={dialogRef} open aria-label={focused ? title : undefined} role={focused ? "dialog" : "presentation"}
    onCancel={(event) => { event.preventDefault(); setDismissed(true); }}
    className={focused ? "fixed inset-0 m-auto max-h-[94dvh] w-[min(96vw,1100px)] max-w-none overflow-y-auto overscroll-contain border border-t-amber bg-t-bg p-5 text-t-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm" : "contents"}>
    {focused && <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-4 border-b border-t-line bg-t-bg pb-3">
      <h2 className="font-semibold">{title}</h2>
      <button type="button" onClick={() => setDismissed(true)} className="t-focus min-h-touch px-3 text-sm underline underline-offset-4">View without focus</button>
    </div>}
    <div>{children}</div>
  </dialog>;
}
