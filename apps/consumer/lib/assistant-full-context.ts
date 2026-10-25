/**
 * The person's full context for t.ROY, built on the server (fix 2026-10-25).
 *
 * Until 2026-10-15 the browser sent /api/user/context's snapshot back to
 * /api/assistant as context.userFullContext. Commit 9b513e4 made the route
 * delete it (a browser-sent context can be forged) but loaded nothing in its
 * place, so t.ROY answered without the person's resumes, lanes, saved jobs,
 * hurdle plan, progression step or meter. This module is the replacement.
 *
 * Rules:
 *  - The user id comes from the signed-in session, never from the request
 *    body. Every read runs as that person (queryAsUser, runAsUser: RLS on).
 *  - Record words (the saved disclosure script and timing) go out only while
 *    the person's record_planner consent (migration 095) is current, and
 *    never while anyone acts for them (lib/disclosure-context.ts rule).
 *  - Impersonation: /api/assistant refuses every view-as and assist session
 *    before it gets here, so the person in the context is always the person
 *    typing. serverFullContext() also refuses owner, staff, Forge-scope and
 *    rehearsal turns: those surfaces have their own prompts.
 *  - Size: lists are cut to the caps below with counts, so the section can
 *    never blow the prompt. Each loader fails toward "not loaded", never
 *    toward an error page: the chat still works from page signals.
 *
 * /api/user/context keeps its own copy of the base read for the browser
 * (the dashboard reads it); this module reuses the same SQL constants and the
 * same disclosurePlanContext() so the two cannot disagree on the record gate.
 */
import { readJobFit } from "./job-fit";
import { disclosurePlanContext, LATEST_DISCLOSURE_PLAN_SQL, LATEST_DISCLOSURE_SCRIPT_SQL, type DisclosureRow } from "./disclosure-context";
import type { UserFullContext } from "./use-user-context";

export const FULL_CONTEXT_CAPS = { resumes: 5, applications: 10, lanes: 5, hurdles: 3, hurdleLines: 2 } as const;

/**
 * The newest saved hurdle plan of either kind. A saved plan holds no record
 * content (lib/hurdles/plan.ts planForSave), so this reads the non-record
 * hurdles only: what the person knows, what is open, what to do now.
 */
export const LATEST_HURDLE_PLAN_SQL = `SELECT target_context, content, created_at
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type IN ('hurdle_plan', 'disclosure_plan')
       AND jsonb_typeof(content->'hurdlePlan'->'hurdles') = 'array' AND is_demo = false
     ORDER BY created_at DESC LIMIT 1`;

export interface ProfileLike {
  name: string | null;
  email: string | null;
  city: string | null;
  state: string;
  tier: string;
  readinessStage: string | null;
  barriers: string[];
  savedJobs: Array<{ id: string; jobTitle: string; company: string; status: string; followUpAt: string | null; resumeTailored: boolean }>;
  hasDisclosurePlan: boolean;
  forgeComplete: boolean;
  interviewSessionCount: number;
  applicationCount: number;
  hasResumeTailoredToTarget: boolean;
}
export interface ConsumerProfileRow {
  preferences: Record<string, unknown> | null;
  forge_output: Record<string, any> | null;
  profile_data: Record<string, any> | null;
}
export interface ResumeRow { id: string; target_context: Record<string, any> | null; content: Record<string, any> | null; created_at: string }
export interface LaneLike { id: string; name: string; target_role: string | null; kind?: string; archived_at: string | null }
export interface HurdlePlanRow { target_context: Record<string, any> | null; content: Record<string, any> | null; created_at: string }
export interface ProgressionLike {
  currentStepId: string;
  nextAction: { label: string; href: string };
  steps: Array<{ id: string; label: string; state: string }>;
  allowance: { remaining: number | null };
}
export interface MeterLike { counts: Record<string, number>; score: number; band: string }

export interface FullContextParts {
  userId: string;
  profile: ProfileLike;
  consumerProfile: ConsumerProfileRow | null;
  resumes: ResumeRow[];
  disclosureRow: DisclosureRow | null;
  disclosureScriptRow: DisclosureRow | null;
  /** Already combined: consent granted at the current version AND nobody acting for the person. */
  recordConsent: boolean;
  lanes: LaneLike[] | null;
  hurdlePlan: HurdlePlanRow | null;
  progression: ProgressionLike | null;
  meter: MeterLike | null;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** Timestamps arrive as strings from the serverless driver and as Date from pg or pglite; the prompt slices ISO text. */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : "");
const isoRow = <T extends { created_at: unknown } | null>(row: T): T => (row ? { ...row, created_at: iso(row.created_at) } : row);
const strs = (v: unknown, n: number, max = 160): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => (x as string).trim().slice(0, max)) : []);

