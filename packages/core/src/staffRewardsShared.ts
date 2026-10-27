/**
 * Staff rewards: the PURE, client-safe half (catalogs, limits, words, the
 * month recap). The database half is ./staffRewards (migration 111) and
 * ./directoryContribution (112).
 *
 * THE RULES (staff side build lane S6, 2026-10-27; research in the staff pass
 * L2 report, Q6 and Q7):
 *  - Off by default. A staff member turns rewards on in their own settings;
 *    an organization cannot turn them on for anyone.
 *  - Never a score on client outcomes, records, notes written or contacts
 *    made. Milestones are craft and learning facts, each earned once.
 *  - Recognition flows between people. The only board shows recognition
 *    GIVEN (a "received" board lowered helping in a 135-person study).
 *  - The best reward is time back: accepted t.ROY drafts, at a stated
 *    estimate per skill, shown as "about N hours", never as a stopwatch.
 *  - Unlocks open EXTRA tools (never basic work), and stay open once earned.
 *  - Anything with cash value is the program's call, in its own words.
 *
 * Words follow the house rules: plain, short, warm; no dashes as punctuation.
 */

/* ----------------------------------------------------------- milestones -- */

export type MilestoneGroup = "craft" | "learning" | "directory" | "team";

export interface MilestoneDef {
  key: string;
  group: MilestoneGroup;
  title: string;
  detail: string;
}

/**
 * Every milestone the database can write (111 staff_rewards_refresh, 112
 * decide_directory_contribution, and lane S5's handoff trigger). A key the
 * database writes that is not here is ignored by the screens.
 */
export const MILESTONES: readonly MilestoneDef[] = [
  { key: "first_kudos_given", group: "team", title: "You lifted someone up", detail: "You sent a colleague a good catch. That is how a team gets stronger." },
  { key: "kudos_four_weeks", group: "team", title: "A habit of thanks", detail: "You noticed good work in four different weeks." },
  { key: "recognized_by_program", group: "team", title: "Your program noticed", detail: "You said yes to a note about your work for a funder report." },
  { key: "first_referral_loop_closed", group: "craft", title: "Closed the loop", detail: "A referral of yours reached its end with the reason written down." },
  { key: "first_ask_answered", group: "craft", title: "Asked the right way", detail: "Someone said yes to an ask you sent with a clear reason." },
  { key: "first_saved_view", group: "craft", title: "Shaped your own view", detail: "You saved a view that fits how you work." },
  { key: "clear_week", group: "craft", title: "A clear week", detail: "A week with nothing past due and everything finished on time." },
  { key: "first_handoff_accepted", group: "craft", title: "Your handoff landed", detail: "Someone accepted something you found for them." },
  { key: "first_draft_accepted", group: "learning", title: "First t.ROY draft used", detail: "You used a draft t.ROY wrote for you." },
  { key: "learn_note_from_bullets", group: "learning", title: "Notes from bullets", detail: "You turned quick bullets into a full note." },
  { key: "learn_prep_me", group: "learning", title: "Prepped in a minute", detail: "You used Prep me before a meeting." },
  { key: "learn_find_help", group: "learning", title: "Found local help", detail: "You used t.ROY to find help nearby." },
  { key: "learn_funder_narrative", group: "learning", title: "Funder story from real numbers", detail: "You used a funder narrative built from your program's own numbers." },
  { key: "learn_timeline_summary", group: "learning", title: "The story so far", detail: "You used a timeline summary." },
  { key: "learn_outreach_draft", group: "learning", title: "A message that reads well", detail: "You used an outreach draft." },
  { key: "learn_caseload_digest", group: "learning", title: "Your week at a glance", detail: "You used a caseload digest." },
  { key: "learn_triage_today", group: "learning", title: "Today, sorted", detail: "You used t.ROY to sort your day." },
  { key: "learn_three_tools", group: "learning", title: "Three tools in hand", detail: "You have used three different t.ROY tools." },
  { key: "first_new_place", group: "directory", title: "Put a place on the map", detail: "A place you added passed review." },
  { key: "first_correction", group: "directory", title: "Fixed a listing", detail: "A correction you sent passed review." },
  { key: "first_verified_listing", group: "directory", title: "Checked it yourself", detail: "Your call or visit confirmed a listing." },
  { key: "first_warm_intro", group: "directory", title: "Opened a door", detail: "Someone you know helped us reach an employer." },
  { key: "research_helper", group: "directory", title: "Research helper", detail: "Your approved directory work keeps adding up." },
  { key: "research_partner", group: "directory", title: "Research partner", detail: "You are one of the people who keep this directory true." },
  { key: "directory_anchor", group: "directory", title: "Directory anchor", detail: "Your checks hold up the directory for everyone who uses it." },
] as const;

