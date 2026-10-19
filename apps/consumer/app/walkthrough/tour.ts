/**
 * The guided tour script. Each step is one beat: a scene, where the camera
 * looks (a spotlight box in 0..1 of the scene, or a data-tour selector for
 * live scenes), what the cursor does, and the caption.
 *
 * Boxes for live pages were measured from the DOM when the screens were
 * captured (2026-10-19). Boxes for the finish page and the program screens
 * were read off the images. Captions restate only what the screen shows or
 * what the audited site copy says.
 */

import type { RecordChoice } from "@/lib/record-choice";

export type Box = [number, number, number, number];

export type SceneId =
  | "title"
  | "forge-intro"
  | "finish-page"
  | "finish-story"
  | "finish-checks"
  | "record"
  | "art-tailor"
  | "art-disclosure"
  | "art-practice"
  | "tools"
  | "map"
  | "state-montana"
  | "local-help"
  | "org-13"
  | "org-14"
  | "org-15"
  | "org-16"
  | "close";

export type ImgScene = { kind: "img"; src: string; w: number; h: number; note: string };
export type DomScene = { kind: "dom"; w: number; h: number; note?: string };

const IMG = (src: string, w: number, h: number, note: string): ImgScene => ({ kind: "img", src: `/walkthrough/${src}.webp`, w, h, note });
const LIVE = "Captured from the live site, Oct 19, 2026";
const FINISH = "Forge test run, Oct 14, 2026 · fictional person";
const ORG = "Demo program workspace · sample data, fictional people";
const ART = "Illustration from steelmanresumes.com";

export const SCENES: Record<SceneId, ImgScene | DomScene> = {
  title: { kind: "dom", w: 1280, h: 800 },
  "forge-intro": IMG("forge-intro", 1600, 1600, LIVE),
  "finish-page": IMG("finish-page", 1103, 926, FINISH),
  "finish-story": IMG("finish-story", 1103, 240, FINISH),
  "finish-checks": IMG("finish-checks", 1103, 449, FINISH),
  record: { kind: "dom", w: 1280, h: 800, note: "The real record card, running on a sample page" },
  "art-tailor": IMG("art-refinery-tailor-02", 1536, 1024, ART),
  "art-disclosure": IMG("art-refinery-disclosure-03", 1536, 1024, ART),
  "art-practice": IMG("art-refinery-practice-04", 1536, 1024, ART),
  tools: { kind: "dom", w: 1280, h: 800, note: "From the Refinery tool list on steelmanresumes.com" },
  map: IMG("map", 1600, 1313, LIVE),
  "state-montana": IMG("state-montana", 1600, 1242, LIVE),
  "local-help": IMG("local-help", 1600, 1354, LIVE),
  "org-13": IMG("org-13", 1600, 1000, ORG),
  "org-14": IMG("org-14", 1600, 1000, ORG),
  "org-15": IMG("org-15", 1600, 1000, ORG),
  "org-16": IMG("org-16", 1600, 1000, ORG),
  close: { kind: "dom", w: 1280, h: 800 },
};

export const CHAPTERS = [
  { id: "idea", label: "The idea" },
  { id: "forge", label: "The Forge" },
  { id: "record", label: "Your record" },
  { id: "refinery", label: "The Refinery" },
  { id: "help", label: "Employers + help" },
  { id: "programs", label: "Programs" },
] as const;
export type ChapterId = (typeof CHAPTERS)[number]["id"];

export type Step = {
  chapter: ChapterId;
  scene: SceneId;
  /** Spotlight: a box in 0..1 of the scene, or a data-tour name in a live scene. */
  spot?: Box | string;
  /** Camera zoom override (1 = whole scene). Without it the camera frames the spot. */
  zoom?: number;
  /** Where the camera centres when there is no spot, 0..1. */
  focus?: [number, number];
  /** Slow drift for illustrations: the camera eases this far over the whole beat. */
  drift?: number;
  /** Cursor goes to the spot, a point (0..1), or a selector in a live scene, and clicks. */
  click?: boolean | [number, number] | string;
  /** What the click does in a live scene. */
  action?: RecordChoice | "why";
  title: string;
  body: string;
  /** Extra time on screen, ms. */
  extra?: number;
};

