/**
 * The career planner's questions and the reducer that walks them.
 *
 * Intake doctrine (smr-intake): trust and talk first, start from what the
 * person actually did, one question per screen, every question can be
 * skipped, "not sure" is a good answer, and nothing is suggested that the
 * person did not give. The set is short and adaptive:
 *   - "liked" shows the person's own saved facts to tap, or asks open when
 *     there are none;
 *   - "proud" (an oblique question, M-23) only comes up when "liked" and
 *     "goodAt" both came back empty;
 *   - "training" is skipped when money is needed this week.
 *
 * Pure and client-safe.
 */

export const SOON = ["this_week", "month", "months", "unsure"] as const;
export const TRAINING = ["none", "short", "long"] as const;
export const SCHEDULE = ["days", "nights", "any", "depends"] as const;
export const TRANSPORT = ["drive", "license_no_car", "no_license", "unsure"] as const;
export const PHYSICAL = ["none", "no_heavy", "no_standing", "both"] as const;
export const LICENSING = ["avoid", "keep", "unsure"] as const;

export type Soon = (typeof SOON)[number];
export type Training = (typeof TRAINING)[number];
export type Schedule = (typeof SCHEDULE)[number];
export type Transport = (typeof TRANSPORT)[number];
export type Physical = (typeof PHYSICAL)[number];
export type Licensing = (typeof LICENSING)[number];

export interface PlanAnswers {
  liked?: { factIds: string[]; text: string };
  goodAt?: string;
  proud?: string;
  soon?: Soon;
  training?: Training;
  schedule?: Schedule;
  transport?: Transport;
  physical?: Physical;
  licensing?: Licensing;
  /** The least an hour the person said they can take, in their own number. */
  payFloor?: number;
}

export type QuestionId = keyof PlanAnswers;
export type QuestionKind = "facts" | "text" | "choice" | "number";

