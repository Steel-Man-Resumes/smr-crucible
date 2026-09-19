"use client";

/**
 * <DiscrepancyPanel> -- "Before you send this, here is what only you can answer."
 *
 * The visible half of the truth gate. The generator's rule is that nothing gets
 * invented, and until now that rule was enforced silently: when the tool met an
 * ambiguity it resolved one quietly and the person never learned there had been
 * a choice. A dangling "2008 -" became "2008 - Present", a 2018 credential
 * shipped as current, and two duty-language bullets went out untouched.
 *
 * So this panel is not a score and not a warning strip. It is a short list of
 * questions the document cannot answer about the person, stated plainly, with
 * the tool's own limits admitted. Nothing here edits the resume.
 *
 * It is also the answer to the hardest question an evaluator asks -- "how do I
 * know it didn't make something up?" -- because the honest answer is not "trust
 * the rule," it is "here is the tool showing you every place it could have."
 */

import { useMemo, useState } from "react";
import {
  findDiscrepancies,
  groupDiscrepancies,
  type Discrepancy,
} from "@/lib/resume-discrepancies";

const KIND_HEADINGS: Record<string, string> = {
  open_end_date: "Dates",
  employment_gap: "Dates",
  aging_credential: "Certifications",
  vague_bullet: "Lines that could say more",
  first_person: "Wording",
  unquantified_role: "Lines that could say more",
};

export function DiscrepancyPanel({
  resumeText,
  sourceText,
}: {
  /** The resume as the person will send it. */
  resumeText: string;
  /** Their original intake, when available. Dangling dates and real gaps live here. */
  sourceText?: string;
}) {
  const [open, setOpen] = useState(true);

  const items = useMemo(
    () => (resumeText.trim() ? findDiscrepancies(resumeText, { sourceText }) : []),
    [resumeText, sourceText]
  );

  if (items.length === 0) {
    // Say it. A silent pass teaches nothing; an explicit pass tells the person
    // the check ran and found nothing, which is the whole point of running it.
    if (!resumeText.trim()) return null;
    return (
      <div className="border border-t-line bg-t-panel px-5 py-4">
        <p className="text-sm font-semibold text-t-white">
          Nothing here needs a second look.
        </p>
        <p className="mt-1 text-xs text-t-phos-dim">
          Every date has an end, every certification looks current, and every
          line describes something you actually did. Read it once more anyway --
          you know your own history better than any tool does.
        </p>
      </div>
    );
  }

  const groups = groupDiscrepancies(items);

  return (
    <div className="border border-t-amber/40 bg-t-panel">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus flex min-h-touch w-full items-center justify-between px-5 py-3 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-bold text-t-amber-bright">
            {items.length} {items.length === 1 ? "thing" : "things"} only you can answer
          </span>
          <span className="block text-[11px] text-t-phos-dim">
            Your resume is ready to send. These were left exactly as you wrote
            them, because guessing would have put words in your mouth.
          </span>
        </span>
        <span aria-hidden="true" className="ml-3 text-[10px] text-t-phos-dim">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="border-t border-t-line px-5 py-4">
          {groups.map((g) => (
            <div key={g.kind} className="mb-4 last:mb-0">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-t-phos-dim">
                {KIND_HEADINGS[g.kind] ?? "Worth a look"}
              </p>
              {g.items.map((d: Discrepancy, i: number) => (
                <div key={i} className="mb-3 border-l-2 border-t-line pl-3 last:mb-0">
                  <p className="text-xs italic text-t-phos-dim">
                    &ldquo;{d.evidence}&rdquo;
                  </p>
                  <p className="mt-1 text-sm text-t-phos">{d.question}</p>
                </div>
              ))}
            </div>
          ))}
          <p className="mt-4 border-t border-t-line pt-3 text-[11px] text-t-phos-dim">
            None of this was changed for you. This check reads the document, not
            your record -- it cannot know whether a certification is current or
            whether a job is still going, which is exactly why it is asking.
          </p>
        </div>
      )}
    </div>
  );
}
