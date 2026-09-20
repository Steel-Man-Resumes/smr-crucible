/**
 * Placements and retention: the organization's record of what happened after
 * hire, with how it is known kept attached to every figure.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: a retention RATE has a denominator, and
 * the denominator is "placements old enough to have been asked". Someone placed
 * nine days ago is not a 30-day failure. And "could not reach" is its own
 * answer -- never folded into employed or not employed.
 */
import { queryAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const canWrite = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.outcome.write");
const REACH = (who: string) => `($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
   WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid))`;

export const RETENTION_MARKS = [30, 60, 90, 180] as const;
export const OUTCOME_SOURCES = ["participant_reported", "staff_reported", "staff_verified"] as const;
export const OUTCOME_SOURCE_LABELS: Record<(typeof OUTCOME_SOURCES)[number], string> = {
  participant_reported: "They told me", staff_reported: "I know it, but have not confirmed it", staff_verified: "Confirmed",
};
export const VERIFICATION_METHODS = ["employer_confirmed", "pay_stub_seen", "offer_letter_seen", "work_site_visit", "other_document"] as const;
export const VERIFICATION_METHOD_LABELS: Record<(typeof VERIFICATION_METHODS)[number], string> = {
  employer_confirmed: "The employer confirmed it", pay_stub_seen: "I saw a pay stub", offer_letter_seen: "I saw the offer letter",
  work_site_visit: "I visited the work site", other_document: "Another document",
};
export const RETENTION_METHODS = ["participant_told_me", "employer_confirmed", "pay_stub_seen", "could_not_reach"] as const;
export const END_REASONS = ["left_for_better_job", "left_other", "laid_off", "let_go", "seasonal_ended", "entered_in_error", "unknown"] as const;
export const END_REASON_LABELS: Record<(typeof END_REASONS)[number], string> = {
  left_for_better_job: "Left for a better job", left_other: "Left for another reason", laid_off: "Laid off", let_go: "Let go",
  seasonal_ended: "Seasonal work ended", entered_in_error: "Entered by mistake", unknown: "Do not know",
};

export interface Outcome {
  id: string; client_user_id: string; client_name: string | null; employer: string; job_title: string | null; start_date: string;
  hourly_wage: string | null; hours_per_week: string | null; source: string; verification_method: string | null;
  verified_by_name: string | null; verified_at: string | null; ended_on: string | null; end_reason: string | null; created_by_name: string | null;
  checks: { day_mark: number; status: string; method: string; checked_at: string }[];
  /** Marks whose date has arrived and have no answer yet. */
  due_marks: number[];
}

const COLS = `o.id, o.client_user_id, c.name AS client_name, o.employer, o.job_title, to_char(o.start_date, 'YYYY-MM-DD') AS start_date,
  o.hourly_wage::text, o.hours_per_week::text, o.source, o.verification_method, vb.name AS verified_by_name, o.verified_at,
  to_char(o.ended_on, 'YYYY-MM-DD') AS ended_on, o.end_reason, cb.name AS created_by_name,
  COALESCE((SELECT json_agg(json_build_object('day_mark', k.day_mark, 'status', k.status, 'method', k.method, 'checked_at', k.checked_at) ORDER BY k.day_mark)
              FROM retention_check k WHERE k.outcome_id = o.id), '[]'::json) AS checks`;

function withDue(rows: Omit<Outcome, "due_marks">[]): Outcome[] {
  const today = Date.now();
  return rows.map((o) => {
    const start = new Date(o.start_date + "T00:00:00Z").getTime();
    const end = o.ended_on ? new Date(o.ended_on + "T00:00:00Z").getTime() : Infinity;
    const due = o.end_reason === "entered_in_error" ? [] : RETENTION_MARKS.filter((m) => {
      const at = start + m * 86400000;
      return at <= today && at <= end && !o.checks.some((k) => k.day_mark === m);
    });
    return { ...o, due_marks: [...due] };
  });
}

export async function listOutcomes(actor: OrgActor, clientId?: string): Promise<Outcome[] | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const [rows] = await runScoped<[Omit<Outcome, "due_marks">[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT ${COLS} FROM outcome_record o JOIN users c ON c.id = o.client_user_id
         LEFT JOIN users vb ON vb.id = o.verified_by LEFT JOIN users cb ON cb.id = o.created_by
        WHERE o.access_code_id = $1::uuid AND ${REACH("o.client_user_id")} AND ($4::uuid IS NULL OR o.client_user_id = $4::uuid)
        ORDER BY o.start_date DESC LIMIT 500`,
      [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, clientId ?? null]
    ),
  ]);
  return withDue(rows);
}

type Result = { ok: true; id?: string } | { ok: false; error: string };

export async function recordOutcome(actor: OrgActor, input: {
  clientId: string; employer: string; jobTitle?: string | null; startDate: string; hourlyWage?: number | null; hoursPerWeek?: number | null;
  source: string; verificationMethod?: string | null;
}): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!(OUTCOME_SOURCES as readonly string[]).includes(input.source)) return { ok: false, error: "Say how you know." };
  const verified = input.source === "staff_verified";
  if (verified && !(VERIFICATION_METHODS as readonly string[]).includes(input.verificationMethod ?? "")) {
    return { ok: false, error: "A confirmed placement has to say how it was confirmed." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: "A start date is needed." };
  if ((input.employer ?? "").trim().length < 2) return { ok: false, error: "Which employer?" };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO outcome_record (access_code_id, client_user_id, employer, job_title, start_date, hourly_wage, hours_per_week, source,
                                     verification_method, verified_by, verified_at, created_by)
         SELECT $1::uuid, $4::uuid, $5, $6, $7::date, $8::numeric, $9::numeric, $10,
                CASE WHEN $11::boolean THEN $12 END, CASE WHEN $11::boolean THEN $3::uuid END, CASE WHEN $11::boolean THEN now() END, $3::uuid
          WHERE ${REACH("$4::uuid")} RETURNING id`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, input.clientId, input.employer.trim(), input.jobTitle?.trim() || null,
         input.startDate, input.hourlyWage ?? null, input.hoursPerWeek ?? null, input.source, verified, input.verificationMethod ?? null]
      ),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "That person is not on your caseload." };
  } catch { return { ok: false, error: "Check the wage, hours and dates." }; }
}