/** Pure: the snapshot shape buildFullUserSection() reads, from the loaded parts. */
export function assembleFullContext(p: FullContextParts): UserFullContext {
  const { profile, consumerProfile: cp } = p;
  const fo = cp?.forge_output ?? null;
  const resumes = p.resumes.slice(0, FULL_CONTEXT_CAPS.resumes);
  const hasProfile = !!profile.name?.trim();
  const hasJobResume = resumes.some((r) => r.target_context?.createdFrom === "job" || r.content?.meta?.createdFrom === "job");
  const onboardingState = !hasProfile ? "needs_profile" : !hasJobResume ? "needs_resume" : "full_access";
  const lanes = p.lanes ?? [];
  const openLanes = lanes.filter((l) => !l.archived_at);
  const hp = p.hurdlePlan;
  const hurdles = Array.isArray(hp?.content?.hurdlePlan?.hurdles) ? (hp!.content!.hurdlePlan.hurdles as any[]) : [];

  return {
    accountId: p.userId,
    sessionAccountId: p.userId,
    workPreferences: readJobFit(cp?.preferences?.jobFit),
    profile: { name: profile.name, email: profile.email, city: profile.city, state: profile.state, tier: profile.tier },
    forge: fo
      ? {
          headline: fo.headline ?? null,
          summary: fo.narrative?.summary ?? fo.summary ?? null,
          strengths: fo.narrative?.strengths ?? fo.strengths ?? [],
          skills: fo.skills ?? [],
          careerPaths: fo.career_paths ?? fo.careerPaths ?? [],
          readinessStage: profile.readinessStage,
          hasCriminalRecord: profile.barriers.includes("criminal_record"),
          barriers: profile.barriers.filter((b) => b !== "criminal_record"),
          goals: cp?.profile_data?.goals ?? [],
          goalNarrative: cp?.profile_data?.goalNarrative ?? null,
        }
      : null,
    resumes: resumes.map((r) => ({
      id: r.id,
      targetJob: r.target_context?.targetJob ?? r.content?.meta?.targetJob ?? null,
      targetCompany: r.target_context?.targetCompany ?? r.content?.meta?.targetCompany ?? null,
      createdFrom: r.target_context?.createdFrom ?? r.content?.meta?.createdFrom ?? null,
      summary: r.content?.summary ?? null,
      createdAt: iso(r.created_at),
    })),
    disclosurePlan: disclosurePlanContext(isoRow(p.disclosureRow), isoRow(p.disclosureScriptRow), { recordConsent: p.recordConsent }),
    applications: profile.savedJobs.slice(0, FULL_CONTEXT_CAPS.applications).map((j) => ({
      id: j.id, company: j.company, role: j.jobTitle, status: j.status, resumeTailored: j.resumeTailored, followUpAt: j.followUpAt,
    })),
    journey: {
      onboardingState,
      disclosureComplete: profile.hasDisclosurePlan,
      forgeComplete: profile.forgeComplete,
      interviewSessionCount: profile.interviewSessionCount,
      applicationCount: profile.applicationCount,
      hasResumeTailoredToTarget: profile.hasResumeTailoredToTarget,
    },
    lanes: p.lanes
      ? {
          total: lanes.length,
          open: openLanes.length,
          items: openLanes.slice(0, FULL_CONTEXT_CAPS.lanes).map((l) => ({ id: l.id, name: l.name, target: l.target_role, kind: l.kind ?? "resume" })),
        }
      : null,
    hurdlePlan: hp
      ? {
          exists: true,
          targetJob: str(hp.target_context?.targetJob ?? hp.content?.targetJob, 120),
          savedAt: iso(hp.created_at),
          hurdleCount: hurdles.length,
          hurdles: hurdles.slice(0, FULL_CONTEXT_CAPS.hurdles).map((h) => ({
            label: str(h?.label, 60) ?? "Hurdle",
            known: strs(h?.known, FULL_CONTEXT_CAPS.hurdleLines),
            open: strs(h?.open, FULL_CONTEXT_CAPS.hurdleLines),
            doNow: strs(h?.doNow, FULL_CONTEXT_CAPS.hurdleLines),
            tell: str(h?.tell, 160),
          })),
        }
      : { exists: false },
    progression: p.progression
      ? {
          currentStep: p.progression.currentStepId,
          currentLabel: p.progression.steps.find((s) => s.id === p.progression!.currentStepId)?.label ?? p.progression.currentStepId,
          nextAction: { label: p.progression.nextAction.label, href: p.progression.nextAction.href },
          remaining: p.progression.allowance.remaining,
          completed: p.progression.steps.filter((s) => s.state === "completed").map((s) => s.id),
        }
      : null,
    meter: p.meter ? { score: p.meter.score, band: p.meter.band, counts: p.meter.counts } : null,
  };
}

/** Every read behind the context, injectable so tests can run the real SQL in pglite without a provider or Next. */
export interface FullContextLoaders {
  profile(userId: string): Promise<ProfileLike | null>;
  consumerProfile(userId: string): Promise<ConsumerProfileRow | null>;
  resumes(userId: string): Promise<ResumeRow[]>;
  disclosure(userId: string): Promise<{ latest: DisclosureRow | null; latestWithScript: DisclosureRow | null }>;
  /** Granted at the current consent text version (lib/hurdles/consent-server.ts). */
  recordConsent(userId: string): Promise<boolean>;
  /** An impersonation cookie is present: someone acts for the person. */
  actingForSomeoneElse(): Promise<boolean>;
  lanes(userId: string): Promise<LaneLike[]>;
  hurdlePlan(userId: string): Promise<HurdlePlanRow | null>;
  progression(userId: string): Promise<ProgressionLike | null>;
  meter(userId: string): Promise<MeterLike | null>;
}

