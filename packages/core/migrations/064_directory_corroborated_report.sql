-- 064_directory_corroborated_report.sql
-- Two independent public reports of hiring at a local employer earn the mark,
-- as Likely.
--
-- WHY. Under 061 a `reported_hire` (a news feature, a reentry program's list of
-- employer partners, a work-release roster, a grant report, a certification
-- with written criteria) never earns the mark: one outside report is one voice.
-- Two such reports from DIFFERENT publishers, about the same local employer,
-- within twelve months, are two voices. Approved as a new evidence standard on
-- 2026-09-29 (catalog row T11 of the directory's verification plan).
--
-- THE RULE, AS DATA. A new policy row, `corroborated_report`: polarity yes,
-- 180 days, earns the mark, needs two sources, reaches a county. The standing
-- view reads its ttl_days, earns_mark and inherit_level.
--
-- DERIVED, NEVER STORED. Evidence in 061 is one source per item, and the only
-- existing two-source rule (negative_experience) is counted in the standing
-- view across items, by the independent organizations in `source_orgs`. This
-- follows that design instead of adding link tables: an agent records each
-- report as its own `reported_hire` item, and the corroboration is computed
-- when the standing is read. A `corroborated_report` evidence row is refused
-- outright (constraint evidence_corroboration_is_derived), so there is no way
-- to write one that lacks its two sources, and when either source is
-- withdrawn, superseded or expires, the corroboration goes with it.
--
-- WHAT COUNTS AS A PAIR (one function, directory_reports_corroborate, so the
-- rule lives in one place and can be tested on its own):
--   - both are live `reported_hire` items that reach this place locally
--     (never company-wide, never a single role, never casework);
--   - each one meets Likely on its own (a link, an access date, an A or B
--     source): two weak reports do not make a strong one;
--   - each names at least one independent organization in source_orgs, the
--     two lists share none, and both name a publisher and the publishers
--     differ once normalized. The same outlet twice is one source;
--   - they were observed within 365 days of each other.
-- The corroboration lasts 180 days from the later report, and never longer
-- than either report lasts on its own.
--
-- CONFIDENCE. Always Likely, never Certain: Certain needs a live relationship
-- (061, finding 6), and outside reports are not one.
--
-- The standing view keeps its output columns; one new standing value,
-- 'corroborated_here', sits below 'says_yes_here' and above
-- 'says_yes_for_roles'. A yes never hides a no: a corroborated employer with
-- a written no or two bad-experience sources still reads 'mixed'. Grants are
-- unchanged (CREATE OR REPLACE VIEW keeps them; the new function is pure).

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------
-- Seeded once. A later change to a rule is a new migration.
INSERT INTO directory_claim_policy (claim_type, polarity, ttl_days, earns_mark, needs_two_sources, inherit_level, meaning) VALUES
  ('corroborated_report', 'yes', 180, true, true, 'county',
   'Two independent public reports of hiring people with records at this local employer, from different publishers within 12 months. Computed from two reported_hire items, never recorded directly. Likely, never Certain')
ON CONFLICT (claim_type) DO NOTHING;

-- Nobody writes a corroboration by hand; it only exists when its two reports do.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_corroboration_is_derived'
                    AND conrelid = 'public.employer_evidence'::regclass) THEN
    ALTER TABLE employer_evidence ADD CONSTRAINT evidence_corroboration_is_derived
      CHECK (claim_type <> 'corroborated_report');
  END IF;
END $$;

-- Are these two reports independent, and close enough in time? Pure: it sees
-- only what it is given, so a test can call it with any dates.
CREATE OR REPLACE FUNCTION public.directory_reports_corroborate(
  orgs_a text[], publisher_a text, observed_a date,
  orgs_b text[], publisher_b text, observed_b date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
       cardinality(orgs_a) >= 1 AND cardinality(orgs_b) >= 1
       AND NOT (orgs_a && orgs_b)
       AND length(public.directory_normalize_name(publisher_a)) >= 2
       AND length(public.directory_normalize_name(publisher_b)) >= 2
       AND public.directory_normalize_name(publisher_a) <> public.directory_normalize_name(publisher_b)
       AND abs(observed_a - observed_b) <= 365,
     false)
$$;

