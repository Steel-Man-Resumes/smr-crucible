/**
 * Staff directory contributions: the database half (migration 112, staff side
 * lane S6). See directoryContributionShared.ts for the rules.
 *
 * Staff never touch the queue table: they submit through the 112 intake
 * function, read back through my_directory_contributions (no private note,
 * ever) and withdraw through withdraw_directory_contribution, all as
 * themselves in their own organization (runScoped). The data owner (a
 * platform admin) reads the queue under its RLS and decides through the
 * definer functions (queryAsUser, no organization scope).
 */
import { queryAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { LISTING_NUDGE_DAYS } from "./staffRewardsShared";
import { participantNamesIn } from "./staffRewards";
import {
  intakePayload, normalizeContribution, CONTRIBUTION_OUTCOMES,
  type ContributionFlow, type ContributionKind, type ContributionOutcome, type ContributionStatus,
} from "./directoryContributionShared";

export * from "./directoryContributionShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function one<T>(actor: OrgActor, text: string, params: unknown[]): Promise<T[]> {
  const [rows] = await runScoped<[T[]]>(scopeOf(actor), (sql) => [run(sql)(text, params)]);
  return rows ?? [];
}

/** A database refusal written for people (the 112 messages), or null for anything else. */
function readableRefusal(e: unknown): string | null {
  const msg = String((e as { message?: string })?.message ?? "").replace(/^ERROR:\s*/, "").trim();
  const code = String((e as { code?: string })?.code ?? "");
  if (code !== "23514" && code !== "42501" && !/check_violation|insufficient_privilege/.test(msg)) return null;
  if (/^(A |The |That |Tell |Invalid|only |Hearsay|Name |Only |An |Someone )/.test(msg) && msg.length < 200) return msg.replace(/^Invalid contribution(: )?/, "Something is missing: ").replace(/: $/, ".");
  return "That could not be sent.";
}

export interface MyContribution {
  id: string; flow: ContributionFlow; targetKind: ContributionKind; targetId: string | null; name: string | null;
  status: ContributionStatus; outcome: ContributionOutcome | null; ownerAnswer: string | null;
  interactionOn: string | null; createdAt: string; decidedAt: string | null; recheckOn: string | null;
  mine: boolean; submitterFirstName: string | null;
}

/**
 * Send one contribution to the owner's queue. `today` is the staff member's
 * date. The app has already put the free text through the record-word gate.
 */
export async function submitContribution(actor: OrgActor, raw: unknown, today: string):
  Promise<{ ok: true; id: string; earlier: boolean } | { ok: false; reason: string }> {
  if (actor.viaPlatformAdmin) return { ok: false, reason: "Nothing is sent while you are viewing as someone else." };
  const norm = normalizeContribution(raw, today);
  if (!norm.ok) return { ok: false, reason: norm.error };
  // What they said and what changed are about the place, never a participant (review round 1).
  const words = [norm.value.details.said, norm.value.details.change].filter(Boolean).join(" ");
  if (words) {
    const named = await participantNamesIn(actor, words);
    if (named.reached.length > 0) return { ok: false, reason: "Leave out anyone on your organization's list. This is about the place." };
  }
  try {
    const rows = await one<{ r: { id?: string; earlier?: boolean } | null }>(actor, `SELECT public.submit_directory_contribution($1::jsonb) AS r`, [JSON.stringify(intakePayload(norm.value))]);
    const r = rows[0]?.r;
    return r?.id ? { ok: true, id: r.id, earlier: !!r.earlier } : { ok: false, reason: "That could not be sent." };
  } catch (e) {
    const r = readableRefusal(e);
    if (r) return { ok: false, reason: r };
    throw e;
  }
}

