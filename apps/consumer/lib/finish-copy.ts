/**
 * The fix panel's heading lines (copy only; the gate decides nothing here).
 *
 * Finished with nothing asked: checks passed, with an own-words claim only
 * when every line really is in the person's words.
 * Finished after answering: the checked line, and the own-words line when it
 * is also true. Draft: what to do.
 */

export const OWN_WORDS_LINE = "Every line here is in your own words.";

export interface FixPanelIntro {
  heading: string;
  /** The line under the heading, or null when there is nothing to say. */
  subline: string | null;
  showOwnWords: boolean;
}

export function fixPanelIntro(view: { state: "finished" | "draft"; defendTotal: number; allLinesInOwnWords: boolean; jobsOpen?: number; fixCount?: number }): FixPanelIntro {
  // Phase 6: only job taps left. The lines were reworded from the person's own page with every fact kept.
  if (view.state !== "finished" && view.jobsOpen && view.jobsOpen === view.fixCount) {
    return {
      heading: "Check your jobs",
      subline: "These are from your page. Check each one against your records: tap Looks right, or fix it.",
      showOwnWords: false,
    };
  }
  if (view.state !== "finished") {
    return {
      heading: "Fix these with t.ROY",
      subline: "We fixed what we could from your page. These still need your answer.",
      showOwnWords: view.allLinesInOwnWords,
    };
  }
  if (view.defendTotal === 0) return {
    heading: "Checks passed",
    subline: view.allLinesInOwnWords ? null : "We checked the page against what you gave us.",
    showOwnWords: view.allLinesInOwnWords,
  };
  return {
    heading: "Every line checked",
    subline: "You can explain every line we asked about. You can still change an answer.",
    showOwnWords: view.allLinesInOwnWords,
  };
}
