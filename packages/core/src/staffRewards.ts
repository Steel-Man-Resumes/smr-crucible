/**
 * Staff rewards: the database half (migration 111, staff side lane S6). See
 * staffRewardsShared.ts for the rules.
 *
 * Everything runs through runScoped as the staff member, so the 111 policies
 * and guards decide what is read and written: your own switch, good catches
 * only you and the colleague can read (and only while you both reach the
 * person the work was about), milestones only the database writes, and
 * recognition notes only the person they are about can say yes to.
 *
 * A platform admin viewing an organization they are not a member of gets
 * nothing here and writes nothing (viaPlatformAdmin).
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  buildMonthRecap, cleanKudosBody, cleanRecognitionBody, milestoneDef, minutesSaved, monthWindow, unlocksFor,
  KUDOS_WORK_KINDS, type AcceptedRun, type KudosWorkKind, type MonthRecap, type NamedPerson, type RecognitionStatus, type UnlockKey,
} from "./staffRewardsShared";

export * from "./staffRewardsShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || null;
const isManager = (a: OrgActor) => a.role === "owner" || a.role === "org_admin";

/** One statement as the actor; returns its rows. */
async function one<T>(actor: OrgActor, text: string, params: unknown[]): Promise<T[]> {
  const [rows] = await runScoped<[T[]]>(scopeOf(actor), (sql) => [run(sql)(text, params)]);
  return rows ?? [];
}

/** Turn a database refusal into a short reason; anything else is rethrown. */
function refusal(e: unknown): string | null {
  const msg = String((e as { message?: string })?.message ?? "");
  const code = String((e as { code?: string })?.code ?? "");
  if (code === "42501" || code === "23514" || /row-level security|permission denied|check constraint/i.test(msg)) {
    // The guard messages are written for people; keep them, drop the rest.
    const m = /^(?:ERROR:\s*)?([a-z][^\n]{4,160})$/i.exec(msg.trim());
    return m && !/violates|permission denied|row-level/i.test(m[1]) ? m[1] : "That could not be saved.";
  }
  return null;
}

/* ------------------------------------------------------------ settings -- */

export interface RewardsSettings { rewardsOn: boolean; boardOk: boolean }
export const DEFAULT_REWARDS_SETTINGS: RewardsSettings = { rewardsOn: false, boardOk: true };

/** This person's own switch. No row means off. */
export async function getRewardsSettings(actor: OrgActor): Promise<RewardsSettings> {
  if (actor.viaPlatformAdmin) return { ...DEFAULT_REWARDS_SETTINGS };
  const rows = await one<{ rewards_on: boolean; board_ok: boolean }>(actor,
    `SELECT rewards_on, board_ok FROM staff_rewards_setting WHERE user_id = $1::uuid AND access_code_id = $2::uuid`, [actor.userId, actor.orgId]);
  return rows[0] ? { rewardsOn: !!rows[0].rewards_on, boardOk: !!rows[0].board_ok } : { ...DEFAULT_REWARDS_SETTINGS };
}

/** Typed accessor for other lanes (S1 suggestions, S2 My setup): is this person's Wins switch on? Default off. */
export async function rewardsOn(actor: OrgActor): Promise<boolean> {
  try { return (await getRewardsSettings(actor)).rewardsOn; } catch { return false; }
}

/** Only the person sets their own switch (the 111 guard refuses anyone else). */
export async function setRewardsSettings(actor: OrgActor, input: Partial<RewardsSettings>): Promise<RewardsSettings | null> {
  if (actor.viaPlatformAdmin) return null;
  const current = await getRewardsSettings(actor);
  const next: RewardsSettings = {
    rewardsOn: typeof input.rewardsOn === "boolean" ? input.rewardsOn : current.rewardsOn,
    boardOk: typeof input.boardOk === "boolean" ? input.boardOk : current.boardOk,
  };
  await one(actor,
    `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on, board_ok) VALUES ($1::uuid, $2::uuid, $3, $4)
     ON CONFLICT (user_id, access_code_id) DO UPDATE SET rewards_on = EXCLUDED.rewards_on, board_ok = EXCLUDED.board_ok`,
    [actor.userId, actor.orgId, next.rewardsOn, next.boardOk]);
  return next;
}

