/**
 * Steel Man meter moments and rewards (memo section 5).
 *
 * Two kinds, kept apart:
 *  - Feel-good moments: a progression_grant row, kind 'milestone', calls 0,
 *    grant_key 'moment:*'. Free, can be frequent, may come from
 *    client-reported work.
 *  - Earned value: the existing grantBonus path (progression-server.ts), inside
 *    its daily and monthly caps, grant_key 'meter:*'. Only from
 *    server-recorded work (`serverCounts`), never from a client ping alone.
 *
 * UNIQUE(user_id, grant_key) (migration 092) makes every key land once on any
 * device. A capped bonus inserts nothing, so it waits and lands on a later
 * read; the copy never says a reward was lost.
 *
 * Step ids: moments never use 'tailor' or 'apply'. getProgression treats a
 * milestone on those steps as readiness for the next guided step, and a meter
 * moment must never open a step by itself.
 */
import type { ProgressionStep } from "../progression-policy";
import { MARKS, isSteelMan, scoreOf } from "./score";
import type { ComponentId } from "./types";
import type { SteelManRead } from "./read";

export interface MomentRow { key: string; step: ProgressionStep; label: string }
export interface ValueGrant { key: string; step: ProgressionStep; moment: string }

const BONUS_LINE = " Extra AI actions are yours for the next job until midnight UTC.";

export const FIRST_MOMENTS: Record<ComponentId, { step: ProgressionStep; label: string }> = {
  facts: { step: "foundation", label: "You confirmed your first work fact. Every resume you build can use it." },
  lines: { step: "foundation", label: "You explained a resume line in your own words. That line is yours to defend." },
  resumes: { step: "foundation", label: "You finished a resume. It passed every check and is ready to send." },
  lanes: { step: "foundation", label: "Your resume has a lane now. Each kind of work gets its own resume from the same true facts." },
  tailored: { step: "direction", label: "You shaped a resume to a real job. Now it speaks to the person reading it." },
  sent: { step: "direction", label: "Your first application is out. That puts you in the running." },
  practice: { step: "interview", label: "You ran your first practice interview. Every run makes the real one smaller." },
  disclosure: { step: "interview", label: "You have your words ready for the record question." },
  proof: { step: "foundation", label: "You tracked down your first record. That is a fact nobody can argue with." },
  feedback: { step: "foundation", label: "Thank you. Troy reads these." },
};
const OUTCOMES: Record<SteelManRead["outcomes"][number], { step: ProgressionStep; label: string }> = {
  heard_back: { step: "direction", label: "An employer got back to you." },
  interviewing: { step: "interview", label: "You have an interview set. Your practice is there when you want it." },
  offered: { step: "offer", label: "You got an offer. Take your time and read it through." },
  hired: { step: "offer", label: "You got hired. Congratulations." },
};
const MARK_MOMENTS: Array<{ mark: number; label: string }> = [
  { mark: MARKS.firstLoop, label: "In the game: you built it, aimed it at a real job and sent it." },
  { mark: MARKS.everyPart, label: "Covering ground: more of the Refinery is working for you." },
  { mark: MARKS.breadth, label: "Putting in work: your work is going wide and deep." },
];
export const REVIEW_MOMENT: MomentRow = { key: "moment:review-offered", step: "foundation", label: "Thank you for taking the time to leave a review." };
export const STEEL_MAN_MOMENT: MomentRow = { key: "moment:steel-man", step: "foundation", label: "Steel Man: your whole job search is built and running." };
/** Value marker read by progressionAllowance; its calls come from policy.steel_man_bonus_calls (ships 0). */
export const STEEL_MAN_ALLOWANCE: MomentRow = { key: "meter:steel-man", step: "foundation", label: "Steel Man status recorded on this account." };

/** Feel-good moments now due, in the order they should land (the last one is the one the progress bar celebrates). */
export function momentsDue(read: Pick<SteelManRead, "counts" | "forgeArrival" | "packageDelivered" | "outcomes" | "firstVoicePractice">): MomentRow[] {
  const rows: MomentRow[] = [];
  if (read.forgeArrival) rows.push({ key: "moment:forge-arrival", step: "foundation", label: "You built this in the Forge. It counts." });
  for (const [id, m] of Object.entries(FIRST_MOMENTS) as Array<[ComponentId, { step: ProgressionStep; label: string }]>) {
    if ((read.counts[id] ?? 0) >= 1) rows.push({ key: `moment:first:${id}`, ...m });
  }
  if (read.firstVoicePractice) rows.push({ key: "moment:first-voice-practice", step: "interview", label: "You practiced out loud." });
  if (read.packageDelivered) rows.push({ key: "moment:package-delivered", step: "foundation", label: "Your resume is in your inbox. You can send it from anywhere." });
  for (const o of read.outcomes) rows.push({ key: `moment:outcome:${o}`, ...OUTCOMES[o] });
  const score = scoreOf(read.counts);
  for (const m of MARK_MOMENTS) if (score >= m.mark) rows.push({ key: `moment:mark:${m.mark}`, step: "foundation", label: m.label });
  if (isSteelMan(read.counts)) rows.push(STEEL_MAN_MOMENT);
  return rows;
}

