/**
 * "Your changes: before and after" on the finish page. Fix lane check
 * (Valjean defect 2): a cut says "You chose to leave this line out" only when
 * the person cut that line on this page (lib/finish-gate.ts changeListEntry).
 * Its own component so a render test reads exactly what the person sees.
 */

import React from "react";
import { changeListEntry, type DefendAnswer } from "@/lib/finish-gate";

export function ApprovedChanges({
  answers,
  cutHere,
  changeNotes,
}: {
  answers: DefendAnswer[];
  /** Lines cut on this page in this visit; null on the Forge finish, where every cut is the person's tap. */
  cutHere: ReadonlySet<string> | null;
  changeNotes: Record<string, string>;
}) {
  const shown = answers.filter((a) => a.replaced || a.verdict === "cut");
  if (!shown.length) return null;
  return (
    <details open className="mt-3 border border-t-line bg-t-panel px-4 py-3" data-testid="approved-changes">
      <summary className="t-focus cursor-pointer text-sm font-semibold text-t-white">Your changes: before and after</summary>
      <ul className="mt-3 space-y-4 text-sm text-t-phos">
        {shown.map((a, i) => {
          const entry = changeListEntry(a, cutHere);
          const why = changeNotes[a.line] || (a.replaced ? changeNotes[a.replaced] : "");
          return (
            <li key={`${a.line}-${i}`}>
              <p className="text-xs text-t-phos-dim">Before</p>
              <p>{a.replaced || a.line}</p>
              <p className="mt-2 text-xs text-t-phos-dim">After</p>
              <p className="text-t-white">{entry.after}</p>
              {why && <p className="mt-2 text-xs"><strong>What this addresses:</strong> {why}</p>}
              <p className="mt-2 text-xs" data-testid="change-note">{entry.note}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
