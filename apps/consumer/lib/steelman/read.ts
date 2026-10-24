/**
 * Steel Man meter: the server read. Gathers the memo's scored signals from
 * their real tables, as the signed-in person (RLS-scoped, one transaction,
 * one round trip). Never cached across requests; db.ts already sends
 * `cache: "no-store"`. React `cache` memoizes within one request only.
 *
 * Signals read (memo section 1): S1 facts, S2 defended lines, S3 finished
 * resumes, S4 confirmed credentials (counted as proof, boss Q4), S5 lanes,
 * S7 tailored snapshots, S8 applications sent, S9 outcomes (moments only),
 * S10 voice practice (saved transcripts and server voice leases), S11 text
 * practice (client-reported), S12 disclosure
 * plan, S13 rehearsals, S14 vault proof, S15 feedback, S19 package delivered
 * (moment only), S23 grants (moments log).
 * Deliberately not read: S6 task pick, S16 resource feedback, S17 support
 * messages, S21 activity pings and S22 AI operations (not work, or not
 * durable), S18 review (not stored; the tick is a moment), S20 record checks
 * (private: the meter never reads the record), S24 placement outcomes
 * (written by staff, not the person).
 */
import { cache } from "react";
import { runAsUser as coreRunAsUser } from "@crucible/core";
import { TAILORED_PROVENANCES } from "@crucible/core/src/applicationEvents";
import { readMasterDraft } from "../master-draft";
import type { ComponentCounts, DatedUnit } from "./types";

export interface MeterGrant { grant_key: string; kind: "milestone" | "bonus" | "unlock"; label: string; created_at: string }

/** The runAsUser shape from packages/core/src/db.ts: one result per built statement (it slices off its own set_config row). */
export type RunAsUser = (userId: string, build: (sql: any) => unknown[]) => Promise<unknown>;

export interface SteelManRead {
  /** Every unit, including client-reported text practice. Drives the score and the feel-good moments. */
  counts: Required<ComponentCounts>;
  /**
   * Server-recorded units. Anything of value (bonus calls, the Steel Man
   * allowance) reads these, and only after a finished resume exists
   * (moments.ts). Server-recorded is not the same as checked: facts,
   * applications marked sent and documents are still the person's own word.
   * Feedback counts here only once Troy approved it; text practice never does.
   */
  serverCounts: Required<ComponentCounts>;
  dated: DatedUnit[];
  firstVoicePractice: boolean;
  /** A meter bonus (grant_key meter:*) already landed this UTC day: at most one per day. */
  meterBonusToday: boolean;
  planExists: boolean;
  forgeArrival: boolean;
  packageDelivered: boolean;
  outcomes: Array<"heard_back" | "interviewing" | "offered" | "hired">;
  /** Every moment:* and meter:* key already on the account. */
  grantKeys: Set<string>;
  /** Recent milestone and meter rows, newest first, for the moments log. */
  recent: MeterGrant[];
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
};
const dates = (rows: Row[] | undefined, key = "at") => (rows ?? []).map((r) => iso(r[key])).filter((d): d is string => !!d);

