"use client";
/**
 * The line under an autosaved box (house lane L5): "Draft restored" when the
 * page brought back unsaved words, and a quiet save state. Never says anything
 * when there is nothing to say.
 */
export function DraftStatus({ restoredAt, statusText, onStartOver, onDismiss }: {
  restoredAt: number | null; statusText: string | null; onStartOver?: () => void; onDismiss?: () => void;
}) {
  if (!restoredAt && !statusText) return null;
  const when = restoredAt ? new Date(restoredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="mt-2 space-y-1" aria-live="polite">
      {when && (
        <p role="status" className="border border-t-amber bg-t-panel-2 px-3 py-2 text-xs text-t-amber-bright">
          Draft restored from {when}. It is not saved as a record yet. Only you can see it.
          {onStartOver && <button type="button" onClick={onStartOver} className="t-focus ml-2 underline underline-offset-4">Start over</button>}
          {onDismiss && <button type="button" onClick={onDismiss} className="t-focus ml-2 underline underline-offset-4">OK</button>}
        </p>
      )}
      {statusText && <p className="text-[11px] text-t-phos-dim">{statusText}</p>}
    </div>
  );
}
