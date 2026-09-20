/**
 * Outcome aggregate read model for the proof spine.
 * Returns funnel counts and consented case studies -- no PII in aggregates.
 * All reads log to data_access_log per governance requirement.
 */

import { query, getOne, runPerOrg } from "./db";

/**
 * Run a query that joins access_code_redemption, scoped to the ONE
 * organization named by `code`. Membership is row-level protected, so a plain
 * query() here returns zeros -- which on an evidence report is not an error,
 * it is a false statement about a partner. Callers are platform-admin routes;
 * they are scoped to each org in turn rather than given a see-everything rule.
 */
async function queryForCode<T>(code: string, sqlText: string, params: unknown[]): Promise<T[]> {
  const org = await getOne<{ id: string }>(`SELECT id FROM access_code WHERE code = $1`, [code]);
  if (!org) return [];
  const out = await runPerOrg<T>([org.id], "", sqlText, () => params);
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
export async function getFunnelAggregate(opts?: {
  partnerCode?: string;
  fromDate?: Date;
  toDate?: Date;
}): Promise<FunnelCounts> {
  const dateFilter = buildDateFilter(opts);

  if (opts?.partnerCode) {
    // Scoped to users who redeemed this partner's code
    const rows = await queryForCode<FunnelCounts>(
      opts.partnerCode,
      `SELECT
        COUNT(DISTINCT fs.id) FILTER (WHERE fs.status IN ('in_progress', 'completed', 'abandoned'))
          AS forge_sessions_started,
        COUNT(DISTINCT fs.id) FILTER (WHERE fs.status = 'completed')
          AS forge_sessions_completed,
        COUNT(DISTINCT ra.user_id)
          AS refinery_users,
        COUNT(DISTINCT ja.id)
          AS applications_logged,
        COUNT(DISTINCT ja.id) FILTER (WHERE ja.status IN ('interviewing', 'heard_back', 'offered', 'hired', 'started_work'))
          AS interviews,
        COUNT(DISTINCT ja.id) FILTER (WHERE ja.status IN ('offered', 'hired', 'started_work'))
          AS offers,
        COUNT(DISTINCT ja.id) FILTER (WHERE ja.status IN ('hired', 'started_work'))
          AS hires
      FROM access_code ac
      JOIN access_code_redemption acr ON acr.access_code_id = ac.id
      LEFT JOIN forge_session fs ON fs.user_id = acr.user_id ${dateFilter ? `AND fs.started_at >= $2 AND fs.started_at <= $3` : ""}
      LEFT JOIN refinery_artifact ra ON ra.user_id = acr.user_id
      LEFT JOIN job_application ja ON ja.user_id = acr.user_id
      WHERE ac.code = $1`,
      opts.partnerCode
        ? dateFilter
          ? [opts.partnerCode, opts.fromDate, opts.toDate]
          : [opts.partnerCode]
        : []
    );
    return rows[0] ?? emptyFunnel();
  }

  // Platform-wide
  const rows = await query<FunnelCounts>(
    `SELECT
      COUNT(DISTINCT id) FILTER (WHERE status IN ('in_progress', 'completed', 'abandoned'))
        AS forge_sessions_started,
      COUNT(DISTINCT id) FILTER (WHERE status = 'completed')
        AS forge_sessions_completed,
      (SELECT COUNT(DISTINCT user_id) FROM refinery_artifact) AS refinery_users,
      (SELECT COUNT(*) FROM job_application) AS applications_logged,
      (SELECT COUNT(*) FROM job_application WHERE status IN ('interviewing', 'heard_back', 'offered', 'hired', 'started_work')) AS interviews,
      (SELECT COUNT(*) FROM job_application WHERE status IN ('offered', 'hired', 'started_work')) AS offers,
      (SELECT COUNT(*) FROM job_application WHERE status IN ('hired', 'started_work')) AS hires
    FROM forge_session`,
    []
  );
  return rows[0] ?? emptyFunnel();
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
export async function getAggregateReport(): Promise<AggregateReport> {
  const [platform_funnel, by_partner, caseCount] = await Promise.all([
    getFunnelAggregate(),
    getPartnerBreakdowns(),
    getConsentedCaseStudyCount(),
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
export async function getConsentedCaseStudies(opts?: {
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
      FROM job_application ja
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

  const studies = await query<ConsentedCaseStudy & { owner_user_id?: string }>(
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
    FROM job_application ja
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
      "",
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

async function getConsentedCaseStudyCount(): Promise<number> {
  const row = await getOne<{ count: string }>(
    `SELECT COUNT(DISTINCT ja.id) AS count
     FROM job_application ja
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
