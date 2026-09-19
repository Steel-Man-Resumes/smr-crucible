"use client";

/**
 * <AtsScorePanel> -- the ATS scorecard, with the lesson underneath.
 *
 * OUR STATED POSITION, on screen, not buried in a doc: there is no such thing
 * as "your ATS score." Every applicant tracking system parses differently, so
 * a single number claiming to be THE score is invented. We think the whole
 * business of grading a person's history out of 100 is nonsense. It is also the
 * game the world plays, so we show the person the board and how to win it.
 *
 * CHART DESIGN NOTES (deliberate, not defaults):
 *  - Form: horizontal bars. The data's job is magnitude across five named
 *    categories on one 0-100 scale, and the labels are long. Not a radar --
 *    radar distorts magnitude by area and by axis order.
 *  - Colour: ONE hue. The bar's job is magnitude, and length already carries
 *    it; identity is carried by the row label. Colouring each bar by its band
 *    would double-encode length as hue and burn the only free channel. Three
 *    status hues from the theme were tried and the palette validator failed
 *    them on adjacent-pair separation, which confirmed the single-hue choice
 *    rather than working around it.
 *  - The verdict word and the number wear TEXT tokens, never the bar colour,
 *    so the reading never depends on colour alone.
 *  - Single series, so no legend. The heading names it.
 *  - Every row is expandable; that is the interaction layer, and it works on
 *    touch where a hover tooltip does not.
 */

import { useMemo, useState } from "react";
import { scoreResume, type LensScore, type LensFix } from "@/lib/ats/lenses";
import { applyFix } from "@/lib/ats/apply-fix";

function verdict(score: number): string {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Solid";
  if (score >= 50) return "Needs work";
  return "Weak";
}

function Bar({ score }: { score: number }) {
  return (
    <div
      className="relative h-2 flex-1 overflow-hidden rounded-sm"
      style={{ background: "var(--t-panel-3)" }}
      role="presentation"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-r-sm"
        style={{ width: `${score}%`, background: "var(--t-amber)" }}
      />
    </div>
  );
}

export function AtsScorePanel({
  resumeText,
  sourceText,
  onApply,
}: {
  resumeText: string;
  /** The person's intake, so the scorer can flag details the resume dropped. */
  sourceText?: string;
  /** Omit to render read-only, with no one-click fixes. */
  onApply?: (nextText: string) => void;
}) {
  const [posting, setPosting] = useState("");
  const [openLens, setOpenLens] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<LensFix | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  const report = useMemo(
    () => scoreResume(resumeText, posting, sourceText),
    [resumeText, posting, sourceText]
  );

  if (!resumeText.trim()) return null;

  function handleFix(fix: LensFix, key: string) {
    if (!onApply) return;
    if (fix.kind === "confirm_then_add") {
      setPendingConfirm(fix);
      return;
    }
    const next = applyFix(resumeText, fix);
    if (next !== resumeText) {
      onApply(next);
      setApplied((a) => [...a, key]);
    }
  }

  return (
    <div className="border border-t-line bg-t-panel">
      <div className="border-b border-t-line px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-t-white">How this scores on the ATS game</p>
            <p className="mt-1 text-[11px] leading-relaxed text-t-phos-dim">
              We will say it plainly: there is no such thing as &ldquo;your ATS
              score.&rdquo; Every system reads resumes differently, so any single
              number is made up, and grading a person out of 100 is nonsense.
              But employers play this game, so here is the board and how to win
              it. Each row is one thing the industry actually grades.
            </p>
          </div>
          {/* NO COMPOSITE NUMBER. There was one here, and a reviewer was right
              that printing a single score directly contradicts the paragraph
              beside it arguing that no single score exists. Whatever the label
              said, a big number at the top is the thing people read and quote.
              The five rows below are the honest answer. */}
        </div>
      </div>

      {/* The chart. */}
      <div className="px-5 py-4">
        {report.lenses.map((lens: LensScore) => {
          const isOpen = openLens === lens.id;
          return (
            <div key={lens.id} className="border-b border-t-line last:border-b-0">
              <button
                onClick={() => setOpenLens(isOpen ? null : lens.id)}
                className="t-focus w-full py-2.5 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs font-medium text-t-white">
                    {lens.name}
                  </span>
                  {lens.score === null ? (
                    <span className="flex-1 text-[11px] italic text-t-phos-dim">
                      needs a job posting
                    </span>
                  ) : (
                    <Bar score={lens.score} />
                  )}
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-t-phos">
                    {lens.score === null ? "--" : lens.score}
                    <span className="ml-1.5 text-[10px] text-t-phos-dim">
                      {lens.score === null ? "" : verdict(lens.score)}
                    </span>
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="pb-3 pl-3 text-xs">
                  {/* The lesson under the surface. */}
                  <p className="text-t-phos">{lens.what}.</p>
                  <p className="mt-0.5 text-[11px] text-t-phos-dim">{lens.alsoGradedBy}.</p>
                  <p className="mt-2 text-t-phos">{lens.summary}</p>

                  {lens.findings.map((f, i) => {
                    const key = `${lens.id}:${i}`;
                    const done = applied.includes(key);
                    return (
                      <div key={key} className="mt-3 border-l-2 border-t-line pl-3">
                        {f.evidence && (
                          <p className="text-[11px] italic text-t-phos-dim">
                            &ldquo;{f.evidence}&rdquo;
                          </p>
                        )}
                        <p className="mt-0.5 text-t-phos">{f.message}</p>
                        {f.fix && onApply && (
                          <button
                            onClick={() => handleFix(f.fix as LensFix, key)}
                            disabled={done}
                            className="t-focus mt-1.5 border border-t-amber px-2 py-1 text-[11px] font-bold text-t-amber-bright hover:bg-t-amber/10 disabled:opacity-50"
                          >
                            {done ? "Applied" : f.fix.label}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Posting input -- the only way keyword coverage can mean anything. */}
      <div className="border-t border-t-line px-5 py-4">
        <label
          htmlFor="ats-posting"
          className="block text-[11px] font-bold uppercase tracking-wide text-t-phos-dim"
        >
          Paste a job posting to score keyword coverage
        </label>
        <textarea
          id="ats-posting"
          value={posting}
          onChange={(e) => setPosting(e.target.value)}
          rows={3}
          placeholder="Paste the duties and qualifications from a posting you want."
          className="mt-1.5 w-full border border-t-line bg-t-bg px-3 py-2 text-xs text-t-phos"
        />
        {report.hasPosting && (
          <p className="mt-1.5 text-[11px] text-t-phos-dim">
            Scored against this posting only. A different job scores differently,
            which is the clearest proof that no single ATS number exists.
          </p>
        )}
      </div>

      {/* Confirm-before-adding. The integrity boundary, made visible. */}
      {pendingConfirm?.kind === "confirm_then_add" && (
        <div className="border-t border-t-amber/40 bg-t-panel-2 px-5 py-4">
          <p className="text-sm font-bold text-t-white">
            Only you can answer this one
          </p>
          <p className="mt-1 text-xs text-t-phos">{pendingConfirm.question}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                const next = applyFix(resumeText, pendingConfirm);
                if (next !== resumeText) onApply?.(next);
                setPendingConfirm(null);
              }}
              className="t-focus bg-t-amber px-3 py-1.5 text-xs font-bold text-white hover:bg-t-amber-bright"
            >
              Yes, add it to my skills
            </button>
            <button
              onClick={() => setPendingConfirm(null)}
              className="t-focus border border-t-line px-3 py-1.5 text-xs font-medium text-t-phos"
            >
              No, leave it off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
