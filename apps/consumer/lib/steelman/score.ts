/**
 * Steel Man meter scoring. Pure: no database, no clock reads except where a
 * caller passes `now`. Every constant below names where it comes from.
 *
 * Source: the R1 meter-science memo (2026-10-23), sections 3 and 4.
 * "DESIGN HYPOTHESIS" marks a constant the memo says has no source (an
 * estimate or an inference). Re-tune each one after two months of real data,
 * by the same rule, and update the tests that pin the derived values.
 *
 * The meter counts work done. It never predicts hiring and never reads the
 * person's record (memo 7, rules 1 and 8).
 */
import { COMPONENT_IDS, type BandId, type ComponentCounts, type ComponentId, type ComponentView, type DatedUnit, type GainOption, type SteelManRequirement, type WeekStreak } from "./types";

interface ComponentSpec {
  label: string;
  /** Typical minutes for the first unit (memo 3.2, t_k). */
  minutes: number;
  /** 1.3 for self-presentation and real job-search behavior (memo 3.2, m_k, from E16). */
  multiplier: number;
  /** Cap N_k: past it a unit adds nothing (memo 3.2 and 3.4). */
  cap: number;
  why: string;
  href: string;
  /** The next unit, as an action the person can choose. */
  action: (count: number) => string;
  unit: [string, string];
}

/**
 * DESIGN HYPOTHESIS (all `minutes` values): the memo's own estimates of the
 * typical minutes for a first unit ("These are my estimates. Replace them with
 * measured medians once timestamps allow", memo 3.2 and Q5).
 *
 * DESIGN HYPOTHESIS (multiplier 1.3): the memo picks 1.3 for the three
 * components E16 names as active parts of job-search programs (self-
 * presentation and real job-search behavior). The direction has a source
 * (Liu, Huang, Wang 2014); the size 1.3 does not.
 *
 * Caps: facts 40 is the code cap (lib/master-draft.ts slices at 40). Every
 * other cap except lines is the memo 3.4 saturation count, the first count
 * whose own unit adds under 1 point. Tests recompute them.
 * DESIGN HYPOTHESIS (lines cap 28): the memo table sets 28 for lines with no
 * stated rule (its saturation count is 9). Kept as written so the memo's
 * worked examples and the 532 ceiling hold.
 */
export const COMPONENTS: Record<ComponentId, ComponentSpec> = {
  facts: { label: "Work facts", minutes: 3, multiplier: 1, cap: 40, href: "/dashboard/master", unit: ["fact", "facts"],
    why: "Every true detail you confirm about your work makes every resume stronger.",
    action: () => "Confirm one more work fact in your Master Draft" },
  lines: { label: "Lines you stand behind", minutes: 2, multiplier: 1, cap: 28, href: "/dashboard/vault", unit: ["line", "lines"],
    why: "Each line you can explain in your own words is a line you can defend in an interview.",
    action: () => "Explain one more resume line in your own words" },
  resumes: { label: "Finished resumes", minutes: 45, multiplier: 1, cap: 6, href: "/dashboard/vault", unit: ["resume", "resumes"],
    why: "A finished resume passed every check and is ready to send.",
    action: (n) => n === 0 ? "Finish your first resume" : "Finish another resume" },
  lanes: { label: "Lanes in use", minutes: 10, multiplier: 1, cap: 4, href: "/dashboard/vault", unit: ["lane", "lanes"],
    why: "Each kind of work you aim at gets its own resume, built from the same true facts.",
    action: (n) => n === 0 ? "Put a resume in a lane for the work you want" : "Start a resume for another kind of work" },
  tailored: { label: "Tailored to a real job", minutes: 20, multiplier: 1, cap: 12, href: "/dashboard/application-tailor", unit: ["job", "jobs"],
    why: "A resume shaped to one real job speaks to the person reading it.",
    action: () => "Shape a resume to one real job" },
  sent: { label: "Applications sent", minutes: 15, multiplier: 1.3, cap: 25, href: "/dashboard/applications", unit: ["application", "applications"],
    why: "Every application you send puts you in the running.",
    action: (n) => n === 0 ? "Record your first application" : "Record one more application you sent" },
  practice: { label: "Interview practice", minutes: 15, multiplier: 1.3, cap: 10, href: "/dashboard/interview", unit: ["session", "sessions"],
    why: "Practicing out loud makes the real interview smaller.",
    action: () => "Practice an interview out loud" },
  disclosure: { label: "Disclosure ready", minutes: 25, multiplier: 1.3, cap: 5, href: "/dashboard/disclosure", unit: ["step", "steps"],
    why: "Having your words ready for the record question puts you in control of it.",
    action: (n) => n === 0 ? "Build your disclosure plan" : "Rehearse your words out loud" },
  proof: { label: "Proof gathered", minutes: 10, multiplier: 1, cap: 8, href: "/dashboard/documents", unit: ["document", "documents"],
    why: "Every proof document you track down is a fact nobody can argue with.",
    action: () => "Add one proof document" },
  feedback: { label: "Feedback offered", minutes: 5, multiplier: 1, cap: 4, href: "/dashboard", unit: ["note", "notes"],
    why: "Telling us what worked and what broke makes this better for the next person.",
    action: () => "Tell us what worked and what broke" },
};

