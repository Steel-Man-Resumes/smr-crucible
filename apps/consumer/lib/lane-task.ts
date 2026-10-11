/**
 * Lanes first (Phase 5 lane R2; Troy 2026-10-10; Codex review section C).
 *
 * "If we're going to have all these options, they have to be like lanes.
 * Let a person choose a lane and then they can follow that. They can change
 * it later." The first screen after sign-in asks one question, "What do you
 * need today?", and the answer (a task, migration 083) decides what comes
 * next. The lane header says where the person is headed and what today is
 * for, with a Change link. Every tool stays reachable under "All tools".
 *
 * Pure and client-safe: copy, where each route goes, the header line, the
 * one next action, and the decision count the tests hold to (3 or fewer
 * required decisions from sign-in to a first saved resume section).
 */

import { isLaneTask, MAIN_TASKS, OTHER_TASKS, type LaneTask } from "@crucible/core/src/laneFocusShared";

export type { LaneTask };
export { isLaneTask, MAIN_TASKS, OTHER_TASKS };

export const START_PATH = "/start";
/** The Change link everywhere. */
export const CHANGE_HREF = "/start?change=1";
/** The lane home for someone signed in. */
export const LANE_HOME_HREF = "/dashboard";

export const FIRST_SCREEN_TITLE = "What do you need today?";
export const FIRST_SCREEN_SUBTITLE = "Pick one. You can change it any time.";
export const SOMETHING_ELSE_LABEL = "Something else";
export const HELP_LINK_LABEL = "Something getting in the way? Get help";

export interface TaskCopy {
  label: string;
  body: string;
  /** What the header says after "Today:". */
  today: string;
}

export const TASK_COPY: Record<LaneTask, TaskCopy> = {
  resume: {
    label: "Get a resume I can use",
    body: "Fix the one you have, or build one with me.",
    today: "your resume",
  },
  job: {
    label: "Go after a job",
    body: "Start from a job you have in mind. We build only what you need for it.",
    today: "going after a job",
  },
  interview: {
    label: "Get ready for an interview",
    body: "Practice the questions with your real work history.",
    today: "interview prep",
  },
  documents: {
    label: "Creative work, a CV, or a performer page",
    body: "For art, teaching and research, or acting and music.",
    today: "your documents",
  },
  explore: {
    label: "Explore a career",
    body: "See job paths that are open to people with records.",
    today: "exploring careers",
  },
  support: {
    label: "Get support",
    body: "Rides, ID, housing, food, and help with a record.",
    today: "getting support",
  },
};

/** "Working toward: forklift driver · Today: your resume". */
export function laneHeaderLine(task: LaneTask, target: string | null | undefined): { toward: string; today: string } {
  const t = (target ?? "").replace(/\s+/g, " ").trim();
  return { toward: t || "a job", today: TASK_COPY[task].today };
}

export interface RouteContext {
  signedIn: boolean;
  /** A resume is already on file (this run, or the account). */
  hasResume: boolean;
}

/**
 * Where picking a route goes. The job route and "Something else" open their
 * own small step on the first screen; the rest go straight to work.
 */
export function routeHref(task: LaneTask, ctx: RouteContext): string {
  switch (task) {
    case "resume":
      return "/resume";
    case "job":
      return `${START_PATH}?step=job`;
    case "interview":
      // Practice comes from the person's real history: with a resume on file,
      // straight to practice; without one, the resume first.
      return ctx.signedIn && ctx.hasResume ? "/dashboard/interview" : "/resume";
    case "documents":
      return ctx.signedIn ? "/dashboard/creative" : `${START_PATH}?step=documents`;
    case "explore":
      return ctx.signedIn ? "/dashboard/resources#paths" : `${START_PATH}?step=explore`;
    case "support":
      return ctx.signedIn ? "/dashboard/resources#support" : `${START_PATH}?step=support`;
  }
}

/** The three document kinds behind "Creative work, a CV, or a performer page". */
export const DOCUMENT_LINKS = [
  { href: "/dashboard/creative", label: "Creative work", body: "An artist resume, a bio, and your own statement." },
  { href: "/dashboard/cv", label: "A CV", body: "For teaching, research or clinical work." },
  { href: "/dashboard/performer", label: "A performer page", body: "Credits, training and skills on one page." },
] as const;

/** The one next action after the first saved result, by route. */
export interface NextAction {
  label: string;
  href: string;
}

export function nextActionFor(task: LaneTask | null | undefined, ctx: { signedIn: boolean; finished: boolean }): NextAction {
  switch (task) {
    case "job":
      return ctx.signedIn ? { label: "Pick a job to go after", href: "/dashboard/jobs" } : { label: "Pick a job to go after", href: "/login?callbackUrl=%2Fdashboard%2Fjobs" };
    case "interview":
      return ctx.signedIn ? { label: "Practice for your interview", href: "/dashboard/interview" } : { label: "Practice for your interview", href: "/login?callbackUrl=%2Fdashboard%2Finterview" };
    default:
      return ctx.finished
        ? { label: "Use this resume", href: ctx.signedIn ? "/dashboard/vault" : "#finish-download" }
        : { label: "Check it and finish", href: "#fix-list" };
  }
}

/** Draft badge wording, everywhere a draft resume shows (CC 2026-10-10). */
export const DRAFT_BADGE = "Draft: check it before you send it.";
export const CHECK_AND_FINISH_LABEL = "Check and finish";

/* ---------------------------------------------------------- decision count -- */

/**
 * The required decisions on each main route, from sign-in to a first saved
 * resume section, as the screens ask them. Typing an answer (a file, a line,
 * a job title) is input, not a decision; a decision is a choice between
 * options the person must make to move on. The test fails if any route needs
 * more than three.
 */
export interface DecisionStep {
  screen: string;
  question: string;
  options: string[];
}

export function decisionsToFirstSave(task: "resume" | "job" | "interview", intake: "have_one" | "build"): DecisionStep[] {
  const steps: DecisionStep[] = [
    { screen: START_PATH, question: FIRST_SCREEN_TITLE, options: MAIN_TASKS.map((t) => TASK_COPY[t].label).concat(SOMETHING_ELSE_LABEL) },
  ];
  // The job route's step is one optional box (the job) and Continue: input, not a choice.
  // The interview route without a resume goes straight to the resume screen.
  steps.push({ screen: "/resume", question: INTAKE_TITLE, options: [INTAKE_HAVE_ONE.label, INTAKE_BUILD.label] });
  steps.push(
    intake === "have_one"
      ? { screen: "/resume", question: "Save this fix?", options: ["Make this fix and save", "Save it as it is"] }
      : { screen: "/resume", question: "Save your first section?", options: ["Save my first section"] }
  );
  void task;
  return steps;
}

export const INTAKE_TITLE = "Do you have a resume?";
export const INTAKE_HAVE_ONE = { label: "I have one", body: "Upload a file or a photo, or paste the text." };
export const INTAKE_BUILD = { label: "Build with me", body: "Start with one job and one thing you did there." };