const BY_KEY = new Map(MILESTONES.map((m) => [m.key, m]));
export function milestoneDef(key: string): MilestoneDef | null {
  return BY_KEY.get(key) ?? null;
}
export const MILESTONE_GROUP_LABELS: Record<MilestoneGroup, string> = {
  team: "Lifting each other up",
  craft: "Good practice",
  learning: "Learning the tools",
  directory: "Keeping the directory true",
};

/* -------------------------------------------------------------- unlocks -- */

export type UnlockKey = "troy_month_recap" | "my_quick_prompts" | "grid_color_rules" | "directory_scout";
export interface UnlockDef {
  key: UnlockKey;
  label: string;
  detail: string;
  /** Plain words for what opens it. */
  howToEarn: string;
  opens: (earned: ReadonlySet<string>) => boolean;
}

/**
 * Extra tools, never basic work. Other lanes read hasUnlock() before showing
 * the extra (the S1 t.ROY skills, the S3 grid). An unlock stays open once
 * earned, whatever the rewards switch says: turning rewards off hides the
 * celebrations, it never takes a tool away.
 */
export const UNLOCKS: readonly UnlockDef[] = [
  {
    key: "troy_month_recap",
    label: "t.ROY writes your month",
    detail: "t.ROY drafts your month recap as a short note to your supervisor. You read it and send it yourself.",
    howToEarn: "Use three different t.ROY tools.",
    opens: (e) => e.has("learn_three_tools"),
  },
  {
    key: "my_quick_prompts",
    label: "Your own quick asks",
    detail: "Save up to five of your own one-tap asks for t.ROY.",
    howToEarn: "Use two of t.ROY's tools and keep what they wrote.",
    opens: (e) => [...e].filter((k) => k.startsWith("learn_") && k !== "learn_three_tools").length >= 2,
  },
  {
    key: "grid_color_rules",
    label: "Color rules on your grid",
    detail: "Highlight rows on your own grid by a rule you set, like due this week.",
    howToEarn: "Save a view of your own.",
    opens: (e) => e.has("first_saved_view"),
  },
  {
    key: "directory_scout",
    label: "t.ROY scouts with you",
    detail: "t.ROY drafts a directory update from a few of your words and checks what we already know first.",
    howToEarn: "Have one directory contribution approved.",
    opens: (e) => e.has("first_new_place") || e.has("first_correction") || e.has("first_verified_listing") || e.has("first_warm_intro"),
  },
] as const;

export function unlocksFor(earnedKeys: Iterable<string>): UnlockKey[] {
  const earned = new Set(earnedKeys);
  return UNLOCKS.filter((u) => u.opens(earned)).map((u) => u.key);
}
export function hasUnlock(earnedKeys: Iterable<string>, key: UnlockKey): boolean {
  return unlocksFor(earnedKeys).includes(key);
}

/* ----------------------------------------------------------- time saved -- */

/**
 * Minutes a staff member would spend doing the same thing by hand, per
 * ACCEPTED draft (saved or copied with their own click). Stated estimates,
 * kept low on purpose; the page says they are estimates.
 */