/** Earned value now due, from server-recorded work only (memo 5). */
export function valueDue(read: Pick<SteelManRead, "serverCounts" | "firstVoicePractice" | "planExists">): ValueGrant[] {
  const out: ValueGrant[] = [];
  const serverScore = scoreOf(read.serverCounts);
  for (const m of MARK_MOMENTS) if (serverScore >= m.mark) out.push({ key: `meter:mark:${m.mark}`, step: "foundation", moment: `moment:mark:${m.mark}` });
  if (read.firstVoicePractice) out.push({ key: "meter:first-voice-practice", step: "interview", moment: "moment:first-voice-practice" });
  if (read.planExists) out.push({ key: "meter:first-disclosure-plan", step: "interview", moment: "moment:first:disclosure" });
  return out;
}

/**
 * One INSERT for every due moment. Rows that already exist are skipped by
 * UNIQUE(user_id, grant_key). created_at steps by a millisecond per row so the
 * order is stable and the progress bar celebrates the last one.
 */
export function milestoneInsert(userId: string, rows: MomentRow[]): { text: string; params: unknown[] } {
  return {
    text: `INSERT INTO progression_grant(user_id,grant_key,kind,step_id,calls,label,created_at)
 SELECT $1::uuid,t.k,'milestone',t.s,0,t.l,now()+(t.o*interval '1 millisecond')
 FROM jsonb_to_recordset($2::jsonb) AS t(k text,s text,l text,o int)
 ON CONFLICT (user_id,grant_key) DO NOTHING RETURNING grant_key`,
    params: [userId, JSON.stringify(rows.map((r, o) => ({ k: r.key, s: r.step, l: r.label.slice(0, 200), o })))],
  };
}

export interface MomentDeps {
  insertMilestones: (userId: string, rows: MomentRow[]) => Promise<string[]>;
  grantBonus: (userId: string, key: string, step: ProgressionStep) => Promise<boolean>;
}

/** Bonus attempts per read. The daily cap allows two grants, so a third attempt would only fail. */
const BONUS_ATTEMPTS_PER_READ = 2;

/**
 * Record every moment and earned reward now due. Idempotent: run it twice on
 * the same work and nothing new lands the second time. Returns the moment
 * keys this call recorded.
 */
export async function awardMoments(userId: string, read: SteelManRead, deps?: MomentDeps): Promise<string[]> {
  const d = deps ?? (await realDeps());
  const bonusNow = new Set<string>();
  let attempts = 0;
  for (const v of valueDue(read)) {
    if (read.grantKeys.has(v.key) || attempts >= BONUS_ATTEMPTS_PER_READ) continue;
    attempts++;
    if (await d.grantBonus(userId, v.key, v.step)) bonusNow.add(v.moment);
    else break;
  }
  const rows: MomentRow[] = [];
  if (isSteelMan(read.serverCounts) && !read.grantKeys.has(STEEL_MAN_ALLOWANCE.key)) rows.push(STEEL_MAN_ALLOWANCE);
  for (const m of momentsDue(read)) {
    if (read.grantKeys.has(m.key)) continue;
    rows.push(bonusNow.has(m.key) ? { ...m, label: (m.label + BONUS_LINE).slice(0, 200) } : m);
  }
  if (!rows.length) return [];
  return d.insertMilestones(userId, rows);
}

async function realDeps(): Promise<MomentDeps> {
  const [{ queryAsUser }, { grantBonus }] = await Promise.all([import("@crucible/core"), import("../progression-server")]);
  return {
    insertMilestones: async (userId, rows) => {
      const q = milestoneInsert(userId, rows);
      const out = await queryAsUser<{ grant_key: string }>(userId, q.text, q.params);
      return out.map((r) => r.grant_key);
    },
    grantBonus: (userId, key, step) => grantBonus(userId, key, step),
  };
}