/** My own submissions (and the program's, for its owner or an org admin). Never the private note. */
export async function listMyContributions(actor: OrgActor): Promise<MyContribution[]> {
  if (actor.viaPlatformAdmin) return [];
  const rows = await one<{ id: string; flow: ContributionFlow; target_kind: ContributionKind; target_id: string | null; name: string | null; status: ContributionStatus;
    outcome: ContributionOutcome | null; owner_answer: string | null; interaction_on: string | null; created_at: string; decided_at: string | null;
    recheck_on: string | null; mine: boolean; submitter_first_name: string | null }>(actor,
    `SELECT id, flow, target_kind, target_id, name, status, outcome, owner_answer, interaction_on::text, created_at::text, decided_at::text,
            recheck_on::text, mine, submitter_first_name FROM public.my_directory_contributions()`, []);
  return rows.map((r) => ({
    id: r.id, flow: r.flow, targetKind: r.target_kind, targetId: r.target_id, name: r.name, status: r.status, outcome: r.outcome,
    ownerAnswer: r.owner_answer, interactionOn: r.interaction_on, createdAt: r.created_at, decidedAt: r.decided_at,
    recheckOn: r.recheck_on, mine: !!r.mine, submitterFirstName: r.submitter_first_name,
  }));
}

/** How many of MY contributions were approved in [fromIso, toIso). Feeds the month recap. */
export function approvedInWindow(rows: readonly MyContribution[], fromMs: number, toMs: number): number {
  return rows.filter((r) => r.mine && r.status === "approved" && r.decidedAt && Date.parse(r.decidedAt) >= fromMs && Date.parse(r.decidedAt) < toMs).length;
}

export async function withdrawContribution(actor: OrgActor, id: string): Promise<boolean> {
  if (actor.viaPlatformAdmin || !UUID.test(String(id ?? ""))) return false;
  const rows = await one<{ ok: boolean }>(actor, `SELECT public.withdraw_directory_contribution($1::uuid) AS ok`, [id]);
  return !!rows[0]?.ok;
}

/* ------------------------------------------------------------ the nudge -- */

/**
 * May t.ROY ask this staff member about this listing now? True at most once
 * per listing per week per person (staff_listing_nudge), and the claim is
 * the same statement as the check, so two tabs cannot both ask.
 */
export async function claimListingNudge(actor: OrgActor, kind: ContributionKind, listingId: string): Promise<boolean> {
  if (actor.viaPlatformAdmin || (kind !== "employer" && kind !== "resource") || !UUID.test(String(listingId ?? ""))) return false;
  try {
    const rows = await one<{ shown_at: string }>(actor,
      `INSERT INTO staff_listing_nudge (user_id, access_code_id, listing_kind, listing_id) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       ON CONFLICT (user_id, access_code_id, listing_kind, listing_id)
       DO UPDATE SET shown_at = now() WHERE staff_listing_nudge.shown_at < now() - make_interval(days => $5::int)
       RETURNING shown_at::text`,
      [actor.userId, actor.orgId, kind, listingId, LISTING_NUDGE_DAYS]);
    return rows.length > 0;
  } catch {
    // A nudge is never worth an error: no row, no ask.
    return false;
  }
}

/* ------------------------------------------------------- owner's queue -- */

export interface QueueRow {
  id: string; orgId: string; orgName: string | null; submittedBy: string | null; submitterName: string | null;
  flow: ContributionFlow; targetKind: ContributionKind; targetId: string | null; targetName: string | null;
  details: Record<string, string>; interactionOn: string | null; interactionMethod: string | null; sourceUrl: string | null;
  privateNote: string | null; creditOrgOk: boolean; creditPersonOk: boolean;
  status: ContributionStatus; outcome: ContributionOutcome | null; ownerAnswer: string | null;
  createdAt: string; decidedAt: string | null; recheckOn: string | null; appliedAt: string | null;
}

/**
 * The data owner's queue (platform admin; 112 RLS). Waiting first. The
 * private note is shown here and nowhere else.
 */