export interface Question {
  id: QuestionId;
  kind: QuestionKind;
  prompt: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export const TEXT_MAX = 400;
export const SKIP_LABEL = "Skip this one";

const opts = <T extends string>(pairs: [T, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const QUESTIONS: Record<QuestionId, Question> = {
  liked: {
    id: "liked", kind: "facts",
    prompt: "Think about work you've done. Paid, unpaid, side work, helping family. What part felt good?",
    help: "Tap anything below that felt good to do, and add your own words if you want.",
  },
  goodAt: {
    id: "goodAt", kind: "text",
    prompt: "What are you good at that nobody ever asked you about?",
    help: "Fixing things, calming people down, keeping track of money, cooking for a crowd. Your words, not ours.",
  },
  proud: {
    id: "proud", kind: "text",
    prompt: "Tell me about one time you did something and went home proud of it. Anything counts.",
    help: "No wrong answers. It doesn't have to be a job.",
  },
  soon: {
    id: "soon", kind: "choice",
    prompt: "How soon do you need money coming in?",
    options: opts<Soon>([["this_week", "This week"], ["month", "Within a month"], ["months", "I can take a few months"], ["unsure", "Not sure"]]),
  },
  training: {
    id: "training", kind: "choice",
    prompt: "Would you do training before the first paycheck?",
    options: opts<Training>([["none", "No, I need to work first"], ["short", "A short course is fine"], ["long", "I'd do longer training for the right thing"]]),
  },
  schedule: {
    id: "schedule", kind: "choice",
    prompt: "What hours can you work?",
    options: opts<Schedule>([["days", "Days"], ["nights", "Nights"], ["any", "Any shift"], ["depends", "It depends on the week"]]),
  },
  transport: {
    id: "transport", kind: "choice",
    prompt: "How do you get to work?",
    options: opts<Transport>([["drive", "I drive"], ["license_no_car", "I have a license but no car"], ["no_license", "No driver's license right now"], ["unsure", "Not sure yet"]]),
  },
  physical: {
    id: "physical", kind: "choice",
    prompt: "Anything your body can't do all day?",
    options: opts<Physical>([["none", "No limits"], ["no_heavy", "No heavy lifting"], ["no_standing", "Can't stand all day"], ["both", "Both of those"]]),
  },
  licensing: {
    id: "licensing", kind: "choice",
    prompt: "Some jobs need a state license, and a record can slow some of those down. How do you want to play it?",
    help: "Only you know if this matters for you. Nobody here is asking about your record.",
    options: opts<Licensing>([["avoid", "Skip those for now"], ["keep", "Keep them in"], ["unsure", "Not sure"]]),
  },
  payFloor: {
    id: "payFloor", kind: "number",
    prompt: "What's the least an hour you can take?",
    help: "Your number. Skip it if you don't know.",
  },
};

/** The order questions are asked in. */
export const QUESTION_ORDER: QuestionId[] = ["liked", "goodAt", "proud", "soon", "training", "schedule", "transport", "physical", "licensing", "payFloor"];

export interface PlannerState {
  answers: PlanAnswers;
  /** Answered or skipped, in the order they were asked. Back walks this. */
  asked: QuestionId[];
}

export const INITIAL_PLANNER_STATE: PlannerState = { answers: {}, asked: [] };

export type PlannerAction =
  | { type: "answer"; id: QuestionId; value: unknown }
  | { type: "skip"; id: QuestionId }
  | { type: "back" }
  | { type: "reset" };

const emptyText = (s: string | undefined) => !s || !s.trim();

/** Does this question apply, given what has been said so far? */
export function questionApplies(id: QuestionId, answers: PlanAnswers): boolean {
  if (id === "proud") {
    const liked = answers.liked;
    return (!liked || (liked.factIds.length === 0 && emptyText(liked.text))) && emptyText(answers.goodAt);
  }
  if (id === "training") return answers.soon !== "this_week";
  return true;
}

export function nextQuestion(state: PlannerState): Question | null {
  for (const id of QUESTION_ORDER) {
    if (state.asked.includes(id)) continue;
    if (!questionApplies(id, state.answers)) continue;
    return QUESTIONS[id];
  }
  return null;
}

/** How far along, for the progress line ("3 of 8"). Counts only questions that apply now. */
export function progressOf(state: PlannerState): { done: number; total: number } {
  const total = QUESTION_ORDER.filter((id) => state.asked.includes(id) || questionApplies(id, state.answers)).length;
  return { done: state.asked.length, total };
}

const cleanText = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX) : "");
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** One answer, cleaned. undefined means the value was not acceptable. */
export function cleanAnswer(id: QuestionId, value: unknown): PlanAnswers[QuestionId] | undefined {
  switch (id) {
    case "liked": {
      const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const ids = Array.isArray(v.factIds) ? [...new Set(v.factIds.filter((x): x is string => typeof x === "string" && /^[a-z0-9_-]{1,40}$/i.test(x)))].slice(0, 40) : [];
      return { factIds: ids, text: cleanText(v.text) };
    }
    case "goodAt":
    case "proud":
      return cleanText(value);
    case "soon": return pick(SOON, value);
    case "training": return pick(TRAINING, value);
    case "schedule": return pick(SCHEDULE, value);
    case "transport": return pick(TRANSPORT, value);
    case "physical": return pick(PHYSICAL, value);
    case "licensing": return pick(LICENSING, value);
    case "payFloor": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
      return Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 100) / 100 : undefined;
    }
  }
}

/** Drop answers to questions that no longer apply (an earlier answer changed). */
function prune(state: PlannerState): PlannerState {
  const answers: PlanAnswers = { ...state.answers };
  const asked = state.asked.filter((id) => questionApplies(id, answers));
  for (const id of QUESTION_ORDER) if (!asked.includes(id)) delete answers[id];
  return { answers, asked };
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case "reset":
      return INITIAL_PLANNER_STATE;
    case "back": {
      if (!state.asked.length) return state;
      const last = state.asked[state.asked.length - 1];
      const answers = { ...state.answers };
      delete answers[last];
      return prune({ answers, asked: state.asked.slice(0, -1) });
    }
    case "skip": {
      if (state.asked.includes(action.id)) return state;
      const answers = { ...state.answers };
      delete answers[action.id];
      return prune({ answers, asked: [...state.asked, action.id] });
    }
    case "answer": {
      const value = cleanAnswer(action.id, action.value);
      if (value === undefined) return state;
      const answers = { ...state.answers, [action.id]: value } as PlanAnswers;
      const asked = state.asked.includes(action.id) ? state.asked : [...state.asked, action.id];
      return prune({ answers, asked });
    }
  }
}

/** Server side: read answers off the wire. Unknown keys and bad values are dropped. */
export function readPlanAnswers(raw: unknown): PlanAnswers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: PlanAnswers = {};
  for (const id of QUESTION_ORDER) {
    if (r[id] === undefined || r[id] === null) continue;
    const v = cleanAnswer(id, r[id]);
    if (v !== undefined) (out as Record<string, unknown>)[id] = v;
  }
  return out;
}