export interface ProgramRewards { teamBoardOn: boolean; recognitionNotesOn: boolean; programRewards: string | null; canEdit: boolean }

export async function getProgramRewards(actor: OrgActor): Promise<ProgramRewards> {
  const rows = actor.viaPlatformAdmin ? [] : await one<{ team_board_on: boolean; recognition_notes_on: boolean; program_rewards: string | null }>(actor,
    `SELECT team_board_on, recognition_notes_on, program_rewards FROM staff_rewards_org WHERE access_code_id = $1::uuid`, [actor.orgId]);
  const r = rows[0];
  return {
    teamBoardOn: r ? !!r.team_board_on : true,
    recognitionNotesOn: r ? !!r.recognition_notes_on : true,
    programRewards: r?.program_rewards ?? null,
    canEdit: !actor.viaPlatformAdmin && isManager(actor),
  };
}

/** Owner or org admin: the team board, recognition notes, and the program's own words for any cash-value reward. */
export async function setProgramRewards(actor: OrgActor, input: { teamBoardOn?: boolean; recognitionNotesOn?: boolean; programRewards?: string | null }):
  Promise<{ ok: true; value: ProgramRewards } | { ok: false; reason: string }> {
  if (actor.viaPlatformAdmin || !isManager(actor)) return { ok: false, reason: "Only the owner or an org admin changes this." };
  const cur = await getProgramRewards(actor);
  const words = input.programRewards === undefined ? cur.programRewards
    : (String(input.programRewards ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || null);
  if (words && words.length > 500) return { ok: false, reason: "Keep it under 500 characters." };
  const next = {
    teamBoardOn: typeof input.teamBoardOn === "boolean" ? input.teamBoardOn : cur.teamBoardOn,
    recognitionNotesOn: typeof input.recognitionNotesOn === "boolean" ? input.recognitionNotesOn : cur.recognitionNotesOn,
  };
  try {
    await one(actor,
      `INSERT INTO staff_rewards_org (access_code_id, team_board_on, recognition_notes_on, program_rewards) VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (access_code_id) DO UPDATE SET team_board_on = EXCLUDED.team_board_on, recognition_notes_on = EXCLUDED.recognition_notes_on, program_rewards = EXCLUDED.program_rewards`,
      [actor.orgId, next.teamBoardOn, next.recognitionNotesOn, words]);
  } catch (e) {
    const r = refusal(e);
    if (r) return { ok: false, reason: r };
    throw e;
  }
  return { ok: true, value: { ...next, programRewards: words, canEdit: true } };
}

/* ---------------------------------------------------------- milestones -- */

export interface EarnedMilestone { key: string; title: string; detail: string; group: string; earnedAt: string; seen: boolean }

/** Ask the database to award what the facts already show (111 staff_rewards_refresh). Returns how many were new. */
export async function refreshMilestones(actor: OrgActor): Promise<number> {
  if (actor.viaPlatformAdmin) return 0;
  const rows = await one<{ n: number }>(actor, `SELECT public.staff_rewards_refresh() AS n`, []);
  return Number(rows[0]?.n ?? 0);
}

export async function listMyMilestones(actor: OrgActor): Promise<EarnedMilestone[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ key: string; earned_at: string; seen_at: string | null }>(actor,
    `SELECT key, earned_at::text, seen_at::text FROM staff_milestone WHERE user_id = $1::uuid AND access_code_id = $2::uuid ORDER BY earned_at DESC`,
    [actor.userId, actor.orgId]);
  return rows.flatMap((r) => {
    const d = milestoneDef(r.key);
    return d ? [{ key: r.key, title: d.title, detail: d.detail, group: d.group, earnedAt: r.earned_at, seen: !!r.seen_at }] : [];
  });
}