export async function loadSteelMan(userId: string, run: RunAsUser = coreRunAsUser as unknown as RunAsUser): Promise<SteelManRead> {
  const tailored = [...TAILORED_PROVENANCES];
  const r = (await run(userId, (sql) => [
    sql`SELECT profile_data->'masterDraft' AS master FROM consumer_profile WHERE user_id=${userId}::uuid`,
    // S2, S3: the latest finished revision of each non-demo resume.
    sql`WITH fin AS (
       SELECT r.artifact_id, r.defend_answers, r.created_at, r.source,
              row_number() OVER (PARTITION BY r.artifact_id ORDER BY r.revision_number DESC) AS rn,
              min(r.created_at) OVER (PARTITION BY r.artifact_id) AS first_at
       FROM artifact_revision r JOIN refinery_artifact a ON a.id=r.artifact_id AND a.user_id=r.user_id
       WHERE r.user_id=${userId}::uuid AND r.status='finished' AND NOT a.is_demo)
     SELECT first_at, created_at AS latest_at, source,
       (SELECT count(DISTINCT lower(btrim(e->>'line'))) FROM jsonb_array_elements(defend_answers) e
         WHERE jsonb_typeof(e)='object' AND e->>'verdict'='stands' AND COALESCE(e->>'kind','')<>'assisted'
           AND length(btrim(COALESCE(e->>'line','')))>0)::int AS lines,
       (SELECT bool_or(f2.source IN ('forge_finish','forge_import')) FROM fin f2 WHERE f2.artifact_id=fin.artifact_id) AS from_forge
     FROM fin WHERE rn=1`,
    // S4: distinct confirmed credentials on those latest finished revisions.
    sql`WITH fin AS (
       SELECT r.confirmed_credentials, r.created_at, row_number() OVER (PARTITION BY r.artifact_id ORDER BY r.revision_number DESC) AS rn
       FROM artifact_revision r JOIN refinery_artifact a ON a.id=r.artifact_id AND a.user_id=r.user_id
       WHERE r.user_id=${userId}::uuid AND r.status='finished' AND NOT a.is_demo),
     cred AS (SELECT lower(btrim(CASE jsonb_typeof(c) WHEN 'object' THEN c->>'text' WHEN 'string' THEN c#>>'{}' END)) AS k, f.created_at
       FROM fin f, jsonb_array_elements(f.confirmed_credentials) c WHERE f.rn=1)
     SELECT min(created_at) AS at FROM cred WHERE k IS NOT NULL AND k<>'' GROUP BY k`,
    // S5: lanes in use = open lanes holding a finished, non-example artifact. Work outside any
    // named lane (lane_id NULL, the main lane) counts as one lane.
    sql`SELECT min(r.created_at) AS at FROM artifact_revision r
       JOIN refinery_artifact a ON a.id=r.artifact_id AND a.user_id=r.user_id AND NOT a.is_demo
       LEFT JOIN career_lane l ON l.id=a.lane_id AND l.user_id=a.user_id
       WHERE r.user_id=${userId}::uuid AND r.status='finished' AND (a.lane_id IS NULL OR l.archived_at IS NULL AND l.id IS NOT NULL)
       GROUP BY COALESCE(a.lane_id::text,'main')`,
    // S7: distinct applications with a tailored resume snapshot (the gate's own provenance list).
    sql`SELECT min(created_at) AS at FROM application_document
       WHERE user_id=${userId}::uuid AND document_type='resume' AND provenance = ANY(string_to_array(${tailored.join(",")}, ',')) GROUP BY application_id`,
    // S8: distinct applications moved to applied (append-only ledger).
    sql`SELECT min(created_at) AS at FROM application_status_event WHERE user_id=${userId}::uuid AND to_status='applied' GROUP BY application_id`,
    // S10: voice practice, server truth from two tables. A saved transcript
    // (interview_voice_session) is only made when the person chooses to save
    // it; every voice practice runs on a server voice lease (voice_session).
    // Until 10/24 only the first was read, so a voice practice run without
    // saving its words counted nowhere (its client ping is excluded from S11 by
    // design). A lease counts when the person ended it after at least 60
    // seconds of call time (DESIGN HYPOTHESIS: under a minute is a mis-tap,
    // not practice) and no saved transcript already counts the same call.
    sql`SELECT at FROM (
       SELECT COALESCE(t.ended_at, t.started_at) AS at FROM interview_voice_session t
        WHERE t.owner_user_id=${userId}::uuid AND t.status='ended'
       UNION ALL
       SELECT vs.ended_at AS at FROM voice_session vs
        WHERE vs.user_id=${userId}::uuid AND vs.status='ended' AND vs.ended_reason='user_ended'
          AND vs.ended_at IS NOT NULL AND vs.ended_at - vs.started_at >= interval '60 seconds'
          AND NOT EXISTS (SELECT 1 FROM interview_voice_session t2
                           WHERE t2.owner_user_id=vs.user_id AND t2.status='ended'
                             AND t2.started_at >= vs.started_at - interval '5 minutes' AND t2.started_at <= vs.ended_at)
     ) v ORDER BY 1 DESC LIMIT 100`,
    // S11: client-reported completions, minus voice (voice is counted from S10).
    sql`SELECT created_at AS at FROM user_progress_event WHERE user_id=${userId}::uuid AND event_type='interview_completed'
       AND COALESCE(context->>'mode','')<>'voice' ORDER BY created_at DESC LIMIT 100`,
    // S12, S13: the disclosure plan and ended rehearsals.
    sql`SELECT min(created_at) AS at FROM refinery_artifact WHERE user_id=${userId}::uuid AND artifact_type='disclosure_plan' AND NOT is_demo`,
    sql`SELECT COALESCE(ended_at, started_at) AS at FROM disclosure_rehearsal_session WHERE owner_user_id=${userId}::uuid AND status='ended' ORDER BY 1 DESC LIMIT 100`,
    // S14: proof documents, not notes.
    sql`SELECT created_at AS at FROM vault_document WHERE user_id=${userId}::uuid AND category<>'note' ORDER BY created_at DESC LIMIT 100`,
    // S15: feedback and bug reports not denied (approved ones also count toward value).
    sql`SELECT created_at AS at, status FROM progression_request WHERE user_id=${userId}::uuid AND kind IN ('feedback','bug') AND status<>'denied'`,
    // S9: outcomes ever reached. Celebrated, never scored.
    sql`SELECT DISTINCT to_status FROM application_status_event WHERE user_id=${userId}::uuid AND to_status IN ('heard_back','interviewing','offered','hired')`,
    // S19: a package email delivered.
    sql`SELECT EXISTS(SELECT 1 FROM forge_package_email_sent WHERE user_id=${userId}::uuid AND delivered_at IS NOT NULL) AS delivered`,
    // S23: meter keys already granted, and the recent moments log.
    sql`SELECT grant_key FROM progression_grant WHERE user_id=${userId}::uuid AND (grant_key LIKE 'moment:%' OR grant_key LIKE 'meter:%')`,
    sql`SELECT grant_key, kind, label, created_at FROM progression_grant WHERE user_id=${userId}::uuid
       AND (kind='milestone' OR grant_key LIKE 'meter:%') ORDER BY created_at DESC LIMIT 20`,
    sql`SELECT EXISTS(SELECT 1 FROM progression_grant WHERE user_id=${userId}::uuid AND kind='bonus' AND grant_key LIKE 'meter:%'
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today`,
  ])) as Row[][];
  // runAsUser already drops its set_config row (db.ts), so r[0] is the first statement above.
  const [masterRows, finRows, credRows, laneRows, tailoredRows, sentRows, voiceRows, textRows, planRows, rehearsalRows, vaultRows, feedbackRows, outcomeRows, packageRows, keyRows, recentRows, todayRows] = r;

  const master = readMasterDraft(masterRows?.[0]?.master);
  const confirmed = master.facts.filter((f) => f.status === "confirmed");
  const fin = finRows ?? [];
  const best = fin.reduce<Row | null>((b, row) => (!b || Number(row.lines) > Number(b.lines) ? row : b), null);
  const lines = best ? Number(best.lines) || 0 : 0;
  const voice = dates(voiceRows), text = dates(textRows), plan = dates(planRows), rehearsal = dates(rehearsalRows);
  const credentials = dates(credRows), vault = dates(vaultRows);

  const counts = {
    facts: confirmed.length, lines, resumes: fin.length, lanes: (laneRows ?? []).length,
    tailored: (tailoredRows ?? []).length, sent: (sentRows ?? []).length,
    practice: voice.length + text.length, disclosure: plan.length + rehearsal.length,
    proof: vault.length + credentials.length, feedback: (feedbackRows ?? []).length,
  };
  const dated: DatedUnit[] = [
    ...confirmed.flatMap((f) => (f.confirmedAt ? [{ component: "facts" as const, at: f.confirmedAt }] : [])),
    ...(best && iso(best.latest_at) ? Array.from({ length: lines }, () => ({ component: "lines" as const, at: iso(best.latest_at)! })) : []),
    ...dates(fin, "first_at").map((at) => ({ component: "resumes" as const, at })),
    ...dates(laneRows).map((at) => ({ component: "lanes" as const, at })),
    ...dates(tailoredRows).map((at) => ({ component: "tailored" as const, at })),
    ...dates(sentRows).map((at) => ({ component: "sent" as const, at })),
    ...[...voice, ...text].map((at) => ({ component: "practice" as const, at })),
    ...[...plan, ...rehearsal].map((at) => ({ component: "disclosure" as const, at })),
    ...[...vault, ...credentials].map((at) => ({ component: "proof" as const, at })),
    ...dates(feedbackRows).map((at) => ({ component: "feedback" as const, at })),
  ];
  return {
    counts,
    serverCounts: { ...counts, practice: voice.length, feedback: (feedbackRows ?? []).filter((f) => f.status === "approved").length },
    dated,
    firstVoicePractice: voice.length > 0,
    meterBonusToday: todayRows?.[0]?.today === true,
    planExists: plan.length > 0,
    forgeArrival: fin.some((row) => row.from_forge === true),
    packageDelivered: packageRows?.[0]?.delivered === true,
    outcomes: (outcomeRows ?? []).map((o) => String(o.to_status)).filter((s): s is SteelManRead["outcomes"][number] => ["heard_back", "interviewing", "offered", "hired"].includes(s)),
    grantKeys: new Set((keyRows ?? []).map((k) => String(k.grant_key))),
    recent: (recentRows ?? []).map((g) => ({ grant_key: String(g.grant_key), kind: g.kind as MeterGrant["kind"], label: String(g.label), created_at: iso(g.created_at) ?? "" })),
  };
}

/** Per-request memo only. A new request always reads the database again. */
export const readSteelMan = cache((userId: string) => loadSteelMan(userId));