export async function recordRetentionCheck(actor: OrgActor, input: { outcomeId: string; dayMark: number; status: string; method: string; note?: string | null }): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!(RETENTION_MARKS as readonly number[]).includes(input.dayMark)) return { ok: false, error: "That is not a check-in point." };
  if ((input.status === "unknown") !== (input.method === "could_not_reach")) return { ok: false, error: "'Could not reach them' goes with 'do not know', and only with it." };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO retention_check (outcome_id, access_code_id, day_mark, status, method, note, checked_by)
         SELECT o.id, o.access_code_id, $5::int, $6, $7, $8, $3::uuid FROM outcome_record o
          WHERE o.id = $4::uuid AND o.access_code_id = $1::uuid AND ${REACH("o.client_user_id")}
            AND o.start_date + ($5::int || ' days')::interval <= now()
         ON CONFLICT (outcome_id, day_mark) DO NOTHING RETURNING id`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, input.outcomeId, input.dayMark, input.status, input.method, input.note?.trim() || null]
      ),
    ]);
    return rows[0] ? { ok: true } : { ok: false, error: "Already answered, not due yet, or not someone on your caseload." };
  } catch { return { ok: false, error: "That answer did not save." }; }
}

export async function endOutcome(actor: OrgActor, outcomeId: string, endedOn: string, reason: string): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!(END_REASONS as readonly string[]).includes(reason) || !/^\d{4}-\d{2}-\d{2}$/.test(endedOn)) return { ok: false, error: "A date and a reason are needed." };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`UPDATE outcome_record o SET ended_on = $5::date, end_reason = $6
                 WHERE o.id = $4::uuid AND o.access_code_id = $1::uuid AND o.ended_on IS NULL AND ${REACH("o.client_user_id")} RETURNING o.id`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, outcomeId, endedOn, reason]),
    ]);
    return rows[0] ? { ok: true } : { ok: false, error: "Already ended, or not someone on your caseload." };
  } catch { return { ok: false, error: "The end date cannot be before the start date." }; }
}

/** What the organization has on file about ME. A participant may always read this. */
export async function getMyOutcomes(userId: string) {
  return queryAsUser<{ employer: string; job_title: string | null; start_date: string; source: string; ended_on: string | null; org_name: string | null }>(
    userId,
    `SELECT o.employer, o.job_title, to_char(o.start_date, 'YYYY-MM-DD') AS start_date, o.source, to_char(o.ended_on, 'YYYY-MM-DD') AS ended_on, ac.partner_name AS org_name
       FROM outcome_record o JOIN access_code ac ON ac.id = o.access_code_id
      WHERE o.client_user_id = $1 AND COALESCE(o.end_reason, '') <> 'entered_in_error' ORDER BY o.start_date DESC`,
    [userId]
  );
}

export interface OutcomeSummary {
  placements: number; bySource: Record<string, number>; stillEmployed: number; ended: number; leftForBetter: number;
  medianWage: number | null; wageKnownFor: number;
  retention: { dayMark: number; eligible: number; employed: number; notEmployed: number; unknown: number; notAskedYet: number }[];
}

/** Pure, so it can be tested without a database and used identically by Insights and any export. */
export function summarizeOutcomes(all: readonly Outcome[], now = Date.now()): OutcomeSummary {
  const rows = all.filter((o) => o.end_reason !== "entered_in_error");
  const wages = rows.map((o) => (o.hourly_wage ? Number(o.hourly_wage) : NaN)).filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
  const median = wages.length ? (wages.length % 2 ? wages[(wages.length - 1) / 2] : (wages[wages.length / 2 - 1] + wages[wages.length / 2]) / 2) : null;
  const bySource: Record<string, number> = {};
  for (const o of rows) bySource[o.source] = (bySource[o.source] ?? 0) + 1;
  return {
    placements: rows.length, bySource, stillEmployed: rows.filter((o) => !o.ended_on).length, ended: rows.filter((o) => !!o.ended_on).length,
    leftForBetter: rows.filter((o) => o.end_reason === "left_for_better_job").length, medianWage: median, wageKnownFor: wages.length,
    retention: RETENTION_MARKS.map((m) => {
      // ELIGIBLE = old enough to have been asked at this mark. Nothing else is in the denominator.
      const eligible = rows.filter((o) => new Date(o.start_date + "T00:00:00Z").getTime() + m * 86400000 <= now);
      const ans = (s: string) => eligible.filter((o) => o.checks.some((k) => k.day_mark === m && k.status === s)).length;
      const employed = ans("employed"), notEmployed = ans("not_employed"), unknown = ans("unknown");
      return { dayMark: m, eligible: eligible.length, employed, notEmployed, unknown, notAskedYet: eligible.length - employed - notEmployed - unknown };
    }),
  };
}