async function soft<T>(p: Promise<T>, fallback: T, what: string): Promise<T> {
  try { return await p; } catch (err) { console.error(`assistant full context: ${what} failed`, err); return fallback; }
}

/**
 * Load the whole context for one signed-in person. Returns null only when the
 * profile itself cannot be read; every other part fails toward "not loaded".
 */
export async function loadUserFullContext(userId: string, loaders: FullContextLoaders): Promise<UserFullContext | null> {
  const profile = await loaders.profile(userId);
  if (!profile) return null;
  const [consumerProfile, resumes, disclosure, consent, actingFor, lanes, hurdlePlan, progression, meter] = await Promise.all([
    soft(loaders.consumerProfile(userId), null, "consumer profile"),
    soft(loaders.resumes(userId), [], "resumes"),
    soft(loaders.disclosure(userId), { latest: null, latestWithScript: null }, "disclosure plan"),
    // Both consent reads fail closed: no yes on record, or an unreadable cookie, means no record words.
    soft(loaders.recordConsent(userId), false, "record consent"),
    soft(loaders.actingForSomeoneElse(), true, "impersonation check"),
    soft(loaders.lanes(userId), null as LaneLike[] | null, "lanes"),
    soft(loaders.hurdlePlan(userId), null, "hurdle plan"),
    soft(loaders.progression(userId), null, "progression"),
    soft(loaders.meter(userId), null, "meter"),
  ]);
  return assembleFullContext({
    userId, profile, consumerProfile, resumes,
    disclosureRow: disclosure.latest, disclosureScriptRow: disclosure.latestWithScript,
    recordConsent: consent && !actingFor,
    lanes, hurdlePlan, progression, meter,
  });
}

/** The real loaders: core as the person (RLS), the consent table, the lanes, the hurdle plan, progression and the meter. */
export async function realFullContextLoaders(): Promise<FullContextLoaders> {
  const core = await import("@crucible/core");
  const { recordPlannerConsent, actingForSomeoneElse } = await import("./hurdles/consent-server");
  const { getProgression } = await import("./progression-server");
  const { loadSteelMan } = await import("./steelman/read");
  const { scoreOf, bandFor, isSteelMan } = await import("./steelman/score");
  return {
    profile: (userId) => core.getUserProfile(userId),
    consumerProfile: (userId) => core.getOneAsUser<ConsumerProfileRow>(userId, `SELECT forge_output, profile_data, preferences FROM consumer_profile WHERE user_id = $1`, [userId]),
    resumes: (userId) => core.queryAsUser<ResumeRow>(userId, core.RECENT_RESUMES_FOR_CONTEXT_SQL, [userId]),
    disclosure: async (userId) => {
      const [latest, latestWithScript] = await Promise.all([
        core.getOneAsUser<DisclosureRow>(userId, LATEST_DISCLOSURE_PLAN_SQL, [userId]),
        core.getOneAsUser<DisclosureRow>(userId, LATEST_DISCLOSURE_SCRIPT_SQL, [userId]),
      ]);
      return { latest, latestWithScript };
    },
    recordConsent: async (userId) => (await recordPlannerConsent(userId)).granted,
    actingForSomeoneElse: () => actingForSomeoneElse(),
    lanes: (userId) => core.listLanes(userId, { includeArchived: true }),
    hurdlePlan: (userId) => core.getOneAsUser<HurdlePlanRow>(userId, LATEST_HURDLE_PLAN_SQL, [userId]),
    // readOnly: a chat turn never writes milestones or unlock grants.
    progression: (userId) => getProgression(userId, {}, true),
    meter: async (userId) => {
      const r = await loadSteelMan(userId);
      const score = scoreOf(r.counts);
      return { counts: r.counts, score, band: bandFor(score, isSteelMan(r.counts)).label };
    },
  };
}

export interface FullContextTurn {
  /** From the session (forgeUserId), never from the body. */
  userId: string | null | undefined;
  scope: "account" | "forge";
  platformOwner: boolean;
  staff: boolean;
  disclosureRehearsal: boolean;
}

/**
 * What /api/assistant puts in context.userFullContext for this turn: the
 * server-built snapshot for a participant on their own Refinery seat, null
 * for everyone else. It takes no body: whatever the browser sent under that
 * key was deleted before this runs and is never read.
 */
export async function serverFullContext(turn: FullContextTurn, load: (userId: string) => Promise<UserFullContext | null>): Promise<UserFullContext | null> {
  if (!turn.userId || turn.scope !== "account" || turn.platformOwner || turn.staff || turn.disclosureRehearsal) return null;
  try { return await load(turn.userId); } catch (err) { console.error("assistant full context failed:", err); return null; }
}