/**
 * DESIGN HYPOTHESIS (scale 4): only sets the scale, so the smallest unit (one
 * defended line, 2 minutes) is worth a felt 6 points (memo 3.2).
 */
export const WEIGHT_SCALE = 4;

/** f_k = round(4 x sqrt(t_k) x m_k): the first unit's points (memo 3.2). */
export function firstUnit(id: ComponentId): number {
  const c = COMPONENTS[id];
  return Math.round(WEIGHT_SCALE * Math.sqrt(c.minutes) * c.multiplier);
}

/** c_k(n) = f_k x log2(1 + min(n, N_k)) (memo 3.1). Never negative. */
export function componentPoints(id: ComponentId, n: number): number {
  const units = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return firstUnit(id) * Math.log2(1 + Math.min(units, COMPONENTS[id].cap));
}

/** Points the next unit would add (0 at the cap). */
export function marginalPoints(id: ComponentId, n: number): number {
  return componentPoints(id, n + 1) - componentPoints(id, n);
}

/** Memo 3.4 saturation: the first count whose own unit adds under 1 point, capped. Facts 10, lines 9. */
export function saturationCount(id: ComponentId): number {
  return countWhereUnitBelow(id, 1);
}

/**
 * The first count n (1 or more) whose own unit, the n-th, is worth less than
 * `threshold`, capped at N_k. This is the memo's rule f_k x log2((n+1)/n) <
 * threshold, used for saturation (3.4) and for marks M3 and M4 (4.1). It
 * reproduces the memo's breadth points (resumes 3, tailored 2, sent 2,
 * practice 2, disclosure 2, the rest 1).
 */
