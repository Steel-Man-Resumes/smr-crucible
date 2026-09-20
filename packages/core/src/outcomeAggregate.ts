/**
 * Outcome aggregate read model for the proof spine.
 * Returns funnel counts and consented case studies -- no PII in aggregates.
 * All reads log to data_access_log per governance requirement.
 */

import { query, getOne, queryAsUser, getOneAsUser, runPerOrg } from "./db";

/**
 * Run a query that joins access_code_redemption, scoped to the ONE
 * organization named by `code`. Membership is row-level protected, so a plain
 * query() here returns zeros -- which on an evidence report is not an error,
 * it is a false statement about a partner. Callers are platform-admin routes;
 * they are scoped to each org in turn rather than given a see-everything rule.
 */
async function queryForCode<T>(adminUserId: string, code: string, sqlText: string, params: unknown[]): Promise<T[]> {
  const org = await getOne<{ id: string }>(`SELECT id FROM access_code WHERE code = $1`, [code]);
  if (!org) return [];
  // The admin is the ACTOR: admin_job_application / admin_refinery_artifact answer
  // only to someone in platform_admin, a table the application cannot write.
  const out = await runPerOrg<T>([org.id], adminUserId, sqlText, () => params);
  return out.get(org.id) ?? [];
}

export interface FunnelCounts {
  forge_sessions_started: number;
  forge_sessions_completed: number;
  refinery_users: number;
  applications_logged: number;
  interviews: number;
  offers: number;
  hires: number;
}

export interface PartnerBreakdown {
  partner_code: string;
  partner_name: string;
  funnel: FunnelCounts;
}

export interface AggregateReport {
  as_of: string;
  platform_funnel: FunnelCounts;
  by_partner: PartnerBreakdown[];
  consented_case_count: number;
}

export interface ConsentedCaseStudy {
  id: string;
  display_name: string | null;
  outcome_summary: string;
  tool_path: string;
  consent_scope: "outcome_anonymous" | "outcome_named";
  partner_name: string | null;
  created_at: string;
}

/**
 * Build the platform-wide funnel aggregate, optionally scoped to a partner code.
 * No PII -- all counts only.
 */
export async function getFunnelAggregate(opts: {
  partnerCode?: string;
  fromDate?: Date;
  toDate?: Date;
} = {}): Promise<FunnelCounts> {
  // Seven integers from a database function, and nothing about any person. The
  // participant's tables are owner-only under row-level security, so there is no
  // row-reading path left for a report to use -- including the nightly tracking
  // sync, which runs with nobody signed in.
  const useDates = buildDateFilter(opts);
  const rows = await query<Record<keyof FunnelCounts, string | number>>(
    `SELECT * FROM smr_funnel_counts($1, $2, $3)`,
    [opts.partnerCode ?? null, useDates ? opts.fromDate : null, useDates ? opts.toDate : null]
  );
  const r = rows[0];
  if (!r) return emptyFunnel();
  const out = emptyFunnel();
  for (const k of Object.keys(out) as (keyof FunnelCounts)[]) (out[k] as number) = Number(r[k] ?? 0);
  return out;
}

/**
 * Per-partner breakdown for the admin evidence dashboard.
 */
export async function getPartnerBreakdowns(): Promise<PartnerBreakdown[]> {
  const codes = await query<{ code: string; partner_name: string }>(
    `SELECT code, partner_name FROM access_code WHERE is_active = true ORDER BY created_at DESC`,
    []
  );

  const breakdowns = await Promise.all(
    codes.map(async (ac) => ({
      partner_code: ac.code,
      partner_name: ac.partner_name,
      funnel: await getFunnelAggregate({ partnerCode: ac.code }),
    }))
  );

  return breakdowns;
}

/**
 * Full aggregate report for the admin evidence dashboard.
 */
export async function getAggregateReport(adminUserId: string): Promise<AggregateReport> {
  const [platform_funnel, by_partner, caseCount] = await Promise.all([
    getFunnelAggregate(),
    getPartnerBreakdowns(),
    getConsentedCaseStudyCount(adminUserId),
  ]);

  return {
    as_of: new Date().toISOString(),
    platform_funnel,
    by_partner,
    consented_case_count: caseCount,
  };
}

/**
 * Fetch consented case studies for public display.
 * Only returns records where the user has an active outcome consent scope.
 * NEVER returns a record without a matching consent row -- this is enforced at the query level.
 */