export async function listContributionQueue(ownerUserId: string, opts: { status?: ContributionStatus | "open" } = {}): Promise<QueueRow[]> {
  const status = opts.status ?? "open";
  const rows = await queryAsUser<Record<string, unknown>>(ownerUserId,
    `SELECT c.id, c.access_code_id, a.partner_name, c.submitted_by, u.name AS submitter_name, c.flow, c.target_kind, c.target_id,
            -- The app role holds nothing on the resource base tables (072), so a
            -- resource shows the name the staff member saw; employers resolve.
            CASE WHEN c.target_kind = 'employer' THEN (SELECT e.canonical_name FROM employer_org e WHERE e.id = c.target_id) END AS target_name,
            c.details, c.interaction_on::text, c.interaction_method, c.source_url, c.private_note, c.credit_org_ok, c.credit_person_ok,
            c.status, c.outcome, c.owner_answer, c.created_at::text, c.decided_at::text, c.recheck_on::text, c.applied_at::text
       FROM directory_contribution c
       LEFT JOIN access_code a ON a.id = c.access_code_id
       LEFT JOIN users u ON u.id = c.submitted_by
      WHERE ($1 = 'all' OR ($1 = 'open' AND c.status IN ('received', 'needs_more')) OR c.status = $1)
      ORDER BY (c.status = 'received') DESC, c.created_at ASC LIMIT 200`,
    [status]);
  return rows.map((r) => ({
    id: String(r.id), orgId: String(r.access_code_id), orgName: (r.partner_name as string) ?? null,
    submittedBy: (r.submitted_by as string) ?? null, submitterName: (r.submitter_name as string) ?? null,
    flow: r.flow as ContributionFlow, targetKind: r.target_kind as ContributionKind, targetId: (r.target_id as string) ?? null,
    targetName: (r.target_name as string) ?? null, details: (r.details as Record<string, string>) ?? {},
    interactionOn: (r.interaction_on as string) ?? null, interactionMethod: (r.interaction_method as string) ?? null,
    sourceUrl: (r.source_url as string) ?? null, privateNote: (r.private_note as string) ?? null,
    creditOrgOk: !!r.credit_org_ok, creditPersonOk: !!r.credit_person_ok,
    status: r.status as ContributionStatus, outcome: (r.outcome as ContributionOutcome) ?? null, ownerAnswer: (r.owner_answer as string) ?? null,
    createdAt: String(r.created_at), decidedAt: (r.decided_at as string) ?? null, recheckOn: (r.recheck_on as string) ?? null,
    appliedAt: (r.applied_at as string) ?? null,
  }));
}

export async function decideContribution(ownerUserId: string, id: string, status: "approved" | "needs_more" | "not_used", outcome: ContributionOutcome | null, answer: string | null):
  Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!UUID.test(String(id ?? "")) || !["approved", "needs_more", "not_used"].includes(status)) return { ok: false, reason: "Invalid decision." };
  if (status === "approved" && (!outcome || !(CONTRIBUTION_OUTCOMES as readonly string[]).includes(outcome))) return { ok: false, reason: "Say what it turned out to be." };
  const words = String(answer ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  try {
    const rows = await queryAsUser<{ ok: boolean }>(ownerUserId, `SELECT public.decide_directory_contribution($1::uuid, $2, $3, $4) AS ok`,
      [id, status, status === "approved" ? outcome : null, words]);
    return rows[0]?.ok ? { ok: true } : { ok: false, reason: "Not found." };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if (/outcome_fits|check constraint/.test(msg)) return { ok: false, reason: "That outcome does not fit this kind of update." };
    const r = readableRefusal(e);
    if (r) return { ok: false, reason: r };
    throw e;
  }
}

/** Record an approved call as the documented interaction (112 apply_contribution_call). */
export async function applyContributionCall(ownerUserId: string, id: string, checkId: string | null, placeId: string | null):
  Promise<{ ok: true; wrote: string } | { ok: false; reason: string }> {
  if (!UUID.test(String(id ?? "")) || (checkId && !UUID.test(checkId)) || (placeId && !UUID.test(placeId))) return { ok: false, reason: "Invalid request." };
  try {
    const rows = await queryAsUser<{ wrote: string }>(ownerUserId, `SELECT public.apply_contribution_call($1::uuid, $2::uuid, $3::uuid) AS wrote`, [id, checkId, placeId]);
    return rows[0]?.wrote ? { ok: true, wrote: rows[0].wrote } : { ok: false, reason: "Nothing was written." };
  } catch (e) {
    const r = readableRefusal(e);
    if (r) return { ok: false, reason: r };
    const msg = String((e as { message?: string })?.message ?? "");
    if (/live check|future|predate|relationship/i.test(msg)) return { ok: false, reason: msg.replace(/^ERROR:\s*/, "").slice(0, 200) };
    throw e;
  }
}