export function countWhereUnitBelow(id: ComponentId, threshold: number): number {
  const cap = COMPONENTS[id].cap;
  let n = 1;
  while (n < cap && marginalPoints(id, n - 1) >= threshold) n++;
  return n;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const sumPointsAt = (counts: (id: ComponentId) => number) => COMPONENT_IDS.reduce((sum, id) => sum + componentPoints(id, counts(id)), 0);

/** The score ceiling: every component at its cap. Memo: 532. */
export const MAX_SCORE = Math.round(sumPointsAt((id) => COMPONENTS[id].cap));

/**
 * The four marks, derived from the curve (memo 4.1), never round numbers.
 * M1 = the first loop: first finished resume + first tailored + first sent (65).
 * M2 = every component started once: the sum of all f_k (159).
 * M3 = every component at its breadth point, the count past which the next
 *      unit is worth less than the median first-unit value (235).
 * M4 = every component at its depth point, the count past which the next unit
 *      is worth less than the smallest first unit (375).
 */
export const MEDIAN_FIRST_UNIT = median(COMPONENT_IDS.map(firstUnit));
export const SMALLEST_FIRST_UNIT = Math.min(...COMPONENT_IDS.map(firstUnit));
export const MARKS = {
  firstLoop: firstUnit("resumes") + firstUnit("tailored") + firstUnit("sent"),
  everyPart: COMPONENT_IDS.reduce((sum, id) => sum + firstUnit(id), 0),
  breadth: Math.round(sumPointsAt((id) => countWhereUnitBelow(id, MEDIAN_FIRST_UNIT))),
  depth: Math.round(sumPointsAt((id) => countWhereUnitBelow(id, SMALLEST_FIRST_UNIT))),
} as const;

/** Band names, plain and blunt, no metals (memo 4.2). The `why` lines talk about the work, never the person (memo 7, rule 2). */
export const BANDS: Array<{ id: BandId; from: number; label: string; why: string }> = [
  { id: "showing_up", from: 0, label: "Showing up", why: "You started. Every piece of real work moves this bar." },
  { id: "in_the_game", from: MARKS.firstLoop, label: "In the game", why: "You built a resume, aimed it at a real job and sent it." },
  // The in_the_game line above claims the first loop; bandWhy() swaps in IN_THE_GAME_NEUTRAL when it has not happened (boss S3).
  { id: "covering_ground", from: MARKS.everyPart, label: "Covering ground", why: "More of the Refinery is working for you." },
  { id: "putting_in_work", from: MARKS.breadth, label: "Putting in work", why: "Your work is going wide and deep." },
  { id: "steel_man", from: MARKS.depth, label: "Steel Man", why: "Your whole job search is built and running." },
];

export function scoreOf(counts: ComponentCounts): number {
  return Math.round(sumPointsAt((id) => counts[id] ?? 0));
}

/**
 * Steel Man requirement set (memo 4.3, boss rulings Q2 and Q3 of 2026-10-23).
 * A Google review is NOT a requirement: Steel Man raises the AI allowance,
 * and anything of value tied to a review breaks review-site rules. The
 * review tick is a feel-good moment only (Q2).
 */
export const STEEL_MAN_MIN_FACTS = saturationCount("facts"); // 10, memo 3.4
export const STEEL_MAN_MIN_LINES = saturationCount("lines"); // 9, memo 3.4
export const STEEL_MAN_MIN_LANES = 2; // Q3: "several" in plain English
export const STEEL_MAN_MIN_RESUMES = countWhereUnitBelow("resumes", MEDIAN_FIRST_UNIT); // 3, the resume breadth point

export function steelManRequirements(counts: ComponentCounts): SteelManRequirement[] {
  const n = (id: ComponentId) => counts[id] ?? 0;
  const score = scoreOf(counts);
  const untouched = COMPONENT_IDS.filter((id) => n(id) < 1).map((id) => COMPONENTS[id].label.toLowerCase());
  const more = (k: number, unit: [string, string]) => `${k} more ${k === 1 ? unit[0] : unit[1]}`;
  return [
    { id: "score", label: `A score of ${MARKS.depth} or more`, done: score >= MARKS.depth, left: `${more(MARKS.depth - score, ["point", "points"])}` },
    { id: "facts", label: `At least ${STEEL_MAN_MIN_FACTS} confirmed work facts`, done: n("facts") >= STEEL_MAN_MIN_FACTS, left: more(STEEL_MAN_MIN_FACTS - n("facts"), ["fact", "facts"]) },
    { id: "lines", label: `At least ${STEEL_MAN_MIN_LINES} lines you stand behind on a finished resume`, done: n("lines") >= STEEL_MAN_MIN_LINES, left: more(STEEL_MAN_MIN_LINES - n("lines"), ["line", "lines"]) },
    { id: "breadth", label: `${STEEL_MAN_MIN_LANES} lanes in use, or ${STEEL_MAN_MIN_RESUMES} finished resumes`, done: n("lanes") >= STEEL_MAN_MIN_LANES || n("resumes") >= STEEL_MAN_MIN_RESUMES,
      left: `${more(STEEL_MAN_MIN_LANES - n("lanes"), ["lane", "lanes"])} with a resume in it, or ${more(STEEL_MAN_MIN_RESUMES - n("resumes"), ["finished resume", "finished resumes"])}` },
    { id: "every_part", label: "Work in all ten parts of the meter", done: untouched.length === 0, left: `Not started yet: ${untouched.join(", ")}` },
    { id: "feedback", label: "Honest feedback shared with us", done: n("feedback") >= 1, left: "Tell us what worked and what broke" },
  ].map((r) => (r.done ? { ...r, left: "" } : r));
}

export function isSteelMan(counts: ComponentCounts): boolean {
  return steelManRequirements(counts).every((r) => r.done);
}

/**
 * The band. Score sets it; Steel Man also needs every requirement (memo 4.2:
 * "Someone at 375 or more who has not met every requirement stays in
 * Putting in work"). `steelManHeld` keeps a status already earned (memo 5:
 * "a permanent Steel Man mark").
 */
export function bandFor(score: number, steelMan: boolean) {
  if (steelMan) return BANDS[4];
  for (let i = 3; i >= 0; i--) if (score >= BANDS[i].from) return BANDS[i];
  return BANDS[0];
}

export const IN_THE_GAME_NEUTRAL = "Your work is adding up. The first finished, tailored and sent resume is the loop this mark stands for.";
/** The band's line, true to this person's work: never claims a sent application that does not exist. */
export function bandWhy(band: { id: BandId; why: string }, counts: ComponentCounts): string {
  if (band.id !== "in_the_game") return band.why;
  return (counts.resumes ?? 0) >= 1 && (counts.tailored ?? 0) >= 1 && (counts.sent ?? 0) >= 1 ? band.why : IN_THE_GAME_NEUTRAL;
}

export function nextMark(score: number, steelMan: boolean): { score: number; label: string; pointsAway: number } | null {
  if (steelMan) return null;
  const next = BANDS.slice(1).find((b) => score < b.from) ?? BANDS[4];
  return { score: next.from, label: next.label, pointsAway: Math.max(0, next.from - score) };
}

export function componentViews(counts: ComponentCounts): ComponentView[] {
  return COMPONENT_IDS.map((id) => {
    const c = COMPONENTS[id];
    const count = Math.max(0, Math.floor(counts[id] ?? 0));
    return { id, label: c.label, value: Math.round(componentPoints(id, count)), max: Math.round(componentPoints(id, c.cap)), weight: firstUnit(id), count, cap: c.cap, why: c.why, href: c.href };
  });
}

/**
 * What moves the needle next (memo 3.3 and 6.2): every component's next unit,
 * sorted by points gained per estimated minute. Ties break toward components
 * with zero units, so breadth comes first. Capped components are left out.
 */
export function gainOptions(counts: ComponentCounts): GainOption[] {
  return COMPONENT_IDS.flatMap((id) => {
    const n = Math.max(0, Math.floor(counts[id] ?? 0));
    const points = marginalPoints(id, n);
    if (points <= 0) return [];
    const c = COMPONENTS[id];
    const rounded = Math.max(1, Math.round(points));
    return [{ id, points: rounded, minutes: c.minutes, perMinute: points / c.minutes, href: c.href,
      label: `${c.action(n)}: +${rounded} ${rounded === 1 ? "point" : "points"}, about ${c.minutes} minutes.` }];
  }).sort((a, b) => b.perMinute - a.perMinute || ((counts[a.id] ?? 0) === 0 ? -1 : 0) - ((counts[b.id] ?? 0) === 0 ? -1 : 0));
}

export function nextGain(counts: ComponentCounts): { label: string; href: string } {
  const best = gainOptions(counts)[0];
  return best ? { label: best.label, href: best.href } : { label: "Every part of the meter is full. Keep using the tools for each new job.", href: "/dashboard" };
}

// ─── Time views: the 30-day strip and the week streak ───────────────────────

/** DESIGN HYPOTHESIS (UTC days and Monday-start UTC weeks): the memo sets no time zone. Evening work in Montana can land on the next UTC day. */
const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : Math.floor(t / DAY_MS); };
const dayIso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Units landed per UTC day for the last `span` days, oldest first. Days with no work are zero, never a mark against anyone. */
export function dailyUnits(units: DatedUnit[], now: Date, span = 30): Array<{ day: string; units: number }> {
  const today = Math.floor(now.getTime() / DAY_MS);
  const counts = new Map<number, number>();
  for (const u of units) { const d = dayNumber(u.at); if (d !== null && d > today - span && d <= today) counts.set(d, (counts.get(d) ?? 0) + 1); }
  return Array.from({ length: span }, (_, i) => { const d = today - span + 1 + i; return { day: dayIso(d), units: counts.get(d) ?? 0 }; });
}

