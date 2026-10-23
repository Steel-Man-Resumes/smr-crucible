/**
 * The Forge settles its own finish page (Troy 2026-10-20: "bad one in, good
 * one out; no draft mark"). The person brought their resume, so it is taken as
 * theirs. t.ROY makes every fix it can in their own words, and anything it
 * cannot stand behind comes off the page. Nothing is ever added: every step is
 * one the finish page already allows a person to take, so the same gate that
 * decides "finished" for a tapped page decides it here.
 *
 * Order of preference for a card:
 *   a job whose details are the page's own        -> Looks right
 *   a job the writer changed                      -> back to the page's details, else leave for correction
 *   a skill the person never named                -> off
 *   a credential the person never mentioned       -> off, everywhere
 *   a claim of being over people                  -> the person's own line, else a verified rewrite, else off
 *   any other flagged line                        -> t.ROY's verified draft, else a line the person
 *                                                    already explained stands, else off
 *
 * Pure apart from the `suggest` callback. Returns what it did, so the finish
 * page can say so plainly.
 */

import {
  applyAssistedRewrite,
  applyRewrite,
  buildFinishView,
  cutCredentialEverywhere,
  cutLine,
  cutTerm,
  editableLine,
  recordJobOk,
  type DefendAnswer,
  type CredentialConfirm,
  type FinishView,
  type LineGroup,
} from "./finish-gate";
import { resumeStructureLoss } from "./resume-structure";

export interface SettleState {
  resume: string;
  letter: string;
  answers: DefendAnswer[];
  addedTerms: string[];
  keptTerms: string[];
  confirmed: CredentialConfirm[];
  remnants: string[];
}

/** The fixed inputs the gate reads. */
export type SettleInput = Omit<Parameters<typeof buildFinishView>[0], "resumeText" | "coverLetterText" | "defendAnswers" | "addedTerms" | "keptTerms" | "confirmedCredentials" | "credentialCutRemnants">;

export type SettleNote =
  | { kind: "confirmed"; line: string }
  | { kind: "rewritten"; before: string; after: string }
  | { kind: "removed"; line: string; why: string };

export interface SettleResult {
  state: SettleState;
  view: FinishView;
  notes: SettleNote[];
  /** True when the page is finished. False only if the gate still holds something no step above can clear. */
  finished: boolean;
}

const ROUNDS = 4;

function viewOf(input: SettleInput, s: SettleState): FinishView {
  return buildFinishView({
    ...input,
    resumeText: s.resume,
    coverLetterText: s.letter,
    defendAnswers: s.answers,
    addedTerms: s.addedTerms,
    keptTerms: s.keptTerms,
    confirmedCredentials: s.confirmed,
    credentialCutRemnants: s.remnants,
  });
}

const whyOf = (g: LineGroup) => g.items[0]?.why || g.items[0]?.question || "It needed a fact only you could give.";

export async function settleFinishPage(
  input: SettleInput,
  start: SettleState,
  suggest: (group: LineGroup, source: string, page: string) => Promise<string | null>
): Promise<SettleResult> {
  let s: SettleState = { ...start };
  const notes: SettleNote[] = [];
  let view = viewOf(input, s);

  const cut = (g: LineGroup, why?: string) => {
    if (g.target === "letter") s = { ...s, letter: cutLine(s.letter, g.line) };
    else s = { ...s, resume: cutLine(s.resume, g.line) };
    s = { ...s, answers: [...s.answers.filter((a) => a.line !== g.line)] };
    notes.push({ kind: "removed", line: editableLine(g.line), why: why ?? whyOf(g) });
  };

  const rewrite = (g: LineGroup, text: string, assisted: boolean): boolean => {
    const doc = g.target === "letter" ? s.letter : s.resume;
    const r = assisted ? applyAssistedRewrite(doc, s.answers, g.line, text, view.source) : applyRewrite(doc, s.answers, g.line, text);
    if (!r.changed) return false;
    s = { ...s, answers: r.answers, ...(g.target === "letter" ? { letter: r.text } : { resume: r.text }) };
    notes.push({ kind: "rewritten", before: editableLine(g.line), after: editableLine(text) });
    return true;
  };

  for (let round = 0; round < ROUNDS && view.groups.some((g) => !g.checked); round += 1) {
    for (const g of view.groups) {
      if (g.checked) continue;
      // The writer's page may have changed under an earlier step this round.
      if (g.target === "skillset") {
        for (const t of g.terms ?? []) {
          s = { ...s, resume: cutTerm(s.resume, t), addedTerms: s.addedTerms.filter((x) => x.toLowerCase() !== t.toLowerCase()) };
          notes.push({ kind: "removed", line: t, why: "A skill you never named." });
        }
        continue;
      }
      if (g.credentialName) {
        const r = cutCredentialEverywhere({ resume: s.resume, letter: s.letter }, g.credentialName, {});
        s = { ...s, resume: r.resume, letter: r.letter, remnants: [...s.remnants, ...r.remnants.filter((x) => !s.remnants.includes(x))] };
        notes.push({ kind: "removed", line: g.credentialName, why: "A credential you never mentioned." });
        continue;
      }
      if (g.job) {
        const changed = g.items.some((i) => i.kind === "job_changed");
        if (!changed) {
          s = { ...s, answers: recordJobOk(s.answers, g.line) };
          notes.push({ kind: "confirmed", line: editableLine(g.line) });
        } else if (g.job.ownHeader && rewrite(g, g.job.ownHeader, false)) {
          // back to the page's own details
        }
        // An uncertain match needs correction, never a header deletion that
        // leaves the person's duties attached to the wrong employer.
        continue;
      }
      if (g.scope) {
        const own = g.scope.overPeople?.noLine;
        if (own && rewrite(g, own, false)) continue;
        // "I helped" is the person's choice, not a safe automatic downgrade.
        const draft = await suggest(g, view.source, g.target === "letter" ? s.letter : s.resume);
        if (draft && rewrite(g, draft, true)) continue;
        cut(g, "It claimed leading or training people your page doesn't say.");
        continue;
      }
      if (g.target === "skill") {
        cut(g);
        continue;
      }
      const draft = await suggest(g, view.source, g.target === "letter" ? s.letter : s.resume);
      if (draft && rewrite(g, draft, true)) continue;
      cut(g);
    }
    view = viewOf(input, s);
  }

  if (resumeStructureLoss(start.resume, s.resume).length) {
    const original = viewOf(input, start);
    return { state: start, view: original, notes: [], finished: original.state === "finished" };
  }
  return { state: s, view, notes, finished: view.state === "finished" };
}
