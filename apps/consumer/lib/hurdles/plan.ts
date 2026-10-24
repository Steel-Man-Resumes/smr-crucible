/**
 * Build the hurdle plan from the person's answers (PURE, no AI).
 *
 * Every line here comes from a choice the person picked or words they typed.
 * The AI may later put a summary into smoother words (phrase.ts), but the
 * plan stands on its own: if the AI fails, nothing here is lost.
 * Unresolved stays unresolved: a "not sure" or a skip is listed as still open,
 * never filled in with a guess.
 */

import { HURDLES, getNode, type Constraint, type HurdleId, type SupportCategory } from "./graph";
import { coverageOf, isUnsure, type Coverage } from "./coverage";
import { mergeConstraints } from "./filters";
import { legalFloorFor, type LegalFloor } from "./legal-floor";
import { reachedAnswers, walk, type Answer, type PlannerState } from "./reducer";

export const COACHING_LINE = "This is coaching, not legal advice.";

export const SUPPORT_LABELS: Record<SupportCategory, string> = {
  transportation: "Getting to work", housing: "A place to stay", id_documents: "ID and documents",
  legal: "Legal help with a record", financial: "Money and benefits", employment: "Job help",
  education: "School and training", mental_health: "Mental health", substance: "Recovery",
};

export interface HelpLink { category: SupportCategory; label: string; href: string }

export interface HurdleSection {
  hurdle: HurdleId;
  label: string;
  known: string[];
  open: string[];
  doNow: string[];
  whoCanHelp: HelpLink[];
  askEmployer: string[];
  /** The person's own choice about what an employer hears (null = not answered). */
  tell: string | null;
  /** Words the person typed on this hurdle (kept with the plan on screen only). */
  ownWords: string[];
  complete: boolean;
}

export interface RecordConversation {
  whenToBringItUp: string[];
  /** The opening, in the person's words or a blank for them to fill. */
  open: string;
  /** What to say if they ask more. */
  next: string;
  /** True when the opening came from the person's own words. */
  fromYou: boolean;
  legalFloor: LegalFloor;
  disclaimer: string;
}

export interface HurdlePlan {
  version: 1;
  hurdles: HurdleSection[];
  record: RecordConversation | null;
  constraints: Constraint;
  coverage: Coverage;
}

export function supportHref(category: SupportCategory, location?: string | null): string {
  const q = new URLSearchParams({ category });
  const loc = (location ?? "").trim().slice(0, 120);
  if (loc) q.set("location", loc);
  return `/dashboard/resources?${q.toString()}#support`;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

function sectionFor(hurdle: HurdleId, answers: Record<string, Answer>, location?: string | null): HurdleSection {
  const def = HURDLES[hurdle];
  const w = walk(hurdle, answers);
  const known: string[] = [], open: string[] = [], doNow: string[] = [], ask: string[] = [], ownWords: string[] = [];
  const support: SupportCategory[] = [...def.support];
  let tell: string | null = null;
  for (const id of w.path) {
    const node = getNode(id)!;
    const a = answers[id];
    if (!a || a.skipped) { open.push(capital(node.decision)); continue; }
    if (node.kind === "text") {
      if (a.text) {
        if (node.format === "state") known.push(`The job is in ${a.text}.`);
        else ownWords.push(a.text);
      }
      continue;
    }
    const picked = (node.choices ?? []).filter((c) => a.choices?.includes(c.id));
    if (isUnsure(id, a)) open.push(capital(node.decision));
    for (const c of picked) {
      if (id.endsWith(".tell")) { tell = c.fact ?? c.label; continue; }
      if (!c.uncertain) known.push(c.fact ?? c.label);
      else if (c.fact) known.push(c.fact);
      if (c.action) doNow.push(c.action);
      if (c.ask) ask.push(c.ask);
      for (const s of c.support ?? []) support.push(s);
    }
  }
  if (!w.complete) open.push("The rest of this hurdle's questions (you can come back to them).");
  return {
    hurdle, label: def.label, known: uniq(known), open: uniq(open),
    doNow: uniq([def.firstStep, ...doNow]),
    whoCanHelp: uniq(support).map((c) => ({ category: c as SupportCategory, label: SUPPORT_LABELS[c as SupportCategory], href: supportHref(c as SupportCategory, location) })),
    askEmployer: uniq(ask), tell, ownWords, complete: w.complete,
  };
}

function capital(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) + "." : s; }

function picked(answers: Record<string, Answer>, nodeId: string): string[] {
  const a = answers[nodeId];
  return a && !a.skipped ? a.choices ?? [] : [];
}

function textOf(answers: Record<string, Answer>, nodeId: string): string {
  const a = answers[nodeId];
  return a && !a.skipped && typeof a.text === "string" ? a.text.trim() : "";
}

const LEAD_WORDS: Record<string, string> = {
  work: "your current or recent work", training: "the training or school you finished",
  showing_up: "how you show up", reference: "the person who will vouch for you",
};

