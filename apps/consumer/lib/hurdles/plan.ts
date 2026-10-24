/**
 * Build the hurdle plan from the person's answers (PURE, no AI).
 *
 * Every line here comes from a choice the person picked or words they typed.
 * The AI may later put a summary into smoother words (phrase.ts), but the
 * plan stands on its own: if the AI fails, nothing here is lost.
 * Unresolved stays unresolved: a "not sure" or a skip is listed as still open,
 * never filled in with a guess.
 */

import { HURDLES, NODES, getNode, type Constraint, type HurdleId, type SupportCategory } from "./graph";
import { coverageOf, isUnsure, type Coverage } from "./coverage";
import { mergeAcrossHurdles } from "./filters";
import { legalFloorFor, type LegalFloor } from "./legal-floor";
import { hurdlesOf, reachedAnswers, walk, type Answer, type PlannerState } from "./reducer";

export const COACHING_LINE = "This is coaching, not legal advice.";

export const SUPPORT_LABELS: Record<SupportCategory, string> = {
  transportation: "Getting to work", housing: "A place to stay", id_documents: "ID and documents",
  legal: "Legal help with a record", financial: "Money and benefits", employment: "Job help",
  education: "School and training", mental_health: "Mental health (only if you want it)", substance: "Recovery",
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
  constraints: Constraint & { shiftConflict?: boolean };
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
  const active = hurdlesOf(state);
  const hurdles = active.map((h) => sectionFor(h, answers, ctx.location));
  const groups: Constraint[][] = active.map((h) => {
    const g: Constraint[] = [];
    for (const id of walk(h, answers).path) {
      const node = getNode(id)!;
      for (const c of node.choices ?? []) if (c.constraint && answers[id]?.choices?.includes(c.id)) g.push(c.constraint);
    }
    return g;
  });
  return {
    version: 1,
    hurdles,
    record: active.includes("record") ? recordConversation(answers) : null,
    constraints: mergeAcrossHurdles(groups),
    coverage: coverageOf({ selected: state.selected, answers }),
  };
}

/** Plain text of a saved plan, for the Library copy and download. */
export function hurdlePlanText(plan: { hurdles: HurdleSection[]; record: RecordConversation | null }, phrased?: Record<string, string>): string {
  const out: string[] = [];
  if (plan.record) {
    out.push("PLAN WHAT TO SAY ABOUT THE RECORD (not saved anywhere; this copy is yours)", ...plan.record.whenToBringItUp, plan.record.open, plan.record.next,
      `Dated sources (verify before relying, list as of ${plan.record.legalFloor.asOf}):`, ...plan.record.legalFloor.sources.map((x) => `- ${x.title}: ${x.url} (checked ${x.asOf})`),
      ...(plan.record.legalFloor.staleNote ? [plan.record.legalFloor.staleNote] : []), plan.record.disclaimer);
  }
  for (const s of plan.hurdles) {
    if (s.hurdle === "record" && plan.record) continue;
    out.push("", s.label.toUpperCase());
    if (phrased?.[s.hurdle]) out.push(`t.ROY's reading of your answers: ${phrased[s.hurdle]}`);
    if (s.known.length) out.push("What you know:", ...s.known.map((x) => `- ${x}`));
    if (s.open.length) out.push("Still open:", ...s.open.map((x) => `- ${x}`));
    if (s.doNow.length) out.push("Do now:", ...s.doNow.map((x) => `- ${x}`));
    if (s.askEmployer.length) out.push("Ask an employer:", ...s.askEmployer.map((x) => `- ${x}`));
    if (s.tell) out.push(`What you tell an employer: ${s.tell}`);
  }
  return out.join("\n");
}

/**
 * What a save keeps (Library artifact, and any application snapshot of it).
 * NOTHING from the record hurdle: no record sentence, no record answer, no
 * timing or lead choice, no record "do now" line (those can reveal supervision
 * or a pending case). The record plan lives on screen, in the download and in
 * what the person copies. Also left out: every free-text answer except the
 * job's state code, and any choice marked sensitive ("time inside").
 */
export function planForSave(plan: HurdlePlan, state: Pick<PlannerState, "selected" | "answers">) {
  const choices: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(reachedAnswers(state))) {
    const node = getNode(id)!;
    if (node.sensitive || node.hurdle === "record") continue;
    if (a.skipped) choices[id] = { skipped: true };
    else if (node.kind === "text") continue;
    else {
      const keep = (a.choices ?? []).filter((c) => !(node.choices ?? []).find((x) => x.id === c)?.sensitive);
      if (keep.length) choices[id] = { choices: keep };
    }
  }
  const sensitiveFacts = new Set(recordAndSensitiveText());
  return {
    version: 2 as const,
    selected: state.selected.filter((h) => h !== "record"),
    choices,
    recordPlanSaved: false as const,
    hurdles: plan.hurdles.filter((s) => s.hurdle !== "record").map((s) => ({ ...s, ownWords: [], known: s.known.filter((k) => !sensitiveFacts.has(k)) })),
    constraints: plan.constraints,
    coverage: { line: "Saved without the record part. " + plan.coverage.line },
  };
}

/**
 * Every fact and label that can reveal a record: all of the record hurdle,
 * every choice on a sensitive node, and every choice marked sensitive. A
 * saved plan must contain none of them (the test checks the whole payload).
 */
export function recordAndSensitiveText(): string[] {
  const out: string[] = [];
  for (const n of Object.values(NODES)) {
    const all = n.hurdle === "record" || n.sensitive;
    for (const c of n.choices ?? []) if (all || c.sensitive) out.push(c.fact ?? c.label, c.label, ...(c.action ? [c.action] : []), ...(c.ask ? [c.ask] : []));
  }
  // Text that is also an ordinary answer elsewhere ("1 to 3 years" for a gap) reveals nothing by itself.
  const ordinary = new Set<string>();
  for (const n of Object.values(NODES)) {
    if (n.hurdle === "record" || n.sensitive) continue;
    for (const c of n.choices ?? []) if (!c.sensitive) ordinary.add(c.label).add(c.fact ?? c.label);
  }
  return [...new Set(out)].filter((t) => t && !ordinary.has(t));
}

/** The whole artifact body for POST /api/artifacts. Pure, so tests can prove what is in it. */
export function buildSavePayload(plan: HurdlePlan, state: Pick<PlannerState, "selected" | "answers">, opts: { summaries: Partial<Record<HurdleId, string>>; strippedCount: number; wording: string; targetJob: string | null; applicationId?: string; now?: string }) {
  const saved = planForSave(plan, state);
  // t.ROY's reading is not saved: it can echo words the person typed, and the
  // copy promises nothing typed is saved. The person's answers are the plan.
  const summaries: Record<string, string> = {};
  void opts.summaries;
  const nonRecord = { hurdles: saved.hurdles, record: null };
  return {
    type: "disclosure_plan",
    targetContext: { targetJob: opts.targetJob, applicationId: opts.applicationId },
    content: {
      // Older readers (Library, application snapshot) read these four fields.
      timing_advice: null,
      legal_context: COACHING_LINE,
      script: null,
      tips: saved.hurdles.flatMap((s) => s.doNow).slice(0, 8),
      targetJob: opts.targetJob,
      completedAt: opts.now ?? new Date().toISOString(),
      hurdlePlan: { ...saved, summaries, strippedCount: opts.strippedCount, wording: opts.wording },
      planText: hurdlePlanText(nonRecord, summaries as Record<string, string>),
    },
    scaffoldLevel: 1.0,
  };
}