export const STEPS: Step[] = [
  { chapter: "idea", scene: "title", title: "A resume is one move in the hiring game.", body: "Hiring is a process, and most of it was built to serve the employer. With a record it cuts harder. Here is how Steel Man helps you play it smart.", extra: 800 },

  { chapter: "forge", scene: "forge-intro", zoom: 1, title: "Start in the Forge", body: "Free. You sign in first, so your work is saved." },
  { chapter: "forge", scene: "forge-intro", spot: [0.17, 0.08, 0.64, 0.24], title: "Meet t.ROY, the coach", body: "It listens while you tell it what you did, then helps write a resume you can stand behind." },
  { chapter: "forge", scene: "forge-intro", spot: [0.17, 0.375, 0.6, 0.17], click: [0.5, 0.425], title: "Bring what you have", body: "Upload an old resume, snap a photo, paste it, or start from nothing." },
  { chapter: "forge", scene: "forge-intro", spot: [0.225, 0.5911, 0.55, 0.3543], title: "A rough line gives us a question", body: "Watch one line get stronger." },
  { chapter: "forge", scene: "forge-intro", spot: [0.225, 0.6693, 0.55, 0.0522], title: "The old line", body: "Did safety audits." },
  { chapter: "forge", scene: "forge-intro", spot: [0.225, 0.7215, 0.55, 0.0522], title: "t.ROY asks", body: "What did you check?" },
  { chapter: "forge", scene: "forge-intro", spot: [0.225, 0.7737, 0.55, 0.0522], title: "The person answers", body: "In their own words. The detail comes from them." },
  { chapter: "forge", scene: "forge-intro", spot: [0.225, 0.8259, 0.55, 0.0848], title: "The stronger line", body: "Checked exit routes each shift. Nothing invented to fill a gap." },
  { chapter: "forge", scene: "finish-page", zoom: 1, title: "What comes out", body: "The resume, and beside it a short list of fixes." },
  { chapter: "forge", scene: "finish-page", spot: [0.645, 0.06, 0.35, 0.19], click: [0.69, 0.205], title: "Every change is named", body: "Anything t.ROY changed is shown, with what was not on the person's page." },
  { chapter: "forge", scene: "finish-page", spot: [0.645, 0.45, 0.35, 0.39], title: "Numbers only if you know them", body: "A number sticks with the reader. Only add one you know. Skipping never stops you from finishing." },
  { chapter: "forge", scene: "finish-story", spot: [0.01, 0.12, 0.98, 0.68], title: "The story behind the resume", body: "t.ROY's reading of the work. You decide whether it sounds like you." },
  { chapter: "forge", scene: "finish-checks", spot: [0.0, 0.11, 1.0, 0.8], title: "Checked before it goes out", body: "Hard rules, dates and wording, a second check, keywords and page length." },

  { chapter: "record", scene: "record", zoom: 1, title: "Your record, your call", body: "If some of the work happened inside, the person chooses how it shows. This is the real card from the Forge.", extra: 400 },
  { chapter: "record", scene: "record", spot: "record-card", click: "[data-testid=record-choice-state]", action: "state", title: "Show the work, name the state", body: "The job stays. The employer reads as the State of Pennsylvania, not the facility.", extra: 600 },
  { chapter: "record", scene: "record", spot: "record-changed", title: "The page follows the choice", body: "The rewrite runs on the written page, so it can never say one thing and print another." },
  { chapter: "record", scene: "record", spot: "record-page", action: "off", click: "[data-testid=record-choice-off]", title: "Or leave it off", body: "The usual Steel Man move. You bring it up in person, at the right time.", extra: 600 },
  { chapter: "record", scene: "record", spot: "confidence", action: "why", click: "[data-testid=confidence-meter] button", title: "How sure is each line?", body: "Source confidence says how much of the page rests on the person's own words, and why.", extra: 600 },

  { chapter: "refinery", scene: "art-tailor", zoom: 1.04, drift: 1.14, focus: [0.4, 0.45], title: "The Refinery: one free account", body: "Everything from the Forge comes along. The Application Tailor aims the resume and a cover letter at one job, from the person's own history." },
  { chapter: "refinery", scene: "art-disclosure", zoom: 1.04, drift: 1.14, focus: [0.45, 0.4], title: "Disclosure Planner", body: "When to bring up the record, what to say, and what to say next. Coaching, not legal advice." },
  { chapter: "refinery", scene: "art-practice", zoom: 1.04, drift: 1.14, focus: [0.4, 0.45], title: "Interview Practice", body: "By text, or out loud with a live voice interviewer, with feedback on what landed." },
  { chapter: "refinery", scene: "tools", zoom: 1, title: "And the rest of the job search", body: "Every tool in one place, with t.ROY on every page." },
  { chapter: "refinery", scene: "tools", spot: "tool-job-board", title: "Job Board", body: "If a job source is down, it says so, instead of telling you there are no jobs." },
  { chapter: "refinery", scene: "tools", spot: "tool-employers-that-hire", title: "Employers That Hire", body: "Dated public evidence, and a mark that expires unless someone checks it again." },
  { chapter: "refinery", scene: "tools", spot: "tool-applications", title: "Applications", body: "Saved to offer, with follow-ups that come due on time." },

  { chapter: "help", scene: "map", zoom: 1, title: "Who hires, state by state", body: "Pick a state: the law in plain words, employers we checked, and local help." },
  { chapter: "help", scene: "state-montana", spot: [0.0085, 0.0758, 0.7747, 0.1934], title: "Straight talk about the law", body: "Each state page says what the law does, and does not, do for you." },
  { chapter: "help", scene: "state-montana", spot: [0.0222, 0.7022, 0.9659, 0.2907], title: "Employers, with proof", body: "Each employer mark rests on dated public evidence." },
  { chapter: "help", scene: "state-montana", spot: [0.0222, 0.925, 0.96, 0.034], title: "Checked, and it expires", body: "The day we checked and the day the mark expires. Read the source yourself." },
  { chapter: "help", scene: "local-help", spot: [0.0, 0.255, 1.0, 0.105], title: "Help near you", body: "A ride, a meal, ID, a place to stay. Search by place and need." },
  { chapter: "help", scene: "local-help", spot: [0.0192, 0.4857, 0.2316, 0.0424], title: "Honestly labeled", body: "A means we checked the page ourselves. B means it is listed and we have not finished checking." },
  { chapter: "help", scene: "local-help", spot: [0.1583, 0.929, 0.2137, 0.0448], click: true, title: "Keep it with the plan", body: "Save a listing to the Refinery and it stays with the person's plan." },

  { chapter: "programs", scene: "org-13", spot: [0.19, 0.11, 0.79, 0.045], title: "For programs: Crucible", body: "A staff workspace beside each person. This is the demo workspace with sample data." },
  { chapter: "programs", scene: "org-13", spot: [0.28, 0.36, 0.61, 0.57], title: "Today, sorted by why", body: "Interviews coming up, people gone quiet, people who never started." },
  { chapter: "programs", scene: "org-14", spot: [0.2, 0.725, 0.76, 0.07], title: "Consent first", body: "Staff see only what each person chose to share, one item at a time. Never disclosure plans or interview answers." },
  { chapter: "programs", scene: "org-15", spot: [0.28, 0.5, 0.605, 0.42], title: "Record the outcome", body: "A placement goes on file with the date and the employer, and the person can see it." },
  { chapter: "programs", scene: "org-16", spot: [0.235, 0.24, 0.69, 0.235], title: "Proof for funders", body: "Counted only over what participants agreed to share, and ready to download." },

  { chapter: "programs", scene: "close", title: "And then what?", body: "Here's the whole road. Free for the person using it.", extra: 2500 },
];