/**
 * DESIGN HYPOTHESIS (weeks, not days): the memo infers weeks suit people who
 * juggle shifts, supervision visits and spotty internet; no source tests
 * weeks against days (memo 5, "Streak").
 * DESIGN HYPOTHESIS (2 reserve weeks per rolling 8): from the emergency-
 * reserve finding (E9) and repairable streaks (E8); the numbers are inference.
 */
export const RESERVE_WEEKS = 2;
export const RESERVE_WINDOW_WEEKS = 8;
/** Show the streak only at 2 or more (memo 5). */
export const STREAK_SHOW_FROM = 2;

/** Monday-start UTC week number. Day 0 (1970-01-01) was a Thursday. */
const weekOf = (day: number) => Math.floor((day + 3) / 7);

/**
 * Active weeks in a row, ending this week. An active week has at least one
 * scored unit. The current week never breaks the run while it is still open.
 * A quiet week spends a reserve; a run stops only when a quiet week finds no
 * reserve left in its 8-week window. A stopped run is never shown as broken:
 * the page simply shows no streak until there are 2 weeks again.
 */
export function weekStreak(dates: string[], now: Date): WeekStreak {
  const current = weekOf(Math.floor(now.getTime() / DAY_MS));
  const active = new Set(dates.map(dayNumber).filter((d): d is number => d !== null).map(weekOf).filter((w) => w <= current));
  if (active.size === 0) return { weeks: 0, reserveLeft: RESERVE_WEEKS, show: false };
  const earliest = Math.min(...active);
  const skips: number[] = [];
  let weeks = 0;
  for (let w = active.has(current) ? current : current - 1; w >= earliest; w--) {
    if (active.has(w)) { weeks++; continue; }
    if (skips.filter((s) => s - w < RESERVE_WINDOW_WEEKS).length >= RESERVE_WEEKS) break;
    skips.push(w);
  }
  const reserveLeft = Math.max(0, RESERVE_WEEKS - skips.filter((s) => current - s < RESERVE_WINDOW_WEEKS).length);
  return { weeks, reserveLeft, show: weeks >= STREAK_SHOW_FROM };
}
