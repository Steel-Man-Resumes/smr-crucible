/**
 * The Forge path model: given what a person has told the Forge so far, which
 * screens are left, which questions each one asks, in what order, and in
 * which wording.
 *
 * Deterministic and pure: no AI, no React, no storage. The pages and the
 * progress bar both read it, so the progress bar always shows the person's
 * real remaining screens.
 *
 * THE RULES (each one only uses an answer the person already gave)
 *  R1 Depth. "Ready to go" (needs work now) gets the light path by default:
 *     the essentials first, the deeper questions folded behind "Add more", and
 *     the story screen offered after preferences instead of required. Anyone
 *     can switch; the choice is saved as `pathChoice`. Everyone else gets the
 *     full path.
 *  R2 Tone. "Just exploring" and "Thinking about it" get open wording and the
 *     "what would make work feel like yours" prompt unfolded. "Getting ready"
 *     and "Ready to go" get direct wording.
 *  R3 Resume. A saved resume is confirmed, not asked for again. An uploaded
 *     resume with dated jobs is confirmed job by job ("Is this right?"). No
 *     resume keeps the guided builder. Someone who chose to build from
 *     scratch already told us they have no resume, so the goals screen does
 *     not ask how strong it is.
 *  R4 Goals pick story prompts, in the order the goals were picked:
 *     steady work or a flexible schedule brings the schedule question onto
 *     the story screen; getting back into a trade, or room to grow, brings a
 *     licenses-and-training prompt.
 *  R5 Challenges shape preferences: a transportation challenge brings the
 *     commute and location questions to the top with transit-first wording;
 *     a childcare challenge brings the schedule question to the top with
 *     family wording.
 *  R6 Never twice. A question placed on an earlier screen of the path is not
 *     placed again. A location already on the resume is offered to confirm.
 *  R7 The record never shapes wording. The plan never reads the record
 *     details; the only record input is that the person ticked it.
 *  R8 Demo mode is a fixed walkthrough: the full path, default wording.
 */

export type ScreenId = "resume" | "goals" | "story" | "preferences" | "processing" | "output";

export const SCREENS: Record<ScreenId, { path: string; label: string }> = {
  resume: { path: "/resume", label: "Resume" },
  goals: { path: "/goals", label: "Goals" },
  story: { path: "/story", label: "Story" },
  preferences: { path: "/preferences", label: "Preferences" },
  processing: { path: "/processing", label: "Build" },
  output: { path: "/output", label: "Results" },
};

export type QuestionId =
  | "resume"
  | "goals"
  | "confidence"
  | "worries"
  | "goalNarrative"
  | "hook"
  | "challenges"
  | "record"
  | "challengeNarratives"
  | "credentials"
  | "schedule"
  | "environment"
  | "commute"
  | "location";

/** The challengeNarratives key the licenses-and-training prompt writes to. */
export const CREDENTIALS_KEY = "licenses_and_training";

/**
 * Where each answer is stored. A question that moves to another screen keeps
 * its storage, so moving it never loses or duplicates an answer.
 */
export const ANSWER_KEY: Record<QuestionId, string> = {
  resume: "resumeText",
  goals: "goals",
  confidence: "resumeConfidence",
  worries: "resumeWorries",
  goalNarrative: "goalNarrative",
  hook: "hookNarrative",
  challenges: "challenges",
  record: "criminalRecord",
  challengeNarratives: "challengeNarratives",
  credentials: `challengeNarratives.${CREDENTIALS_KEY}`,
  schedule: "preferences.schedule",
  environment: "preferences.environment",
  commute: "preferences.commute",
  location: "preferences.location",
};

export interface PlannedQuestion {
  id: QuestionId;
  /** Which wording the page shows. "default" unless a rule changed it. */
  variant: string;
  /** Folded behind "Add more" (optional depth) rather than shown open. */
  folded: boolean;
}

export interface PlannedScreen {
  id: ScreenId;
  path: string;
  label: string;
  questions: PlannedQuestion[];
}

export interface ForgePath {
  depth: "light" | "full";
  tone: "open" | "direct";
  screens: PlannedScreen[];
  /** Screens offered but not on the path yet (the light path's story screen). */
  offers: ScreenId[];
}