export async function markMilestonesSeen(actor: OrgActor, keys: readonly string[]): Promise<number> {
  const clean = keys.filter((k) => /^[a-z][a-z0-9_]{2,40}$/.test(k)).slice(0, 50);
  if (actor.viaPlatformAdmin || clean.length === 0) return 0;
  const rows = await one<{ key: string }>(actor,
    `UPDATE staff_milestone SET seen_at = now() WHERE user_id = $1::uuid AND access_code_id = $2::uuid AND key = ANY($3::text[]) AND seen_at IS NULL RETURNING key`,
    [actor.userId, actor.orgId, clean]);
  return rows.length;
}

/** The extra tools this person has opened (other lanes check before showing them). */
export async function staffUnlocks(actor: OrgActor): Promise<UnlockKey[]> {
  try { return unlocksFor((await listMyMilestones(actor)).map((m) => m.key)); } catch { return []; }
}

/* -------------------------------------------------------- good catches -- */

export interface Colleague { userId: string; firstName: string | null; name: string | null }

/** Everyone on this organization's staff (and its owner) except me. Names only. */
export async function listColleagues(actor: OrgActor): Promise<Colleague[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ user_id: string; name: string | null }>(actor,
    `SELECT u.id AS user_id, u.name FROM users u
      WHERE u.id <> $2::uuid AND (u.id IN (SELECT s.user_id FROM org_staff s WHERE s.access_code_id = $1::uuid)
                                  OR u.id = (SELECT a.partner_user_id FROM access_code a WHERE a.id = $1::uuid))
      ORDER BY u.name NULLS LAST LIMIT 500`,
    [actor.orgId, actor.userId]);
  return rows.map((r) => ({ userId: r.user_id, name: r.name, firstName: firstName(r.name) }));
}

/** The participants this person reaches, with names, for the "no names unless you both can see them" check. */
export async function reachableParticipantNames(actor: OrgActor): Promise<NamedPerson[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ id: string; name: string | null }>(actor,
    `SELECT r.user_id AS id, u.name FROM access_code_redemption r JOIN users u ON u.id = r.user_id
      WHERE r.access_code_id = $1::uuid AND public.smr_staff_reach($1::uuid, $2::uuid, r.user_id) LIMIT 5000`,
    [actor.orgId, actor.userId]);
  return rows;
}

/**
 * Which participants THIS staff member reaches does the text name? The 111
 * definer function (review round 2): a full name in any case, or a single
 * first or last name of 3+ letters that is not an ordinary word and is
 * written with a capital. Nobody outside the writer's reach is checked, so
 * the answer says nothing about who else is in the program.
 */
export async function participantNamesIn(actor: OrgActor, text: string): Promise<{ reached: string[] }> {
  if (actor.viaPlatformAdmin || !String(text ?? "").trim()) return { reached: [] };
  const rows = await one<{ reached: string[] | null }>(actor,
    `SELECT reached FROM public.staff_text_participant_names($1)`, [String(text)]);
  return { reached: (rows[0]?.reached ?? []).map((x) => String(x).toLowerCase()) };
}

export const NAME_REFUSAL = "Leave people's names out. To thank someone for work about a person, send it from that person's own task, note or referral, so we can check you both can see them.";

export interface KudosInput { toUserId: string; body: string; workKind?: KudosWorkKind | null; workId?: string | null }

/**
 * Send a good catch. The app has already put the words through the record
 * gate. Any participant name in the words (participantNamesIn, every
 * participant of the organization) is allowed only when it is the person the
 * linked task, note or referral is about; the database then checks that both
 * colleagues reach them.
 */