export const SKILL_MINUTES_SAVED: Readonly<Record<string, number>> = {
  "staff-note-from-bullets": 10,
  "staff-outcome-note": 8,
  "staff-prep-me": 10,
  "staff-timeline-summary": 10,
  "staff-outreach-draft": 6,
  "staff-funder-narrative": 45,
  "staff-caseload-digest": 15,
  "staff-triage-today": 5,
  "staff-find-help": 10,
  "staff-check-in": 5,
  "staff-stale-flags": 10,
  "staff-what-changed": 5,
};
export const DEFAULT_MINUTES_SAVED = 3;

export interface AcceptedRun { skill: string; acceptedAt: string }

/** Minutes saved by accepted runs inside [fromMs, toMs). */
export function minutesSaved(runs: readonly AcceptedRun[], fromMs: number, toMs: number): number {
  let total = 0;
  for (const r of runs) {
    const t = Date.parse(r.acceptedAt);
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue;
    total += SKILL_MINUTES_SAVED[r.skill] ?? DEFAULT_MINUTES_SAVED;
  }
  return total;
}

/** "about 3 hours", "about 1 hour", "about 40 minutes", or null for nothing yet. */
export function timeSavedWords(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 55) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const halfHours = Math.round(minutes / 30) / 2;
  if (halfHours <= 1) return "about 1 hour";
  return `about ${Number.isInteger(halfHours) ? halfHours : halfHours.toFixed(1)} hours`;
}

/* --------------------------------------------------------- good catches -- */

export const KUDOS_MIN = 3;
export const KUDOS_MAX = 280;
export const KUDOS_WORK_KINDS = ["task", "note", "referral", "listing", "other"] as const;
export type KudosWorkKind = (typeof KUDOS_WORK_KINDS)[number];

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Clean a good catch's words. Record words are checked by the app (staff-ai-safety) before this. */
export function cleanKudosBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = String(raw ?? "").replace(CONTROL, " ").replace(/[ \t]+/g, " ").trim();
  if (body.length < KUDOS_MIN) return { ok: false, error: "Say a few words about what they did well." };
  if (body.length > KUDOS_MAX) return { ok: false, error: `Keep it under ${KUDOS_MAX} characters.` };
  return { ok: true, body };
}

export interface NamedPerson { id: string; name: string | null }

/**
 * Participants named in a good catch, by full name or by a first name of four
 * or more letters, as a whole word with a capital (case-sensitive, so "Grace"
 * the person is found and "grace" the word is not). Pure; the caller passes
 * only the people the sender reaches, which are the only names they know.
 */
export function namesMentioned(text: string, people: readonly NamedPerson[]): string[] {
  const found = new Set<string>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const p of people) {
    const full = (p.name ?? "").trim().replace(/\s+/g, " ");
    if (!full) continue;
    const first = full.split(" ")[0];
    const tries = [full];
    if (first.length >= 4 && /^[A-Z]/.test(first)) tries.push(first);
    if (tries.some((n) => new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, "u").test(text))) found.add(p.id);
  }
  return [...found];
}

/* ------------------------------------------------------- the month recap -- */

export interface MonthRecapInput {
  /** e.g. "October 2026" */
  monthLabel: string;
  firstName: string | null;
  milestones: { key: string; earnedAt: string }[];
  kudosGiven: number;
  kudosReceived: { body: string; fromFirstName: string | null }[];
  minutesSaved: number;
  contributionsApproved: number;
  recognitionNotes: { body: string }[];
}

export interface MonthRecap { title: string; lines: string[]; text: string; empty: boolean }

/**
 * "Your month": a short recap a staff member can copy or print and share with
 * their supervisor themselves. Craft, learning, thanks, time back. Never a
 * client outcome, never a count of notes or contacts.
 */
