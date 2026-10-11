/**
 * A fictional Forge run (Morgan Sample, a line cook) for the Phase 5 R1
 * revision tests, built the way the finish page builds its state. No AI, no
 * real person. example.com only.
 */

import { buildFinishView, ownWordsFor, recordAnswer, type DefendAnswer } from "../../finish-gate";

export const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;

/** The writer's resume, with one skill the person never said ("Inventory control"). */
export const RESUME = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Showed incoming culinary staff the equipment.

CORE COMPETENCIES
Grill, Breakfast line, Vegetable prep, Kitchen closing, Inventory control`;

export const LETTER = "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner.\n\nMorgan Sample";
export const BAD_LETTER = "Dear hiring manager,\n\nI ran the grill at Harbor Street Diner. I managed 900 employees and hold a PhD in culinary science.\n\nMorgan Sample";

export const OUTPUT = {
  readiness_stage: "preparation",
  narrative: { headline: "A cook who runs the line", summary: "You kept a breakfast grill moving." },
  career_paths: [{ title: "Line Cook" }],
};

export const RUN = {
  resumeText: SOURCE,
  goalNarrative: "I want to keep cooking.",
  forgeOutput: OUTPUT,
  startedAt: "2026-10-08T12:00:00.000Z",
};

export const OWN_WORDS = ownWordsFor(RUN, false);

/** Every defend line answered "true as written", in the person's words. */
export function allAnswered(resume: string = RESUME, letter = ""): DefendAnswer[] {
  let answers: DefendAnswer[] = [];
  const v = buildFinishView({ resumeText: resume, ownWords: OWN_WORDS, defendAnswers: [], coverLetterText: letter });
  for (const d of v.status.defendLines) answers = recordAnswer(answers, d.line, "Yes, I did that myself at that job, most shifts.", "stands");
  return answers;
}

/** The finish page's whole state for this run (what the page sends to save or download). */
export function finishState(over: Record<string, unknown> = {}) {
  return {
    resumeText: RESUME,
    coverLetterText: LETTER,
    defendAnswers: allAnswered(),
    addedTerms: [],
    keptTerms: ["Inventory control"],
    confirmedCredentials: [],
    credentialCutRemnants: [],
    written: { resume: RESUME, letter: LETTER },
    grounding: { verifierRan: true, removed: 0, residual: 0, unmatched: 0, outcomes: [] },
    withheldLines: [],
    keepInsideLines: false,
    ownWords: OWN_WORDS,
    credentialsAnswer: "",
    credentialRows: [],
    ownResumeText: SOURCE,
    lengthChoice: "auto",
    docKind: "resume",
    ...over,
  };
}

/** A deliberately long resume (100 duty lines) whose words are all the person's (review A7). */
export function longResume(): { resume: string; source: string } {
  const duty = "Ran the grill on the breakfast line and prepped vegetables before open.";
  const lines = Array.from({ length: 100 }, () => `- ${duty}`);
  const resume = `MORGAN SAMPLE\nToledo, OH | morgan@example.com\n\nPROFESSIONAL EXPERIENCE\nLINE COOK | Harbor Street Diner | 2019 - 2023\n${lines.join("\n")}`;
  return { resume, source: resume };
}
