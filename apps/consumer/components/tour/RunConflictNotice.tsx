"use client";
/** The one notice a tour shows after it stopped because its run is open somewhere else (lib/tour/run-conflict.ts). */
import { RUN_CONFLICT_COPY } from '@/lib/tour/run-conflict';

export function RunConflictNotice({ onDismiss }: { onDismiss: () => void }) {
  return <div className="et-notice" role="status" data-tour-conflict="">
    <p>{RUN_CONFLICT_COPY.notice}</p>
    <button type="button" onClick={() => window.location.reload()}>{RUN_CONFLICT_COPY.reload}</button>
    <button type="button" onClick={onDismiss}>{RUN_CONFLICT_COPY.dismiss}</button>
  </div>;
}
