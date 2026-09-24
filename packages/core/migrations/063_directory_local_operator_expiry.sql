-- 063_directory_local_operator_expiry.sql
-- A mark shows when it runs out, including a local operator's own policy.
--
-- 062 let a government or independent employer's own policy earn the mark,
-- but `soonest_local_expiry` only looked at place-level evidence, so Flathead
-- County's mark showed no expiry at all (found in the import dry run). Every
-- mark must show its age and its end on its face. Output columns unchanged.

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
                                        FROM directory_claim_policy p WHERE p.claim_type = 'negative_experience')) AS bad_enough
  FROM employer_place pl
  JOIN employer_org o ON o.id = pl.org_id
  LEFT JOIN f ON f.target_place_id = pl.id
  LEFT JOIN bad ON bad.target_place_id = pl.id
), r AS (
  SELECT s.*,
    CASE
      WHEN s.org_kind = 'ecosystem_partner' THEN 'not_an_employer'
      -- A strong local yes and a no, together, is mixed; a yes never hides a no.
      WHEN (coalesce(s.hire OR s.attest OR s.local_yes OR s.role_yes OR s.reported, false)
            OR (s.local_operator AND coalesce(s.own_policy, false)))
           AND (coalesce(s.said_no, false) OR s.bad_enough)                       THEN 'mixed'
      WHEN coalesce(s.said_no, false)                                             THEN 'says_no'
      -- Two independent reports of being turned down, with no local yes (finding 7).
      WHEN s.bad_enough                                                           THEN 'reported_turned_down'
      WHEN coalesce(s.hire, false)                                                THEN 'proven_here'
      WHEN coalesce(s.attest, false)                                              THEN 'vouched_here'
      WHEN coalesce(s.local_yes, false) OR (s.local_operator AND coalesce(s.own_policy, false)) THEN 'says_yes_here'
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
                                                          OR (r.local_operator AND coalesce(r.own_policy_mark, false)) END, false) AS earns_mark,
       CASE (CASE r.standing
               WHEN 'proven_here' THEN r.c_hire WHEN 'vouched_here' THEN r.c_attest
               WHEN 'says_yes_here' THEN greatest(r.c_local_yes, CASE WHEN r.local_operator THEN r.c_own_policy END)
               WHEN 'says_yes_for_roles' THEN r.c_role
               WHEN 'reported_here' THEN r.c_reported WHEN 'company_policy' THEN r.c_corporate
               WHEN 'mixed' THEN r.c_no WHEN 'says_no' THEN r.c_no WHEN 'reported_turned_down' THEN r.c_no END)
         WHEN 3 THEN 'certain' WHEN 2 THEN 'likely' WHEN 1 THEN 'guessing' END AS confidence,
       r.bad_sources,
       CASE WHEN r.standing = 'says_yes_here' AND r.local_operator
            THEN least(r.soonest_local_expiry, r.own_policy_expiry)
            ELSE r.soonest_local_expiry END AS soonest_local_expiry,
       r.last_evidence_on, coalesce(r.evidence_ids, '{}') AS evidence_ids
  FROM r;