/** The parts of a Forge session the plan reads. Everything is optional: old runs have less. */
export interface PathSession {
  readinessStage?: string;
  pathChoice?: "light" | "full";
  pathExtras?: string[];
  isDemo?: boolean;
  resumeText?: string;
  resumeMethod?: string;
  resumeDoc?: { contact?: { city?: string; state?: string } } | null;
  goals?: string[];
  challenges?: string[];
  preferences?: Record<string, string>;
}

const READY_NOW = "action";

/** R1: the depth a readiness answer starts with, before the person picks. */
export function defaultDepth(readinessStage: string | undefined): "light" | "full" {
  return readinessStage === READY_NOW ? "light" : "full";
}

export function pathDepth(s: PathSession): "light" | "full" {
  if (s.isDemo) return "full";
  if (s.pathChoice === "light" || s.pathChoice === "full") return s.pathChoice;
  return defaultDepth(s.readinessStage);
}

/** R2 */
export function pathTone(s: PathSession): "open" | "direct" {
  if (s.isDemo) return "direct";
  return s.readinessStage === "precontemplation" || s.readinessStage === "contemplation" ? "open" : "direct";
}

/** R3: the resume screen's mode. */
export function resumeVariant(s: PathSession): "rush" | "saved" | "choose" {
  if (s.resumeText && s.resumeMethod === "rush") return "rush";
  if (s.resumeText) return "saved";
  return "choose";
}

/** A job read from a resume, as the "Is this right?" list shows it. */
export interface ConfirmJob {
  title: string;
  company: string;
  start: string;
  end: string;
}

/** R3: jobs worth confirming one by one: a title or employer, and a start date. */
export function datedJobs(jobs: Array<Partial<ConfirmJob>> | null | undefined): ConfirmJob[] {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map((j) => ({
      title: String(j?.title ?? "").trim(),
      company: String(j?.company ?? "").trim(),
      start: String(j?.start ?? "").trim(),
      end: String(j?.end ?? "").trim(),
    }))
    .filter((j) => (j.title || j.company) && j.start);
}

/** "Milwaukee, WI" from a resume's contact block, or null. */
export function locationFromResume(s: PathSession): string | null {
  const city = s.resumeDoc?.contact?.city?.trim();
  const state = s.resumeDoc?.contact?.state?.trim();
  if (!city || !state) return null;
  return `${city}, ${state.length === 2 ? state.toUpperCase() : state}`;
}

const q = (id: QuestionId, variant = "default", folded = false): PlannedQuestion => ({ id, variant, folded });

/** R4: story prompts the goals bring, in the order the goals were picked. */
function goalPrompts(goals: string[], challenges: string[]): PlannedQuestion[] {
  const out: PlannedQuestion[] = [];
  const has = (id: QuestionId) => out.some((p) => p.id === id);
  for (const g of goals) {
    if ((g === "stability" || g === "flexibility") && !has("schedule")) {
      // R5 still applies when R4 already moved the question: childcare wording wins.
      const variant = challenges.includes("childcare") ? "family" : g === "stability" ? "steady" : "flexible";
      out.push(q("schedule", variant));
    }
    if ((g === "back_to_my_trade" || g === "growth") && !has("credentials")) {
      out.push(q("credentials", g === "back_to_my_trade" ? "trade" : "growth"));
    }
  }
  return out;
}

function screen(id: ScreenId, questions: PlannedQuestion[]): PlannedScreen {
  return { id, path: SCREENS[id].path, label: SCREENS[id].label, questions };
}