export async function giveKudos(actor: OrgActor, input: KudosInput):
  Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (actor.viaPlatformAdmin) return { ok: false, reason: "Nothing is sent while you are viewing as someone else." };
  const body = cleanKudosBody(input.body);
  if (!body.ok) return { ok: false, reason: body.error };
  if (!UUID.test(String(input.toUserId ?? ""))) return { ok: false, reason: "Pick a colleague." };
  if (input.toUserId.toLowerCase() === actor.userId.toLowerCase()) return { ok: false, reason: "Pick a colleague, not yourself." };
  const kind = input.workKind && (KUDOS_WORK_KINDS as readonly string[]).includes(input.workKind) ? input.workKind : null;
  const workId = input.workId && UUID.test(input.workId) ? input.workId : null;
  if (input.workId && !workId) return { ok: false, reason: "That piece of work was not found." };
  if (workId && !kind) return { ok: false, reason: "Say what kind of work this was." };
  if (kind === "other" && workId) return { ok: false, reason: "Other work is not linked. Leave the link out." };
  const mentioned = (await participantNamesIn(actor, body.body)).reached;
  if (mentioned.length > 0) {
    // A name is allowed only for the person the linked work is about (read as
    // the sender, so reach applies); the database then checks the receiver too.
    const table = kind === "task" ? "staff_task" : kind === "note" ? "case_note" : kind === "referral" ? "referral" : null;
    const col = kind === "referral" ? "participant_user_id" : "client_user_id";
    if (!workId || !table) {
      return { ok: false, reason: NAME_REFUSAL };
    }
    const about = await one<{ p: string | null }>(actor, `SELECT ${col} AS p FROM ${table} WHERE id = $1::uuid AND access_code_id = $2::uuid`, [workId, actor.orgId]);
    const who = String(about[0]?.p ?? "").toLowerCase();
    if (!who || mentioned.some((m) => m.toLowerCase() !== who)) {
      return { ok: false, reason: NAME_REFUSAL };
    }
  }
  try {
    const rows = await one<{ id: string }>(actor,
      `INSERT INTO staff_kudos (access_code_id, from_user_id, to_user_id, body, work_kind, work_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid) RETURNING id`,
      [actor.orgId, actor.userId, input.toUserId, body.body, kind, workId]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "That could not be sent." };
  } catch (e) {
    const r = refusal(e);
    if (r) return { ok: false, reason: r };
    throw e;
  }
}

export async function withdrawKudos(actor: OrgActor, id: string): Promise<boolean> {
  if (actor.viaPlatformAdmin || !UUID.test(String(id ?? ""))) return false;
  try {
    const rows = await one<{ id: string }>(actor,
      `UPDATE staff_kudos SET withdrawn_at = now() WHERE id = $1::uuid AND from_user_id = $2::uuid AND withdrawn_at IS NULL RETURNING id`, [id, actor.userId]);
    return rows.length > 0;
  } catch (e) {
    if (refusal(e)) return false;
    throw e;
  }
}

export interface KudosView { id: string; body: string; workKind: string | null; at: string; otherUserId: string; otherFirstName: string | null }

export async function listKudos(actor: OrgActor, limit = 50): Promise<{ received: KudosView[]; given: KudosView[] }> {
  if (actor.viaPlatformAdmin) return { received: [], given: [] };
  const rows = await one<{ id: string; body: string; work_kind: string | null; created_at: string; from_user_id: string; to_user_id: string; from_name: string | null; to_name: string | null }>(actor,
    `SELECT k.id, k.body, k.work_kind, k.created_at::text, k.from_user_id, k.to_user_id, f.name AS from_name, t.name AS to_name
       FROM staff_kudos k JOIN users f ON f.id = k.from_user_id JOIN users t ON t.id = k.to_user_id
      WHERE k.access_code_id = $1::uuid AND k.withdrawn_at IS NULL AND (k.from_user_id = $2::uuid OR k.to_user_id = $2::uuid)
      ORDER BY k.created_at DESC LIMIT $3`,
    [actor.orgId, actor.userId, Math.min(Math.max(1, limit), 200) * 2]);
  const received: KudosView[] = [];
  const given: KudosView[] = [];
  for (const r of rows) {
    if (r.to_user_id === actor.userId) received.push({ id: r.id, body: r.body, workKind: r.work_kind, at: r.created_at, otherUserId: r.from_user_id, otherFirstName: firstName(r.from_name) });
    if (r.from_user_id === actor.userId) given.push({ id: r.id, body: r.body, workKind: r.work_kind, at: r.created_at, otherUserId: r.to_user_id, otherFirstName: firstName(r.to_name) });
  }
  return { received: received.slice(0, limit), given: given.slice(0, limit) };
}

/** First names only: no counts, no ranking (review round 1). */
export interface BoardRow { userId: string; firstName: string }