export function recordConversation(answers: Record<string, Answer>): RecordConversation {
  const where = picked(answers, "record.where");
  const raise = picked(answers, "record.raise")[0];
  const when: string[] = [];
  if (where.includes("form")) {
    const q = textOf(answers, "record.form_question");
    when.push("On the application: answer the question the form asks, the way it's written, fully and truthfully. Answer only what it asks.");
    if (q) when.push(`The form asks: "${q}" Read it twice. Its own words, and any time limit in it, decide what it covers.`);
  }
  if (where.includes("interview") || where.includes("work") || where.includes("not_sure") || !where.length) {
    if (raise === "me") when.push("In conversation: you chose to bring it up yourself. One way is to wait until they have seen you fit the job, say it in two sentences, then turn back to the work.");
    else if (raise === "wait") when.push("In conversation: you chose to wait until they ask. Have your two sentences ready, so you are not making it up on the spot.");
    else when.push("In conversation: practice it both ways, once where they ask and once where they don't. Then decide which feels right.");
  }
  if (where.includes("check")) when.push("The background check: the report can show it whether or not you talk about it. What you say should match what the report will show.");

  const own = textOf(answers, "record.own_words");
  const now = textOf(answers, "record.now_words");
  const lead = picked(answers, "record.lead").filter((l) => LEAD_WORDS[l]).map((l) => LEAD_WORDS[l]);
  const open = own ? `I'd say: "${own}"` : "I'd say: \"[one plain sentence about the record, in your words. No details needed.]\"";
  const nextParts: string[] = [];
  if (now) nextParts.push(`Then: "${now}"`);
  else if (lead.length) nextParts.push(`Then turn to ${lead.join(" and ")}, in one or two true sentences.`);
  else nextParts.push("Then turn to one true thing about what you do now.");
  nextParts.push("If they ask for more: one more true sentence, then back to the job.");
  const stateText = textOf(answers, "record.state");
  return {
    whenToBringItUp: when, open, next: nextParts.join(" "), fromYou: !!own,
    legalFloor: legalFloorFor(stateText || null), disclaimer: `${COACHING_LINE} Laws change and every situation is different. For your case, ask a reentry legal aid office.`,
  };
}

export function buildHurdlePlan(state: Pick<PlannerState, "selected" | "answers">, ctx: { location?: string | null } = {}): HurdlePlan {
  const full = { phase: "done" as const, cursor: null, ...state };
  const answers = reachedAnswers(full);
  const hurdles = state.selected.map((h) => sectionFor(h, answers, ctx.location));
  const constraints: Constraint[] = [];
  for (const h of state.selected) for (const id of walk(h, answers).path) {
    const node = getNode(id)!;
    for (const c of node.choices ?? []) if (c.constraint && answers[id]?.choices?.includes(c.id)) constraints.push(c.constraint);
  }
  return {
    version: 1,
    hurdles,
    record: state.selected.includes("record") ? recordConversation(answers) : null,
    constraints: mergeConstraints(constraints),
    coverage: coverageOf({ selected: state.selected, answers }),
  };
}

/** Plain text of a saved plan, for the Library copy and download. */
export function hurdlePlanText(plan: Pick<HurdlePlan, "hurdles" | "record">, phrased?: Record<string, string>): string {
  const out: string[] = [];
  if (plan.record) {
    out.push("PLAN WHAT TO SAY ABOUT THE RECORD", ...plan.record.whenToBringItUp, plan.record.open, plan.record.next, plan.record.disclaimer);
  }
  for (const s of plan.hurdles) {
    if (s.hurdle === "record" && plan.record) continue;
    out.push("", s.label.toUpperCase());
    if (phrased?.[s.hurdle]) out.push(phrased[s.hurdle]);
    if (s.known.length) out.push("What you know:", ...s.known.map((x) => `- ${x}`));
    if (s.open.length) out.push("Still open:", ...s.open.map((x) => `- ${x}`));
    if (s.doNow.length) out.push("Do now:", ...s.doNow.map((x) => `- ${x}`));
    if (s.askEmployer.length) out.push("Ask an employer:", ...s.askEmployer.map((x) => `- ${x}`));
    if (s.tell) out.push(`What you tell an employer: ${s.tell}`);
  }
  return out.join("\n");
}

/**
 * What a save keeps. The Library copy holds the plan and the choices that
 * rebuild it, never the free text the person typed while narrowing (except the
 * job's state code) and never record detail: record choices are left out, and
 * the record section keeps its steps and the conversation lines the person
 * made, not the facts behind them.
 */
export function planForSave(plan: HurdlePlan, state: Pick<PlannerState, "selected" | "answers">) {
  const full = { phase: "done" as const, cursor: null, ...state };
  const choices: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(reachedAnswers(full))) {
    const node = getNode(id)!;
    if (node.sensitive) continue;
    if (a.skipped) choices[id] = { skipped: true };
    else if (node.kind === "text") { if (node.format === "state" && a.text) choices[id] = { text: a.text }; }
    else if (a.choices?.length) choices[id] = { choices: a.choices };
  }
  return {
    version: 1 as const,
    selected: state.selected,
    choices,
    hurdles: plan.hurdles.map((s) => ({ ...s, ownWords: [], known: s.hurdle === "record" ? [] : s.known })),
    record: plan.record,
    constraints: plan.constraints,
    coverage: { onPath: plan.coverage.onPath, answered: plan.coverage.answered, skipped: plan.coverage.skipped, notSure: plan.coverage.notSure, line: plan.coverage.line },
  };
}