export async function getConsentedCaseStudies(opts: {
  /** The platform admin asking. */
  adminUserId: string;
  limit?: number;
  partnerCode?: string;
  scope?: "outcome_anonymous" | "outcome_named";
}): Promise<ConsentedCaseStudy[]> {
  const limit = opts?.limit ?? 10;
  const scopeFilter = opts?.scope
    ? `AND cc.consent_layer = '${opts.scope}'`
    : `AND cc.consent_layer IN ('outcome_anonymous', 'outcome_named')`;

  if (opts?.partnerCode) {
    return queryForCode<ConsentedCaseStudy>(
      opts.adminUserId,
      opts.partnerCode,
      `SELECT
        ja.id,
        CASE WHEN cc.consent_layer = 'outcome_named'
          THEN u.name
          ELSE NULL
        END AS display_name,
        ja.job_title || ' at ' || ja.company AS outcome_summary,
        'job_application' AS tool_path,
        cc.consent_layer AS consent_scope,
        ac.partner_name,
        ja.created_at
      FROM admin_job_application ja
      JOIN consumer_consent cc ON cc.user_id = ja.user_id ${scopeFilter} AND cc.status = 'granted'
      JOIN "user" u ON u.id = ja.user_id
      JOIN access_code_redemption acr ON acr.user_id = ja.user_id
      JOIN access_code ac ON ac.id = acr.access_code_id AND ac.code = $1
      WHERE ja.status IN ('hired', 'started_work')
      ORDER BY ja.hired_at DESC NULLS LAST, ja.updated_at DESC
      LIMIT $2`,
      [opts.partnerCode, limit]
    );
  }

  const studies = await queryAsUser<ConsentedCaseStudy & { owner_user_id?: string }>(
    opts.adminUserId,
    `SELECT
      ja.id,
      CASE WHEN cc.consent_layer = 'outcome_named'
        THEN u.name
        ELSE NULL
      END AS display_name,
      ja.job_title || ' at ' || ja.company AS outcome_summary,
      'job_application' AS tool_path,
      cc.consent_layer AS consent_scope,
      NULL::text AS partner_name,
      ja.user_id AS owner_user_id,
      ja.created_at
    FROM admin_job_application ja
    JOIN consumer_consent cc ON cc.user_id = ja.user_id ${scopeFilter} AND cc.status = 'granted'
    JOIN "user" u ON u.id = ja.user_id
    WHERE ja.status IN ('hired', 'started_work')
    ORDER BY ja.hired_at DESC NULLS LAST, ja.updated_at DESC
    LIMIT $1`,
    [limit]
  );

  // Which partner each person came through. That was a correlated subquery on
  // access_code_redemption; under row-level security it quietly yields NULL
  // for everyone. Ask each organization, scoped to it, which of these people
  // are its members.
  const owners = Array.from(new Set(studies.map((st) => st.owner_user_id).filter(Boolean))) as string[];
  if (owners.length > 0) {
    const orgs = await query<{ id: string; partner_name: string }>(
      `SELECT id, partner_name FROM access_code ORDER BY created_at`
    );
    const members = await runPerOrg<{ user_id: string }>(
      orgs.map((o) => o.id),
      opts.adminUserId,
      `SELECT user_id FROM access_code_redemption WHERE access_code_id = $1 AND user_id = ANY($2::uuid[])`,
      (orgId) => [orgId, owners]
    );
    const partnerOf = new Map<string, string>();
    for (const o of orgs) {
      for (const m of members.get(o.id) ?? []) {
        if (!partnerOf.has(m.user_id)) partnerOf.set(m.user_id, o.partner_name);
      }
    }
    for (const st of studies) {
      st.partner_name = (st.owner_user_id && partnerOf.get(st.owner_user_id)) || null;
    }
  }
  return studies.map(({ owner_user_id: _owner, ...rest }) => rest as ConsentedCaseStudy);
}

async function getConsentedCaseStudyCount(adminUserId: string): Promise<number> {
  const row = await getOneAsUser<{ count: string }>(
    adminUserId,
    `SELECT COUNT(DISTINCT ja.id) AS count
     FROM admin_job_application ja
     JOIN consumer_consent cc ON cc.user_id = ja.user_id
       AND cc.consent_layer IN ('outcome_anonymous', 'outcome_named')
       AND cc.status = 'granted'
     WHERE ja.status IN ('hired', 'started_work')`,
    []
  );
  return parseInt(row?.count ?? "0", 10);
}

function buildDateFilter(opts?: { fromDate?: Date; toDate?: Date }): boolean {
  return !!(opts?.fromDate && opts?.toDate);
}

function emptyFunnel(): FunnelCounts {
  return {
    forge_sessions_started: 0,
    forge_sessions_completed: 0,
    refinery_users: 0,
    applications_logged: 0,
    interviews: 0,
    offers: 0,
    hires: 0,
  };
}