export function buildMonthRecap(input: MonthRecapInput): MonthRecap {
  const lines: string[] = [];
  const earned = input.milestones.map((m) => milestoneDef(m.key)).filter((d): d is MilestoneDef => !!d);
  if (earned.length) lines.push(`New this month: ${earned.map((d) => d.title).join("; ")}.`);
  const saved = timeSavedWords(input.minutesSaved);
  if (saved) lines.push(`t.ROY drafts I used saved me ${saved}.`);
  if (input.kudosGiven > 0) lines.push(`I sent ${input.kudosGiven === 1 ? "one good catch" : `${input.kudosGiven} good catches`} to colleagues.`);
  for (const k of input.kudosReceived.slice(0, 3)) {
    lines.push(`${k.fromFirstName ?? "A colleague"} wrote: "${k.body}"`);
  }
  if (input.contributionsApproved > 0) {
    lines.push(`${input.contributionsApproved === 1 ? "One update" : `${input.contributionsApproved} updates`} I sent to the shared directory passed review.`);
  }
  for (const r of input.recognitionNotes.slice(0, 2)) lines.push(`Noted by my program: "${r.body}"`);
  const title = `${input.firstName ? `${input.firstName}'s` : "My"} month: ${input.monthLabel}`;
  const empty = lines.length === 0;
  if (empty) lines.push("A quiet month on this page. The work still counts.");
  return { title, lines, text: [title, "", ...lines.map((l) => `- ${l}`)].join("\n"), empty };
}

/** Start of the calendar month (UTC) for a moment, and its label. */
export function monthWindow(nowMs: number): { fromMs: number; toMs: number; label: string } {
  const d = new Date(nowMs);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const label = new Date(from).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { fromMs: from, toMs: to, label };
}

/* --------------------------------------------------- recognition notes -- */

export const RECOGNITION_MIN = 10;
export const RECOGNITION_MAX = 500;
export type RecognitionStatus = "asked" | "approved" | "declined" | "withdrawn";
export const RECOGNITION_ANSWERS: Readonly<Record<RecognitionStatus, RecognitionStatus[]>> = {
  asked: ["approved", "declined"],
  approved: ["withdrawn"],
  declined: ["approved"],
  withdrawn: [],
};
export function canAnswerRecognition(from: RecognitionStatus, to: RecognitionStatus): boolean {
  return (RECOGNITION_ANSWERS[from] ?? []).includes(to);
}
export function cleanRecognitionBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = String(raw ?? "").replace(CONTROL, " ").replace(/[ \t]+/g, " ").trim();
  if (body.length < RECOGNITION_MIN) return { ok: false, error: "Say what they did, in a sentence or two." };
  if (body.length > RECOGNITION_MAX) return { ok: false, error: `Keep it under ${RECOGNITION_MAX} characters.` };
  return { ok: true, body };
}

/* --------------------------------------------------------------- words -- */

export const REWARDS_COPY = {
  offTitle: "Wins are off",
  offBody: "Turn on Wins to see your milestones, the time t.ROY saved you, and a monthly recap you can share. It is only for you, and you can turn it off any time.",
  toggleLabel: "Show my wins",
  toggleHelp: "Milestones, time saved, and your month. Private to you. Nothing here counts notes, calls or anyone's results.",
  boardLabel: "Show my name on the thank you board",
  boardHelp: "The board lists people who thanked a colleague this month. It never shows who was thanked.",
  boardTitle: "Thanks given this month",
  boardEmpty: "Nobody on the board yet. A good catch takes ten seconds.",
  timeTitle: "Time back",
  timeHelp: "An estimate from t.ROY drafts you saved or copied. Not a stopwatch.",
  kudosTitle: "Good catches",
  kudosGiveLabel: "Send a good catch",
  kudosHelp: "Thank a colleague for a piece of work. Only the two of you see it.",
  recapTitle: "Your month",
  recapHelp: "Copy it or print it to share with your supervisor. Nothing is sent for you.",
  recognitionTitle: "Notes from your program",
  recognitionHelp: "Your program would like to mention your work in a report to a funder. It is used only if you say yes, and you can take it back.",
  programRewardsTitle: "From your program",
} as const;

/** The one line t.ROY asks after a staff member uses a listing for someone. */
export const LISTING_NUDGE_LINE = "Did this place still check out? Called them lately?";
export const LISTING_NUDGE_DAYS = 7;