/** Reading pace: a beat stays long enough to read its caption, never less than 3.2 s. */
export function holdMs(s: Step): number {
  const words = `${s.title} ${s.body}`.split(/\s+/).length;
  return Math.min(8000, Math.max(3200, 1500 + words * 200)) + (s.extra ?? 0);
}

export const TOOLS: Array<{ group: string; name: string; body: string; art?: string }> = [
  { group: "Build", name: "Application Tailor", art: "/walkthrough/art-refinery-tailor-02.webp", body: "Aim your resume and a cover letter at one job, built only from your own history. Your approved resume stays protected. Tailoring makes a copy." },
  { group: "Build", name: "Disclosure Planner", art: "/walkthrough/art-refinery-disclosure-03.webp", body: "Plan when to bring up your record, what to say, and what to say next. Coaching, not legal advice. Then practice saying it out loud." },
  { group: "Build", name: "Interview Practice", art: "/walkthrough/art-refinery-practice-04.webp", body: "Practice by text for the job you are going for, or out loud with a live voice interviewer. You get feedback on what landed." },
  { group: "Find work", name: "Job Board", body: "Several job sources searched at once. If a source is down, it tells you, instead of telling you there are no jobs. Employers we checked are marked." },
  { group: "Find work", name: "Employers That Hire", body: "Employers with dated public evidence that they hire people with records. Each mark shows the source, the date we checked and when it expires." },
  { group: "Find work", name: "Applications", body: "Track every application from saved to offer. When a follow-up comes due, your coach tells you and helps draft the note." },
  { group: "Find work", name: "Get support", body: "Rides, ID, a place to stay, food, and legal help with a record, close to where you live." },
  { group: "My stuff", name: "Library and Vault", body: "Everything you make is kept to reopen. The Vault holds ID, certificates and letters, encrypted, opened only from your own signed-in session." },
  { group: "My stuff", name: "Your next step", body: "Rules pick the one most useful next step. Your progress page counts real actions, not guesses." },
];

export const toolKey = (name: string) => `tool-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
