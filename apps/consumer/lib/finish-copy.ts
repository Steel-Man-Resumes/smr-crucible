/**
 * The fix panel's heading lines (copy only; the gate decides nothing here).
 *
 * Finished with nothing asked: only "Every line here is in your own words."
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

export function fixPanelIntro(view: { state: "finished" | "draft"; defendTotal: number; allLinesInOwnWords: boolean }): FixPanelIntro {
  if (view.state !== "finished") {
    return {
      heading: "Fix these with t.ROY",
      subline: "These are the lines only you can answer. Say it's true, change it, or cut it.",
      showOwnWords: view.allLinesInOwnWords,
    };
  }
  if (view.defendTotal === 0) return { heading: "Every line checked", subline: null, showOwnWords: true };
  return {
    heading: "Every line checked",
    subline: "You can explain every line we asked about. You can still change an answer.",
    showOwnWords: view.allLinesInOwnWords,
  };
}