/** Thanks GIVEN in the last N days, by people who opted in. Never who was thanked. */
export async function giverBoard(actor: OrgActor, days = 30): Promise<BoardRow[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ giver_id: string; giver_name: string }>(actor,
    `SELECT giver_id, giver_name FROM public.staff_kudos_giver_board($1::int)`, [Math.round(days)]);
  return rows.map((r) => ({ userId: r.giver_id, firstName: r.giver_name }));
}

/* ---------------------------------------------------------- time saved -- */

/** This person's accepted t.ROY drafts since a moment (their own runs; 106 RLS). */
export async function acceptedRunsSince(actor: OrgActor, sinceMs: number): Promise<AcceptedRun[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ skill: string; accepted_at: string }>(actor,
    `SELECT skill, accepted_at::text FROM ai_skill_run
      WHERE access_code_id = $1::uuid AND actor_user_id = $2::uuid AND accepted_by = $2::uuid AND accepted_at >= $3::timestamptz
      ORDER BY accepted_at DESC LIMIT 2000`,
    [actor.orgId, actor.userId, new Date(sinceMs).toISOString()]);
  return rows.map((r) => ({ skill: r.skill, acceptedAt: r.accepted_at }));
}

/* ---------------------------------------------------- recognition notes -- */

export interface RecognitionNote { id: string; aboutUserId: string; aboutFirstName: string | null; body: string; periodLabel: string | null; status: RecognitionStatus; createdAt: string; decidedAt: string | null }

export async function writeRecognitionNote(actor: OrgActor, input: { aboutUserId: string; body: string; periodLabel?: string | null }):
  Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (actor.viaPlatformAdmin || !isManager(actor)) return { ok: false, reason: "Only the owner or an org admin writes these." };
  if (!UUID.test(String(input.aboutUserId ?? ""))) return { ok: false, reason: "Pick a staff member." };
  const body = cleanRecognitionBody(input.body);
  if (!body.ok) return { ok: false, reason: body.error };
  const label = String(input.periodLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || null;
  // A funder report never names a participant (review round 1).
  const named = await participantNamesIn(actor, `${body.body} ${label ?? ""}`);
  if (named.reached.length > 0) return { ok: false, reason: "Leave participants' names out of a note for a funder report." };
  try {
    const rows = await one<{ id: string }>(actor,
      `INSERT INTO staff_recognition_note (access_code_id, about_user_id, written_by, body, period_label) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id`,
      [actor.orgId, input.aboutUserId, actor.userId, body.body, label]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "That could not be saved." };
  } catch (e) {
    const r = refusal(e);
    if (r) return { ok: false, reason: r };
    throw e;
  }
}

/** The person a note is about says yes, no, or takes a yes back. */
export async function answerRecognitionNote(actor: OrgActor, id: string, status: RecognitionStatus): Promise<boolean> {
  if (actor.viaPlatformAdmin || !UUID.test(String(id ?? "")) || !["approved", "declined", "withdrawn"].includes(status)) return false;
  try {
    const rows = await one<{ id: string }>(actor,
      `UPDATE staff_recognition_note SET status = $3 WHERE id = $1::uuid AND about_user_id = $2::uuid RETURNING id`, [id, actor.userId, status]);
    return rows.length > 0;
  } catch (e) {
    if (refusal(e)) return false;
    throw e;
  }
}

const noteRow = (r: { id: string; about_user_id: string; about_name: string | null; body: string; period_label: string | null; status: RecognitionStatus; created_at: string; decided_at: string | null }): RecognitionNote => ({
  id: r.id, aboutUserId: r.about_user_id, aboutFirstName: firstName(r.about_name), body: r.body, periodLabel: r.period_label,
  status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
});
const NOTE_SELECT = `SELECT n.id, n.about_user_id, u.name AS about_name, n.body, n.period_label, n.status, n.created_at::text, n.decided_at::text
  FROM staff_recognition_note n JOIN users u ON u.id = n.about_user_id`;

/** Notes about me (to answer). */
export async function listMyRecognitionNotes(actor: OrgActor): Promise<RecognitionNote[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<Parameters<typeof noteRow>[0]>(actor,
    `${NOTE_SELECT} WHERE n.access_code_id = $1::uuid AND n.about_user_id = $2::uuid ORDER BY n.created_at DESC LIMIT 50`, [actor.orgId, actor.userId]);
  return rows.map(noteRow);
}

