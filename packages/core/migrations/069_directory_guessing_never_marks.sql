-- 069: Guessing never marks and is never public.
--
-- The directory's rule is that Guessing evidence (a C or D source, or a source
-- with no access date) is never shown. Two gaps let it through:
--   1. employer_standing_v let a local operator's own policy (062) earn the mark
--      at any confidence, so a C-grade "own policy" row marked its place.
--   2. directory_public_evidence_v had no confidence filter, so Guessing rows
--      reached the app's evidence door (and the job board's excerpt).
-- This migration closes both, fail-closed: earns_mark now also requires the
-- standing's confidence to be Likely or Certain, and the public evidence view
-- drops Guessing rows in both branches. Standing itself is unchanged, so a
-- Guessing "says_yes_here" still reads as such for staff; it just never marks.
--
-- employer_standing_v below is 064's definition verbatim, with its final SELECT
-- wrapped so the mark can be gated on the computed confidence. Column names,
-- types and order are unchanged, so CREATE OR REPLACE keeps dependents and grants.

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
SELECT x.place_id, x.org_id, x.standing,
       -- 069: no mark without at least Likely evidence behind the standing.
       (x.earns_mark AND x.confidence IN ('likely', 'certain')) AS earns_mark,
       x.confidence, x.bad_sources, x.soonest_local_expiry, x.last_evidence_on, x.evidence_ids
  FROM (
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
  FROM r
) x;

CREATE OR REPLACE VIEW directory_public_evidence_v WITH (security_barrier = true) AS
SELECT ev.id, ev.org_id, ev.place_id, pl.county, pl.state, ev.scope, ev.claim_type, ev.polarity,
       ev.role_family, ev.role_title, ev.source_kind, ev.source_url, ev.source_title, ev.publisher, ev.excerpt,
       ev.source_grade, ev.effective_confidence AS confidence, ev.observed_on, ev.expires_on,
       NULL::integer AS outcome_count, ev.limitations,
       (SELECT r.reply_text FROM employer_reply r WHERE r.evidence_id = ev.id AND r.shown ORDER BY r.received_on DESC, r.id DESC LIMIT 1) AS employer_reply
  FROM directory_evidence_live ev
  JOIN employer_org o ON o.id = ev.org_id AND o.listing_visibility = 'public'
  LEFT JOIN employer_place pl ON pl.id = ev.place_id
 WHERE ev.source_kind <> 'casework_aggregate'
   AND ev.effective_confidence <> 'guessing'  -- 069: Guessing is never public
   AND ev.polarity IN ('yes', 'no')
   AND (ev.claim_type <> 'negative_experience'
        OR EXISTS (SELECT 1 FROM employer_standing_v st
                    WHERE st.place_id = ev.place_id
                      AND st.bad_sources >= (SELECT CASE WHEN p.needs_two_sources THEN 2 ELSE 1 END
                                               FROM directory_claim_policy p WHERE p.claim_type = 'negative_experience')))
UNION ALL
SELECT ev.id, ev.org_id, NULL::uuid, pl.county, pl.state, 'county', ev.claim_type, ev.polarity,
       CASE WHEN ev.outcome_count >= 3 THEN ev.role_family END, NULL, ev.source_kind, NULL, NULL, NULL, NULL,
       ev.source_grade, ev.effective_confidence, date_trunc('quarter', ev.observed_on)::date, NULL::date,
       CASE WHEN ev.outcome_count >= 3 THEN ev.outcome_count END, NULL,
       (SELECT r.reply_text FROM employer_reply r WHERE r.evidence_id = ev.id AND r.shown ORDER BY r.received_on DESC, r.id DESC LIMIT 1)
  FROM directory_evidence_live ev
  JOIN employer_org o ON o.id = ev.org_id AND o.listing_visibility = 'public'
  LEFT JOIN employer_place pl ON pl.id = ev.place_id
 WHERE ev.source_kind = 'casework_aggregate'
   AND ev.effective_confidence <> 'guessing'  -- 069: Guessing is never public
   AND ev.polarity IN ('yes', 'no')
   AND (ev.claim_type <> 'negative_experience' OR ev.org_count >= 2);