/** Build the whole path. Pure: the same session always gives the same path. */
export function planForgePath(s: PathSession): ForgePath {
  const depth = pathDepth(s);
  const tone = pathTone(s);
  const demo = s.isDemo === true;
  const light = depth === "light";
  const goals = demo ? [] : Array.isArray(s.goals) ? s.goals : [];
  const challenges = demo ? [] : Array.isArray(s.challenges) ? s.challenges : [];
  const storyOptedIn = light && Array.isArray(s.pathExtras) && s.pathExtras.includes("story");

  // Order of the question screens. Light: story only when they asked for it, after preferences.
  const order: ScreenId[] = light
    ? ["resume", "goals", "preferences", ...(storyOptedIn ? (["story"] as ScreenId[]) : [])]
    : ["resume", "goals", "story", "preferences"];

  const placed = new Set<QuestionId>();
  const take = (list: PlannedQuestion[]) => {
    const kept = list.filter((x) => !placed.has(x.id));
    kept.forEach((x) => placed.add(x.id));
    return kept;
  };

  const screens: PlannedScreen[] = [];
  for (const id of order) {
    if (id === "resume") {
      screens.push(screen("resume", take([q("resume", resumeVariant(s))])));
    } else if (id === "goals") {
      const fold = light; // light path: everything past the goal cards is optional depth
      const list: PlannedQuestion[] = [q("goals", tone)];
      if (s.resumeMethod !== "guided") list.push(q("confidence", "default", fold));
      list.push(q("worries", "default", fold));
      list.push(q("goalNarrative", tone, fold));
      list.push(q("hook", tone, fold || tone === "direct"));
      screens.push(screen("goals", take(list)));
    } else if (id === "story") {
      const list: PlannedQuestion[] = [
        q("challenges", tone),
        q("record"),
        q("challengeNarratives", tone),
        ...goalPrompts(goals, challenges),
      ];
      screens.push(screen("story", take(list)));
    } else if (id === "preferences") {
      const forward: PlannedQuestion[] = [];
      if (challenges.includes("childcare")) forward.push(q("schedule", "family"));
      if (challenges.includes("transportation")) {
        forward.push(q("commute", "transit"));
        forward.push(q("location", locationFromResume(s) && !s.preferences?.location ? "confirm" : "default"));
      }
      const rest: PlannedQuestion[] = [
        q("schedule"),
        q("environment"),
        q("commute"),
        q("location", locationFromResume(s) && !s.preferences?.location ? "confirm" : "default"),
      ].filter((x) => !forward.some((f) => f.id === x.id));
      screens.push(screen("preferences", take([...forward, ...rest])));
    }
  }
  screens.push(screen("processing", []), screen("output", []));

  return {
    depth,
    tone,
    screens,
    offers: light && !storyOptedIn ? ["story"] : [],
  };
}

/** The planned questions for one screen, in order. Empty when the screen is not on the path. */
export function questionsFor(path: ForgePath, id: ScreenId): PlannedQuestion[] {
  return path.screens.find((x) => x.id === id)?.questions ?? [];
}

export function findQuestion(path: ForgePath, screenId: ScreenId, qid: QuestionId): PlannedQuestion | undefined {
  return questionsFor(path, screenId).find((x) => x.id === qid);
}

function indexOf(path: ForgePath, id: ScreenId): number {
  return path.screens.findIndex((x) => x.id === id);
}

/** Where Continue goes from a screen. A screen not on the path continues to processing. */
export function nextPath(path: ForgePath, from: ScreenId): string {
  const i = indexOf(path, from);
  if (i < 0) return SCREENS.processing.path;
  return path.screens[Math.min(i + 1, path.screens.length - 1)].path;
}

/** Where Back goes from a screen. The first screen goes back to the readiness question. */
export function previousPath(path: ForgePath, from: ScreenId): string {
  const i = indexOf(path, from);
  if (i <= 0) {
    // An offered screen opened from preferences goes back there.
    return i < 0 && path.offers.includes(from) ? SCREENS.preferences.path : "/welcome";
  }
  return path.screens[i - 1].path;
}

/** The screens after this one, in order (what the progress bar calls "left"). */
export function remainingScreens(path: ForgePath, from: ScreenId): PlannedScreen[] {
  const i = indexOf(path, from);
  return i < 0 ? [] : path.screens.slice(i + 1);
}

export interface ProgressStep {
  id: ScreenId;
  label: string;
  state: "done" | "current" | "todo";
}

/** The progress bar's steps for a pathname, or null when the page is not a path screen. */
export function progressSteps(path: ForgePath, pathname: string): ProgressStep[] | null {
  const i = path.screens.findIndex((x) => x.path === pathname);
  if (i < 0) return null;
  return path.screens.map((x, n) => ({
    id: x.id,
    label: x.label,
    state: n < i ? "done" : n === i ? "current" : "todo",
  }));
}

/** Which screen a pathname is, if any. */
export function screenForPath(pathname: string): ScreenId | null {
  const hit = (Object.keys(SCREENS) as ScreenId[]).find((id) => SCREENS[id].path === pathname);
  return hit ?? null;
}
