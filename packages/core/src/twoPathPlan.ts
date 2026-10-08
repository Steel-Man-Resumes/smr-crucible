/**
 * Two paths: a realistic job now, and the dream. Pure.
 *
 * A realistic lane and a dream lane can be paired. The pair gets a private
 * plan card (never printed on any document), shaped like a workforce
 * employment plan: the long-term goal (the dream lane's aim, in the person's
 * words), the next steps on the realistic lane, the hurdles, and where to get
 * help.
 *
 * HURDLES ARE GENERAL. They come from the kind of work named, never from the
 * person's record. Whether a record affects a particular license or contract
 * is an offense-based question for a separate, consented step; nothing here
 * reads or guesses it.
 */

import { cleanLine } from "./practiceRecordShared";

export const PLAN_MAX_STEPS = 8;
export const PLAN_STEP_MAX = 200;
export const PLAN_NOTE_MAX = 600;

export interface PairPlan {
  /** The long-term goal in the person's words. Defaults to the dream lane's aim on screen. */
  goal?: string;
  /** Next steps on the realistic lane, in the person's words. */
  steps: string[];
  /** Their own notes on where to get help (a person, a program). */
  helpNotes?: string;
}

export function cleanPlan(input: unknown): PairPlan {
  const d = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const steps = Array.isArray(d.steps)
    ? d.steps.map((x) => cleanLine(x, PLAN_STEP_MAX)).filter((x): x is string => !!x).slice(0, PLAN_MAX_STEPS)
    : [];
  const out: PairPlan = { steps };
  const goal = cleanLine(d.goal, PLAN_STEP_MAX);
  if (goal) out.goal = goal;
  if (typeof d.helpNotes === "string") {
    const n = d.helpNotes.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, PLAN_NOTE_MAX);
    if (n) out.helpNotes = n;
  }
  return out;
}

export function readPlan(v: unknown): PairPlan {
  return cleanPlan(v);
}

export interface Hurdle {
  id: string;
  text: string;
}

export interface HelpSource {
  id: string;
  label: string;
  url: string;
  why: string;
}

/**
 * General, public hurdles by the kind of work named. Each matches words in
 * the lane's aim (the person's words). The list says what USUALLY happens in
 * that kind of work; it never says what will happen to this person.
 */
const HURDLE_RULES: { id: string; re: RegExp; text: string }[] = [
  {
    id: "schools",
    re: /\b(schools?|classrooms?|k-?12|kids|children|youth|students?|camps?|after[- ]school|teaching artists?)\b/i,
    text: "Work with kids or in schools usually means a fingerprint background check, and often a child-abuse clearance, before you start.",
  },
  {
    id: "teaching_license",
    re: /\b(public school teacher|teaching (?:license|certificate|credential)|certified teacher|art teacher|music teacher)\b/i,
    text: "Teaching in a public school takes a state teaching license, and the state reviews each applicant before it issues one.",
  },
  {
    id: "college",
    re: /\b(college|university|professor|faculty|adjunct|lecturer)\b/i,
    text: "College teaching jobs usually run a background check after the offer, and they check degrees and past jobs.",
  },
  {
    id: "museum",
    re: /\b(museums?|collections?|registrar|art handl\w*|preparator|archiv\w*|conservat\w*)\b/i,
    text: "Museum jobs that handle collections often run a criminal background check, and sometimes a credit check.",
  },
  {
    id: "license",
    re: /\b(tattoo\w*|barber\w*|cosmetolog\w*|esthetician|massage|nurs\w*|counsel\w*|therap\w*|real estate|contractor|electrician|plumb\w*)\b/i,
    text: "This kind of work needs a state license. Licensing boards can weigh a record, and the rules differ by state. Look up yours before you pay for training.",
  },
  {
    id: "money",
    re: /\b(bank\w*|cashier|bookkeep\w*|accounting|treasur\w*|finance|gallery sales|retail manager)\b/i,
    text: "Jobs that handle money often run a background check and sometimes a credit check.",
  },
];

const GENERAL_HURDLE: Hurdle = {
  id: "general",
  text: "Most arts jobs, grants and calls ask for the same things any job does: real dates, people who will vouch for you, and sometimes a background check.",
};

export function hurdlesFor(...aims: Array<string | null | undefined>): Hurdle[] {
  const text = aims.filter(Boolean).join(" ");
  const out = HURDLE_RULES.filter((r) => r.re.test(text)).map((r) => ({ id: r.id, text: r.text }));
  return out.length ? out : [GENERAL_HURDLE];
}

/** Said every time, so nobody reads the list as a verdict on their own record. */
export const HURDLES_NOT_A_VERDICT =
  "These are general. Whether your own record affects a license or a contract is a separate, private question. t.ROY doesn't guess it here.";

/** Public places to get help. General, national, free to use. */
export const HELP_SOURCES: HelpSource[] = [
  {
    id: "niccc",
    label: "Licensing rules for your state",
    url: "https://niccc.nationalreentryresourcecenter.org/",
    why: "A national, searchable list of the rules that can apply to a license or job in each state.",
  },
  {
    id: "ajc",
    label: "American Job Centers",
    url: "https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx",
    why: "Free job help near you. Ask about training money and a written employment plan.",
  },
  {
    id: "arts_agency",
    label: "Your state arts agency",
    url: "https://nasaa-arts.org/state-arts-agencies/",
    why: "Every state has one. They list grants, calls and teaching artist rosters.",
  },
  {
    id: "legal_aid",
    label: "Free legal help",
    url: "https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help",
    why: "Find a free legal aid office near you. Many help with records and licenses.",
  },
];