/** Managers: every note in the organization with its answer (to see what is still waiting). */
export async function listOrgRecognitionNotes(actor: OrgActor): Promise<RecognitionNote[] | null> {
  if (actor.viaPlatformAdmin || !isManager(actor)) return null;
  const rows = await one<Parameters<typeof noteRow>[0]>(actor,
    `${NOTE_SELECT} WHERE n.access_code_id = $1::uuid ORDER BY n.created_at DESC LIMIT 200`, [actor.orgId]);
  return rows.map(noteRow);
}

/**
 * For a funder report: ONLY notes the staff member said yes to and has not
 * taken back. Managers only. This is the one reader a report may use.
 */
export async function listRecognitionForReport(actor: OrgActor): Promise<RecognitionNote[] | null> {
  const all = await listOrgRecognitionNotes(actor);
  return all ? all.filter((n) => n.status === "approved") : null;
}

/* ---------------------------------------------------------------- Wins -- */

export interface WinsPayload {
  settings: RewardsSettings;
  program: ProgramRewards;
  /** Good catches to me are a colleague's thanks, not a game: shown whatever the switch says. */
  kudos: { received: KudosView[]; given: KudosView[] };
  recognition: RecognitionNote[];
  colleagues: Colleague[];
  /** Everything below is empty while the switch is off. */
  milestones: EarnedMilestone[];
  newMilestones: EarnedMilestone[];
  unlocks: UnlockKey[];
  time: { weekMinutes: number; monthMinutes: number };
  board: BoardRow[];
  recap: MonthRecap | null;
  contributionsApprovedThisMonth: number;
}

/** Everything the Wins page shows, in one read. */
export async function getWins(actor: OrgActor, nowMs = Date.now(), approvedThisMonth = 0): Promise<WinsPayload> {
  const [settings, program, kudos, recognition, colleagues] = await Promise.all([
    getRewardsSettings(actor), getProgramRewards(actor), listKudos(actor), listMyRecognitionNotes(actor), listColleagues(actor),
  ]);
  const base: WinsPayload = {
    settings, program, kudos, recognition, colleagues,
    milestones: [], newMilestones: [], unlocks: [], time: { weekMinutes: 0, monthMinutes: 0 }, board: [], recap: null,
    contributionsApprovedThisMonth: 0,
  };
  if (!settings.rewardsOn) return base;
  await refreshMilestones(actor);
  const month = monthWindow(nowMs);
  const since = Math.min(month.fromMs, nowMs - 7 * DAY_MS);
  const [milestones, runs, board] = await Promise.all([
    listMyMilestones(actor), acceptedRunsSince(actor, since), program.teamBoardOn ? giverBoard(actor, 30) : Promise.resolve([]),
  ]);
  const monthMinutes = minutesSaved(runs, month.fromMs, month.toMs);
  const weekMinutes = minutesSaved(runs, nowMs - 7 * DAY_MS, nowMs + 1);
  const inMonth = (iso: string) => { const t = Date.parse(iso); return t >= month.fromMs && t < month.toMs; };
  const recap = buildMonthRecap({
    monthLabel: month.label,
    firstName: null,
    milestones: milestones.filter((m) => inMonth(m.earnedAt)).map((m) => ({ key: m.key, earnedAt: m.earnedAt })),
    kudosGiven: kudos.given.filter((k) => inMonth(k.at)).length,
    kudosReceivedFrom: kudos.received.filter((k) => inMonth(k.at)).map((k) => k.otherFirstName),
    minutesSaved: monthMinutes,
    contributionsApproved: approvedThisMonth,
    recognitionApproved: recognition.filter((n) => n.status === "approved" && inMonth(n.decidedAt ?? n.createdAt)).length,
  });
  return {
    ...base,
    milestones,
    newMilestones: milestones.filter((m) => !m.seen),
    unlocks: unlocksFor(milestones.map((m) => m.key)),
    time: { weekMinutes, monthMinutes },
    board,
    recap,
    contributionsApprovedThisMonth: approvedThisMonth,
  };
}
