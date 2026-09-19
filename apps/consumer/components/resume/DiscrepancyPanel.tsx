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
import { BulletWorkshop } from "./BulletWorkshop";
import { replaceResumeLine } from "@/lib/ats/apply-fix";

const KIND_HEADINGS: Record<string, string> = {
  unsupported_claim: "Things you did not tell us",
  open_end_date: "Dates",
  employment_gap: "Dates",
  aging_credential: "Certifications",
  vague_bullet: "Lines that could say more",
  first_person: "Wording",
  unquantified_role: "Lines that could say more",
};

/** Findings the bullet workshop can actually act on: a weak line to rewrite. */
const WORKSHOPPABLE = new Set(["vague_bullet", "first_person", "unquantified_role"]);

export function DiscrepancyPanel({
  resumeText,
  sourceText,
  readinessStage,
  onApply,
}: {
  /** The resume as the person will send it. */
  resumeText: string;
  /** Their original intake, when available. Dangling dates and real gaps live here. */
  sourceText?: string;
  /** From intake, so the workshop's framing matches where the person said they are. */
  readinessStage?: string;
  /** Omit to render read-only, with no route into the workshop. */
  onApply?: (nextText: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [workshopFor, setWorkshopFor] = useState<Discrepancy | null>(null);

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
          Our checks did not find anything to flag.
        </p>
        <p className="mt-1 text-xs text-t-phos-dim">
          Dates have ends, certifications are not obviously stale, and no line
          matched a pattern we know how to catch. That is not the same as
          &ldquo;everything here is true&rdquo; -- these checks look for specific
          problems, and a resume can be wrong in ways no checker knows to look
          for. Read it once yourself. You are the only one who can.
        </p>
      </div>
    );
  }

  // Generated-but-unsupported wording is a different animal from "we could not
  // know this", and saying "ready to send" over the top of it was the review's
  // fairest hit. Lead with the harder truth when there is one.
  const hasUnsupported = items.some((d) => d.kind === "unsupported_claim");
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
            {items.length} {items.length === 1 ? "thing" : "things"} to settle
            before you send this
          </span>
          <span className="block text-[11px] text-t-phos-dim">
            {hasUnsupported
              ? "Some of this includes wording we generated that your own answers do not support. Check those first -- they are the ones an interview will test."
              : "Nothing was guessed for you. These are the places the tool could not know the answer."}
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
                  {onApply && WORKSHOPPABLE.has(d.kind) && (
                    // Naming a weak line and leaving the person to fix it alone
                    // is only half the job. One tap goes straight into the
                    // questions that turn it into something true and specific.
                    <button
                      onClick={() => setWorkshopFor(d)}
                      className="t-focus mt-1.5 border border-t-amber px-2 py-1 text-[11px] font-bold text-t-amber-bright hover:bg-t-amber/10"
                    >
                      Make this line stronger
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          <p className="mt-4 border-t border-t-line pt-3 text-[11px] text-t-phos-dim">
            None of this was changed for you. These checks read the document,
            not your record -- they cannot know whether a certification is
            current or whether a job is still going, which is why they ask. They
            also only catch problems they were built to look for, so a clean
            result is a smaller promise than it sounds.
          </p>
        </div>
      )}

      {workshopFor && onApply && (
        <BulletWorkshop
          jobTitle=""
          initialBullet={workshopFor.evidence}
          readinessStage={readinessStage}
          onAccept={(bullet) => {
            const next = replaceResumeLine(resumeText, workshopFor.evidence, bullet);
            if (next !== resumeText) onApply(next);
            setWorkshopFor(null);
          }}
          onClose={() => setWorkshopFor(null)}
        />
      )}
    </div>
  );
}