-- ---------------------------------------------------------------------------
-- 2. The standing, derived on read (063 plus the corroboration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW employer_standing_v WITH (security_barrier = true) AS
WITH pe AS (
  SELECT d.*, (d.coverage <> 'company') AS is_local,
         -- Casework dates never reach the public more precisely than a quarter.
         CASE WHEN d.source_kind = 'casework_aggregate' THEN date_trunc('quarter', d.observed_on)::date
              ELSE greatest(d.observed_on, coalesce(d.accessed_on, d.observed_on)) END AS public_date,
         CASE WHEN d.source_kind = 'casework_aggregate' THEN date_trunc('quarter', d.expires_on)::date
              ELSE d.expires_on END AS public_expiry,
         CASE d.effective_confidence WHEN 'certain' THEN 3 WHEN 'likely' THEN 2 ELSE 1 END AS conf_rank,
         p.local_operator_earns_mark
    FROM directory_place_evidence d
    JOIN directory_claim_policy p ON p.claim_type = d.claim_type
), bad AS (
  -- Independent organizations reporting a bad experience here, counted once each.
  SELECT pe.target_place_id, count(DISTINCT so) AS bad_sources
    FROM pe CROSS JOIN LATERAL unnest(pe.source_orgs) so
   WHERE pe.is_local AND pe.claim_type = 'negative_experience' AND pe.scope <> 'role'
   GROUP BY pe.target_place_id
), cp AS (
  SELECT p.ttl_days, p.earns_mark, p.inherit_level FROM directory_claim_policy p WHERE p.claim_type = 'corroborated_report'
), corr AS (
  -- Two independent public reports of hiring here (064). Each pair is counted
  -- once (a.id < b.id); the best pair decides how long the corroboration lasts.
  SELECT a.target_place_id,
         max(least(a.expires_on, b.expires_on, greatest(a.observed_on, b.observed_on) + cp.ttl_days)) AS corr_expiry,
         bool_or(cp.earns_mark) AS corr_mark
    FROM pe a
    JOIN pe b ON b.target_place_id = a.target_place_id AND a.id < b.id
    CROSS JOIN cp
   WHERE a.claim_type = 'reported_hire' AND b.claim_type = 'reported_hire'
     AND a.is_local AND b.is_local AND a.scope <> 'role' AND b.scope <> 'role'
     AND a.source_kind <> 'casework_aggregate' AND b.source_kind <> 'casework_aggregate'
     -- How far a corroboration may reach comes from its own policy row.
     AND (a.coverage = 'place' OR (a.coverage = 'county' AND cp.inherit_level IN ('county', 'state'))
                               OR (a.coverage = 'state'  AND cp.inherit_level = 'state'))
     AND (b.coverage = 'place' OR (b.coverage = 'county' AND cp.inherit_level IN ('county', 'state'))
                               OR (b.coverage = 'state'  AND cp.inherit_level = 'state'))
     -- Each report stands as Likely on its own.
     AND a.conf_rank >= 2 AND b.conf_rank >= 2
     AND public.directory_reports_corroborate(a.source_orgs, a.publisher, a.observed_on,
                                              b.source_orgs, b.publisher, b.observed_on)
     AND least(a.expires_on, b.expires_on, greatest(a.observed_on, b.observed_on) + cp.ttl_days) >= current_date
   GROUP BY a.target_place_id
), f AS (
  SELECT pe.target_place_id,
    bool_or(pe.is_local AND pe.claim_type = 'confirmed_hire')                              AS hire,
    bool_or(pe.is_local AND pe.claim_type = 'staff_attestation')                           AS attest,
    bool_or(pe.is_local AND pe.claim_type = 'employer_statement' AND pe.scope <> 'role')   AS local_yes,
    bool_or(pe.is_local AND pe.claim_type = 'direct_role_signal')                          AS role_yes,
    bool_or(pe.is_local AND pe.claim_type = 'reported_hire')                               AS reported,
    bool_or(pe.claim_type = 'confirmed_corporate')                                         AS corporate,
    -- A role-limited "no" excludes that role in matching; it does not say no for the whole place.
    bool_or(pe.claim_type = 'negative_written' AND pe.scope <> 'role')                     AS said_no,
    bool_or(pe.is_local AND pe.claim_type = 'confirmed_hire' AND pe.claim_earns_mark)      AS hire_mark,
    bool_or(pe.is_local AND pe.claim_type = 'staff_attestation' AND pe.claim_earns_mark)   AS attest_mark,
    bool_or(pe.is_local AND pe.claim_type = 'employer_statement' AND pe.scope <> 'role' AND pe.claim_earns_mark) AS local_yes_mark,
    -- The employer's own published policy, for an employer that only operates
    -- locally (Troy, 2026-09-24). Whether the org qualifies is decided in s.
    bool_or(pe.claim_type = 'confirmed_corporate')                                         AS own_policy,
    bool_or(pe.claim_type = 'confirmed_corporate' AND pe.local_operator_earns_mark)        AS own_policy_mark,
    max(pe.conf_rank) FILTER (WHERE pe.claim_type = 'confirmed_corporate')                 AS c_own_policy,
    min(pe.public_expiry) FILTER (WHERE pe.claim_type = 'confirmed_corporate')             AS own_policy_expiry,
    -- Confidence belongs to the evidence that decided the standing, not to all of it (finding 6).
    max(pe.conf_rank) FILTER (WHERE pe.is_local AND pe.claim_type = 'confirmed_hire')                          AS c_hire,
    max(pe.conf_rank) FILTER (WHERE pe.is_local AND pe.claim_type = 'staff_attestation')                       AS c_attest,
    max(pe.conf_rank) FILTER (WHERE pe.is_local AND pe.claim_type = 'employer_statement' AND pe.scope <> 'role') AS c_local_yes,
    max(pe.conf_rank) FILTER (WHERE pe.is_local AND pe.claim_type = 'direct_role_signal')                      AS c_role,
    max(pe.conf_rank) FILTER (WHERE pe.is_local AND pe.claim_type = 'reported_hire')                           AS c_reported,
    max(pe.conf_rank) FILTER (WHERE pe.claim_type = 'confirmed_corporate')                                     AS c_corporate,
    max(pe.conf_rank) FILTER (WHERE pe.polarity = 'no')                                                        AS c_no,
    min(pe.public_expiry) FILTER (WHERE pe.polarity = 'yes' AND pe.is_local)                                  AS soonest_local_expiry,
    max(pe.public_date)                                                                                        AS last_evidence_on,
    array_agg(pe.id ORDER BY pe.observed_on DESC)                                                              AS evidence_ids
  FROM pe
  GROUP BY pe.target_place_id
), s AS (
  SELECT pl.id AS place_id, pl.org_id, o.org_kind,
    -- Operates only locally: a government employer, or a business marked
    -- independent. A chain's policy never counts here; its store is not it.
    (o.org_kind = 'government' OR o.operating_model = 'independent') AS local_operator,
    f.*, coalesce(bad.bad_sources, 0) AS bad_sources,
    (coalesce(bad.bad_sources, 0) >= (SELECT CASE WHEN p.needs_two_sources THEN 2 ELSE 1 END
                                        FROM directory_claim_policy p WHERE p.claim_type = 'negative_experience')) AS bad_enough,
    (corr.target_place_id IS NOT NULL) AS corroborated, corr.corr_mark, corr.corr_expiry
  FROM employer_place pl
  JOIN employer_org o ON o.id = pl.org_id
  LEFT JOIN f ON f.target_place_id = pl.id
  LEFT JOIN bad ON bad.target_place_id = pl.id
  LEFT JOIN corr ON corr.target_place_id = pl.id
), r AS (
  SELECT s.*,
    CASE
      WHEN s.org_kind = 'ecosystem_partner' THEN 'not_an_employer'
      -- A strong local yes and a no, together, is mixed; a yes never hides a no.
      -- (A corroboration is made of reported hires, so `reported` covers it.)
      WHEN (coalesce(s.hire OR s.attest OR s.local_yes OR s.role_yes OR s.reported, false)
            OR (s.local_operator AND coalesce(s.own_policy, false)))
           AND (coalesce(s.said_no, false) OR s.bad_enough)                       THEN 'mixed'
      WHEN coalesce(s.said_no, false)                                             THEN 'says_no'
      -- Two independent reports of being turned down, with no local yes (finding 7).
      WHEN s.bad_enough                                                           THEN 'reported_turned_down'
      WHEN coalesce(s.hire, false)                                                THEN 'proven_here'
      WHEN coalesce(s.attest, false)                                              THEN 'vouched_here'
      WHEN coalesce(s.local_yes, false) OR (s.local_operator AND coalesce(s.own_policy, false)) THEN 'says_yes_here'
      -- Two independent public reports of hiring here (064).
      WHEN s.corroborated                                                         THEN 'corroborated_here'
      WHEN coalesce(s.role_yes, false)                                            THEN 'says_yes_for_roles'
      WHEN coalesce(s.reported, false)                                            THEN 'reported_here'
      WHEN coalesce(s.corporate, false)                                           THEN 'company_policy'
      ELSE 'lead'
    END AS standing
  FROM s
)
SELECT r.place_id, r.org_id, r.standing,
       coalesce(CASE r.standing WHEN 'proven_here' THEN r.hire_mark
                                WHEN 'vouched_here' THEN r.attest_mark
                                WHEN 'says_yes_here' THEN coalesce(r.local_yes_mark, false)
                                                          OR (r.local_operator AND coalesce(r.own_policy_mark, false))
                                WHEN 'corroborated_here' THEN r.corr_mark END, false) AS earns_mark,
       CASE (CASE r.standing
               WHEN 'proven_here' THEN r.c_hire WHEN 'vouched_here' THEN r.c_attest
               WHEN 'says_yes_here' THEN greatest(r.c_local_yes, CASE WHEN r.local_operator THEN r.c_own_policy END)
               -- Likely, never Certain: outside reports are not a relationship.
               WHEN 'corroborated_here' THEN 2
               WHEN 'says_yes_for_roles' THEN r.c_role
               WHEN 'reported_here' THEN r.c_reported WHEN 'company_policy' THEN r.c_corporate
               WHEN 'mixed' THEN r.c_no WHEN 'says_no' THEN r.c_no WHEN 'reported_turned_down' THEN r.c_no END)
         WHEN 3 THEN 'certain' WHEN 2 THEN 'likely' WHEN 1 THEN 'guessing' END AS confidence,
       r.bad_sources,
       CASE WHEN r.standing = 'says_yes_here' AND r.local_operator
            THEN least(r.soonest_local_expiry, r.own_policy_expiry)
            -- A corroboration ends 180 days after its later report, sooner than either report.
            WHEN r.standing = 'corroborated_here'
            THEN least(r.soonest_local_expiry, r.corr_expiry)
            ELSE r.soonest_local_expiry END AS soonest_local_expiry,
       r.last_evidence_on, coalesce(r.evidence_ids, '{}') AS evidence_ids
  FROM r;
