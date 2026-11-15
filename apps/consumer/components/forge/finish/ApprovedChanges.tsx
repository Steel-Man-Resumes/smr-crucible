/**
 * "Your changes: before and after" on the finish page. Fix lane check
 * (Valjean defect 2): a cut says "You chose to leave this line out" only when
 * the person cut that line on this page (lib/finish-gate.ts changeListEntry).
 * Its own component so a render test reads exactly what the person sees.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { changeListEntry, type DefendAnswer } from "@/lib/finish-gate";
import { useServerText } from "@/components/ServerTextProvider";

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
  const t = useTranslations("forgeFinish.approved");
  const ts = useServerText();
  const shown = answers.filter((a) => a.replaced || a.verdict === "cut");
  if (!shown.length) return null;
  return (
    <details open className="mt-3 border border-t-line bg-t-panel px-4 py-3" data-testid="approved-changes">
      <summary className="t-focus cursor-pointer text-sm font-semibold text-t-white">{t("summary")}</summary>
      <ul className="mt-3 space-y-4 text-sm text-t-phos">
        {shown.map((a, i) => {
          const entry = changeListEntry(a, cutHere);
          const why = changeNotes[a.line] || (a.replaced ? changeNotes[a.replaced] : "");
          return (
            <li key={`${a.line}-${i}`}>
              <p className="text-xs text-t-phos-dim">{t("before")}</p>
              <p>{a.replaced || a.line}</p>
              <p className="mt-2 text-xs text-t-phos-dim">{t("after")}</p>
              <p className="text-t-white">{a.verdict === "cut" ? ts(entry.after) : entry.after}</p>
              {why && <p className="mt-2 text-xs"><strong>{t("addresses")}</strong> {ts(why)}</p>}
              <p className="mt-2 text-xs" data-testid="change-note">{ts(entry.note)}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
