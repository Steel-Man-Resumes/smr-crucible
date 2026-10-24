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
export const CHANGE_HREF = "/dashboard?change=1";
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
    label: "I don't know what I want yet",
    body: "That's fine. We start from what you've done and find three directions worth a look.",
    today: "finding a direction",
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
      return ctx.signedIn ? "/dashboard/interview" : "/login?from=forge&callbackUrl=%2Fdashboard%2Finterview";
    case "documents":
      return ctx.signedIn ? "/dashboard/creative" : `${START_PATH}?step=documents`;
    case "explore":
      return ctx.signedIn ? "/dashboard/paths" : `${START_PATH}?step=explore`;
    case "support":
      return ctx.signedIn ? "/dashboard/resources#support" : `${START_PATH}?step=support`;
  }
}

/** Only these routes need a resume first (review H1). */
export function taskNeedsResume(task: LaneTask | null | undefined): boolean {
  return task === "resume";
}

/**
 * Refinery pages a lane can open before any resume is built (review H1):
 * support and job paths, the job board ("Find one"), and the creative, CV
 * and performer documents. "A person needing food or transport should not
 * have to finish a resume to find it" (Codex C).
 */
export const OPEN_WITHOUT_RESUME = [
  "/dashboard/orientation", // Learning the process does not require a completed resume.
  "/dashboard/paths", "/dashboard/documents", "/dashboard/vault", "/dashboard/employers", "/dashboard/progress", "/dashboard/disclosure", "/dashboard/help","/dashboard/interview", "/dashboard/applications", "/dashboard/resources", "/dashboard/next", "/dashboard/jobs", "/dashboard/creative", "/dashboard/cv", "/dashboard/performer"] as const;

/**
 * The Refinery sends a person with no Forge resume to the Forge's first
 * screen, except on the pages above. The overview is NOT open without a Forge
 * run: the Forge comes first, always (Troy 2026-10-15, after a new account
 * signed in and landed in the Refinery). Before the task is known: stay put
 * (the caller waits).
 */
export function refineryOpenWithoutResume(pathname: string, _task: LaneTask | null | undefined): boolean {
  return OPEN_WITHOUT_RESUME.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Where the bounce goes. On production the session cookie spans every
 * steelmanresumes.com host, so a person on the Refinery host is sent to the
 * Forge host and the URL says so. Anywhere else (preview, local) the Forge
 * screens live on the same host and the sign-in comes along.
 */
export function forgeStartUrl(hostname: string, from = "refinery"): string {
  const path = `${START_PATH}?from=${from}`;
  return /^refinery\.steelmanresumes\.com$/i.test(hostname) ? `https://forge.steelmanresumes.com${path}` : path;
}

/**
 * "Keep going" on the Forge's lane home follows today's route (review H1):
 * the resume and interview routes continue the resume; the job route
 * continues a resume already started, or opens its job step; the
 * "Something else" routes open their own page, which needs no resume.
 */
export function keepGoingHref(
  task: LaneTask,
  ctx: { signedIn: boolean; hasForgeOutput: boolean; hasResumeText: boolean; forgeNext: string }
): string {
  if (task === "interview") return routeHref(task, { signedIn: ctx.signedIn, hasResume: false });
  if (task === "resume") return ctx.hasForgeOutput ? "/output" : ctx.forgeNext;
  if (task === "job") return ctx.hasForgeOutput ? "/output" : ctx.hasResumeText ? ctx.forgeNext : `${START_PATH}?step=job`;
  return routeHref(task, { signedIn: ctx.signedIn, hasResume: false });
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

/**
 * Phase 6 (plan Q1): one path to a real resume. A page the person gave is the
 * writer's source, never the finished page. These open the writer with a
 * saved resume as the source: the resume screen loads it into the Forge run,
 * then the build runs (/processing, then /output).
 */
export const BUILD_WITH_TROY_LABEL = "Build it with t.ROY";
export const REWRITE_WITH_TROY_LABEL = "Rewrite it with t.ROY";
export const CHECK_AS_IS_LABEL = "Check it as it is";
export const REBUILD_PARAM = "rebuild";
/** On /output?check=: open straight on the cards (a draft the writer already made). */
export const CARDS_PARAM = "cards";
export function rebuildHref(artifactId: string): string {
  return `/resume?${REBUILD_PARAM}=${encodeURIComponent(artifactId)}`;
}

/**
 * Phase 6 (S1 round 2): this run is still the build from that saved resume:
 * the page it was given is still the one shown, and the run's own resume text
 * has not changed since (a new upload, paste or section ends it). Only then
 * is the writer sent its id.
 */
export function rebuildActive(s: { rebuild?: { id?: unknown; page?: unknown; resumeAt?: unknown } | null; originalResumeText?: string; resumeText?: string }): string | null {
  const rb = s.rebuild;
  if (!rb || typeof rb.id !== "string" || !rb.id || typeof rb.page !== "string" || typeof rb.resumeAt !== "string") return null;
  if (s.originalResumeText !== rb.page) return null;
  // The run's own resume text is never touched by a rebuild (review r1 M3); a new one ends it.
  if ((s.resumeText ?? "") !== rb.resumeAt) return null;
  return rb.id;
}


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
    // Phase 6 (Q1): "I have one" never saves the page as given; it goes to the writer.
    intake === "have_one"
      ? { screen: "/resume", question: "Make this fix first?", options: [HAVE_ONE_FIX_LABEL, HAVE_ONE_SKIP_LABEL] }
      : { screen: "/resume", question: "Save your first section?", options: ["Save my first section"] }
  );
  void task;
  return steps;
}

export const INTAKE_TITLE = "Do you have a resume?";
/** Phase 6 (Q1): the first reward's two ways on, both to the writer. */
export const HAVE_ONE_FIX_LABEL = "Make this fix and build my resume";
export const HAVE_ONE_SKIP_LABEL = "Skip it and build my resume";
export const HAVE_ONE_BUILD_LABEL = "Build my resume with t.ROY";
export const INTAKE_HAVE_ONE = { label: "I have one", body: "Upload a file or a photo, or paste the text." };
export const INTAKE_BUILD = { label: "Build with me", body: "Start with one job and one thing you did there." };
