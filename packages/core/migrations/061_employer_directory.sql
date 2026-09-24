-- 061_employer_directory.sql
-- The employer directory, rebuilt around dated evidence.
--
-- WHY. The old `employer` table (018) holds one row per employer and a
-- `published` switch. "Verified" meant a person flipped that switch, once, and
-- `last_verified` was stored and never read, so a mark could be months stale and
-- still shown. Here the unit is the EVIDENCE ITEM: what was said, by whom, where
-- it applies, how sure we are, and when it stops counting. What a job seeker sees
-- (the standing) is derived from unexpired evidence when it is read, so expiry
-- cannot be forgotten again and nothing has to run on a schedule to enforce it.
--
-- ADDITIVE. Nothing here touches `employer` or the job-search mark. The app keeps
-- reading `employer` until a later change switches it, behind a flag.
--
-- WHO MAY SEE WHAT. These tables belong to the platform, not to any partner
-- organization. Row-level security is on and forced; only a platform admin
-- (platform_admin, a table the app cannot write) reads or writes them. The app
-- role reads the public views, which run with the owner's rights and are
-- security barriers, so they are the only door. Contacts are never in a public
-- view. Nothing is deleted: evidence is superseded or withdrawn, on the record.

-- ---------------------------------------------------------------------------
-- 1. The rules, as data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directory_claim_policy (
  claim_type        TEXT PRIMARY KEY,
  polarity          TEXT NOT NULL CHECK (polarity IN ('yes', 'no', 'context', 'lead', 'partner')),
  ttl_days          INTEGER NOT NULL CHECK (ttl_days > 0),
  earns_mark        BOOLEAN NOT NULL,
  needs_two_sources BOOLEAN NOT NULL DEFAULT false,
  meaning           TEXT NOT NULL
);

INSERT INTO directory_claim_policy (claim_type, polarity, ttl_days, earns_mark, needs_two_sources, meaning) VALUES
  ('confirmed_hire',       'yes',     365,  true,  false, 'Someone with a record was hired here, from casework or a consented tracker outcome'),
  ('staff_attestation',    'yes',     180,  true,  false, 'A job developer or case manager placed people here, and says how they know'),
  ('employer_statement',   'yes',      90,  true,  false, 'The employer told us directly'),
  ('direct_role_signal',   'yes',      45,  true,  false, 'A posting says people with records are considered, for that role'),
  ('confirmed_corporate',  'yes',      90,  false, false, 'An official company policy. Never earns the mark alone: a local yes is needed'),
  ('reported_hire',        'yes',     365,  false, false, 'News or a reentry organization reports hires here'),
  ('negative_experience',  'no',      365,  false, true,  'Turned down after the background check, or an offer pulled. Two independent sources before it counts'),
  ('negative_written',     'no',       90,  false, false, 'The posting or policy says records are not considered'),
  ('context_only',         'context', 365,  false, false, 'Pledge, coalition list, ban-the-box coverage, or another platform''s label. Never evidence of hiring'),
  ('candidate_unverified', 'lead',   3650,  false, false, 'A real local employer with nothing on records yet'),
  ('ecosystem_partner',    'partner',3650,  false, false, 'Not an employer: a referral source, agency or program')
ON CONFLICT (claim_type) DO UPDATE SET
  polarity = EXCLUDED.polarity, ttl_days = EXCLUDED.ttl_days, earns_mark = EXCLUDED.earns_mark,
  needs_two_sources = EXCLUDED.needs_two_sources, meaning = EXCLUDED.meaning;

-- ---------------------------------------------------------------------------
-- 2. Organizations, the names job listings use, and places
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_org (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name     TEXT NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 2 AND 200),
  -- normalizeEmployerName() in packages/core/src/employer.ts. One normalizer.
  name_key           TEXT NOT NULL UNIQUE CHECK (length(name_key) >= 2),
  org_kind           TEXT NOT NULL DEFAULT 'employer' CHECK (org_kind IN ('employer', 'staffing_agency', 'government', 'ecosystem_partner')),
  industry           TEXT,
  website            TEXT,
  careers_url        TEXT,
  -- A franchise's corporate policy says nothing about the local owner.
  operating_model    TEXT NOT NULL DEFAULT 'unknown' CHECK (operating_model IN ('corporate', 'franchise', 'independent', 'unknown')),
  -- Public by default (Troy, 2026-09-24). case_managers_only only at the employer's own request.
  listing_visibility TEXT NOT NULL DEFAULT 'public' CHECK (listing_visibility IN ('public', 'case_managers_only', 'hidden')),
  notes              TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employer_alias (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  alias_key  TEXT NOT NULL UNIQUE CHECK (length(alias_key) >= 2),
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'employer_intel', 'airtable', 'job_feed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employer_alias_org ON employer_alias (org_id);

CREATE TABLE IF NOT EXISTS employer_place (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_kind             TEXT NOT NULL DEFAULT 'site' CHECK (place_kind IN ('site', 'service_area', 'county', 'statewide', 'remote')),
  label                  TEXT,
  address                TEXT,
  city                   TEXT,
  county                 TEXT,
  state                  CHAR(2) NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  postal_code            TEXT,
  operating_confirmed_on DATE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employer_place_org ON employer_place (org_id);
CREATE INDEX IF NOT EXISTS employer_place_geo ON employer_place (state, county);

-- ---------------------------------------------------------------------------
-- 3. Business contacts, and the relationships that keep facts fresh
-- ---------------------------------------------------------------------------
-- Business contacts only, as the employer publishes them. Never a personal cell
-- number, a home address, or a personal social account.
CREATE TABLE IF NOT EXISTS employer_contact (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id      UUID REFERENCES employer_place(id) ON DELETE SET NULL,
  contact_kind  TEXT NOT NULL CHECK (contact_kind IN ('role_inbox', 'hr_line', 'careers_form', 'business_person')),
  name          TEXT,
  title         TEXT,
  email         TEXT,
  phone         TEXT,
  form_url      TEXT,
  source_url    TEXT NOT NULL,
  checked_on    DATE NOT NULL,
  contact_tier  TEXT NOT NULL DEFAULT 'published' CHECK (contact_tier IN ('published', 'corroborated', 'confirmed')),
  can_contact   BOOLEAN NOT NULL DEFAULT true,
  opted_out_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A named person only when the employer publishes them in a business role.
  CHECK (name IS NULL OR contact_kind = 'business_person'),
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR form_url IS NOT NULL),
  -- An opt-out is permanent until they opt back in.
  CHECK (opted_out_at IS NULL OR can_contact = false)
);
CREATE INDEX IF NOT EXISTS employer_contact_org ON employer_contact (org_id);

-- What makes a fact Certain (Troy, 2026-09-24): an ongoing relationship with a
-- verified avenue that keeps it fresh. `started_on` is the first documented
-- contact, never the day research began.
CREATE TABLE IF NOT EXISTS employer_relationship (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id          UUID REFERENCES employer_place(id) ON DELETE SET NULL,
  avenue            TEXT NOT NULL CHECK (avenue IN ('employer_contact', 'employer_signup', 'job_developer', 'workforce_office', 'partner_org')),
  contact_id        UUID REFERENCES employer_contact(id) ON DELETE SET NULL,
  partner_org_id    UUID REFERENCES access_code(id) ON DELETE SET NULL,
  started_on        DATE NOT NULL,
  cadence_days      INTEGER NOT NULL DEFAULT 90 CHECK (cadence_days BETWEEN 7 AND 365),
  last_confirmed_on DATE,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lapsed', 'ended')),
  note              TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (last_confirmed_on IS NULL OR last_confirmed_on >= started_on)
);
CREATE INDEX IF NOT EXISTS employer_relationship_org ON employer_relationship (org_id);

-- Live = active, confirmed at least once, and not past its cadence plus two weeks.
CREATE OR REPLACE FUNCTION public.directory_relationship_is_live(r_status text, r_last date, r_cadence int)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT r_status = 'active' AND r_last IS NOT NULL AND r_last + r_cadence + 14 >= current_date
$$;

-- ---------------------------------------------------------------------------
-- 4. Evidence: the unit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  -- NULL = company-wide.
  place_id         UUID REFERENCES employer_place(id) ON DELETE SET NULL,
  scope            TEXT NOT NULL CHECK (scope IN ('company', 'state', 'county', 'place', 'role')),
  claim_type       TEXT NOT NULL REFERENCES directory_claim_policy(claim_type),
  role_family      TEXT CHECK (role_family IS NULL OR role_family IN ('warehouse', 'kitchen', 'driving', 'trades', 'office', 'care', 'retail', 'other')),
  role_title       TEXT,
  source_kind      TEXT NOT NULL CHECK (source_kind IN ('official_policy', 'job_posting', 'official_program', 'official_location', 'news',
                                                        'aggregator', 'directory', 'partner_list', 'employer_direct', 'staff_attestation',
                                                        'casework_aggregate', 'legacy_import')),
  source_url       TEXT,
  source_title     TEXT,
  publisher        TEXT,
  excerpt          TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 500),
  source_grade     CHAR(1) NOT NULL CHECK (source_grade IN ('A', 'B', 'C', 'D')),
  confidence       TEXT NOT NULL CHECK (confidence IN ('certain', 'likely', 'guessing')),
  confidence_score INTEGER CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  relationship_id  UUID REFERENCES employer_relationship(id) ON DELETE RESTRICT,
  observed_on      DATE NOT NULL,
  accessed_on      DATE,
  expires_on       DATE,
  -- Casework only, and never a person key: counts, not people.
  hire_count       INTEGER,
  org_count        INTEGER,
  found_by         TEXT NOT NULL CHECK (length(btrim(found_by)) >= 2),
  checked_by       TEXT,
  checked_on       DATE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'withdrawn', 'disputed')),
  superseded_by    UUID REFERENCES employer_evidence(id),
  limitations      TEXT CHECK (limitations IS NULL OR length(limitations) <= 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Certain needs a relationship behind it (Troy, 2026-09-24).
  CONSTRAINT evidence_certain_needs_relationship CHECK (confidence <> 'certain' OR relationship_id IS NOT NULL),
  -- Likely needs a real source that was read and dated.
  CONSTRAINT evidence_likely_needs_source CHECK (confidence <> 'likely' OR (
      (source_url IS NOT NULL OR source_kind IN ('employer_direct', 'staff_attestation', 'casework_aggregate'))
      AND accessed_on IS NOT NULL AND source_grade IN ('A', 'B'))),
  -- A link, unless the evidence is a conversation or our own counts.
  CONSTRAINT evidence_needs_url CHECK (source_url IS NOT NULL OR source_kind IN ('employer_direct', 'staff_attestation', 'casework_aggregate')),
  CONSTRAINT evidence_role_scope CHECK (scope <> 'role' OR role_title IS NOT NULL OR role_family IS NOT NULL),
  CONSTRAINT evidence_place_scope CHECK (scope IN ('company', 'role') OR place_id IS NOT NULL),
  -- Counts only on casework, and at least one (maximum use, Troy 2026-09-24).
  CONSTRAINT evidence_counts_casework_only CHECK (
      (source_kind = 'casework_aggregate' AND hire_count >= 1 AND org_count >= 1)
   OR (source_kind <> 'casework_aggregate' AND hire_count IS NULL AND org_count IS NULL)),
  CONSTRAINT evidence_expiry_after_observed CHECK (expires_on IS NULL OR expires_on > observed_on)
);
CREATE INDEX IF NOT EXISTS employer_evidence_org ON employer_evidence (org_id, place_id);
CREATE INDEX IF NOT EXISTS employer_evidence_expiry ON employer_evidence (expires_on) WHERE status = 'active';

-- Expiry defaults from the policy, so nobody has to remember the rule.
CREATE OR REPLACE FUNCTION public.employer_evidence_expiry() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.expires_on IS NULL THEN
    SELECT NEW.observed_on + p.ttl_days INTO NEW.expires_on
      FROM public.directory_claim_policy p WHERE p.claim_type = NEW.claim_type;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_evidence_expiry ON employer_evidence;
CREATE TRIGGER employer_evidence_expiry BEFORE INSERT ON employer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.employer_evidence_expiry();

-- Evidence is never moved to another employer after the fact.
CREATE OR REPLACE FUNCTION public.employer_evidence_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.claim_type IS DISTINCT FROM OLD.claim_type
     OR NEW.observed_on IS DISTINCT FROM OLD.observed_on OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'evidence is superseded, never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_evidence_guard ON employer_evidence;
CREATE TRIGGER employer_evidence_guard BEFORE UPDATE ON employer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.employer_evidence_guard();

-- ---------------------------------------------------------------------------
-- 5. The employer's side: sign-up, requirements, right of reply
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_signup (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id          UUID REFERENCES employer_place(id) ON DELETE SET NULL,
  contact_id        UUID NOT NULL REFERENCES employer_contact(id),
  signed_up_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  terms_version     TEXT NOT NULL,
  public_listing_ok BOOLEAN NOT NULL DEFAULT true,
  wants             TEXT[] NOT NULL DEFAULT '{}' CHECK (wants <@ ARRAY['referrals', 'bonding_info', 'hiring_event', 'case_manager_reference']::text[]),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended'))
);

-- What can exclude a match, each tied to the evidence it came from.
-- offense_category_bar is used only against a category the seeker chose to
-- disclose themselves (Troy, 2026-09-24). Never inferred.
CREATE TABLE IF NOT EXISTS employer_requirement (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id    UUID REFERENCES employer_place(id) ON DELETE SET NULL,
  role_family TEXT,
  role_title  TEXT,
  requirement TEXT NOT NULL CHECK (requirement IN ('cdl', 'clean_driving_years', 'caregiver_clearance', 'professional_license',
                                                   'drug_test', 'lookback_years', 'offense_category_bar')),
  value       TEXT,
  evidence_id UUID NOT NULL REFERENCES employer_evidence(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employer_requirement_org ON employer_requirement (org_id);

-- Shown beside a negative, never instead of it.
CREATE TABLE IF NOT EXISTS employer_reply (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES employer_evidence(id),
  reply_text  TEXT NOT NULL CHECK (length(btrim(reply_text)) BETWEEN 1 AND 1000),
  received_on DATE NOT NULL,
  contact_id  UUID REFERENCES employer_contact(id),
  shown       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. Where automation lands, and where imports came from
-- ---------------------------------------------------------------------------
-- Every automated finding is a proposal a person approves. Nothing automated
-- writes evidence directly. Also holds the charter's geo-expansion tickets.
CREATE TABLE IF NOT EXISTS directory_proposal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('new_org', 'new_evidence', 'expire', 'merge', 'contact_update', 'geo_ticket', 'review')),
  target_org_id UUID REFERENCES employer_org(id) ON DELETE SET NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_by   TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) <= 2000),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS directory_proposal_pending ON directory_proposal (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS directory_import (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL CHECK (source_system IN ('employer_intel', 'airtable')),
  source_table  TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  org_id        UUID REFERENCES employer_org(id) ON DELETE SET NULL,
  raw           JSONB NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_table, external_id)
);

-- ---------------------------------------------------------------------------
-- 7. The standing, derived on read
-- ---------------------------------------------------------------------------
-- Unexpired, active evidence, with Certain downgraded to Likely once its
-- relationship is no longer live. Internal: never granted to the app.
CREATE OR REPLACE VIEW directory_evidence_live WITH (security_barrier = true) AS
SELECT e.*, p.polarity, p.earns_mark AS claim_earns_mark, p.needs_two_sources,
       CASE WHEN e.confidence = 'certain'
             AND NOT EXISTS (SELECT 1 FROM employer_relationship r
                              WHERE r.id = e.relationship_id
                                AND public.directory_relationship_is_live(r.status, r.last_confirmed_on, r.cadence_days))
            THEN 'likely' ELSE e.confidence END AS effective_confidence
  FROM employer_evidence e
  JOIN directory_claim_policy p ON p.claim_type = e.claim_type
 WHERE e.status = 'active' AND e.expires_on >= current_date;

-- For each place, the evidence that applies to it: its own, a county or
-- statewide place of the same employer that covers it, or company-wide.
CREATE OR REPLACE VIEW directory_place_evidence WITH (security_barrier = true) AS
SELECT pl.id AS target_place_id, ev.id, ev.org_id, ev.place_id, ev.claim_type, ev.polarity,
       ev.source_kind, ev.source_url, ev.publisher, ev.org_count, ev.effective_confidence,
       ev.observed_on, ev.accessed_on, ev.checked_on, ev.expires_on,
       (ev.place_id IS NOT NULL) AS is_local
  FROM employer_place pl
  JOIN directory_evidence_live ev ON ev.org_id = pl.org_id
  LEFT JOIN employer_place ep ON ep.id = ev.place_id
 WHERE ev.place_id IS NULL
    OR ev.place_id = pl.id
    OR (ep.place_kind = 'county' AND ep.state = pl.state AND ep.county IS NOT DISTINCT FROM pl.county)
    OR (ep.place_kind = 'statewide' AND ep.state = pl.state);

CREATE OR REPLACE VIEW employer_standing_v WITH (security_barrier = true) AS
WITH f AS (
  SELECT pe.target_place_id,
    bool_or(pe.is_local AND pe.claim_type = 'confirmed_hire')                                       AS hire,
    bool_or(pe.is_local AND pe.claim_type = 'staff_attestation')                                    AS attest,
    bool_or(pe.is_local AND pe.claim_type IN ('employer_statement', 'direct_role_signal'))          AS local_yes,
    bool_or(pe.is_local AND pe.claim_type = 'reported_hire')                                        AS reported,
    bool_or(pe.claim_type = 'confirmed_corporate')                                                  AS corporate,
    bool_or(pe.claim_type = 'negative_written')                                                     AS said_no,
    -- Independent sources of a bad experience: each outside source counts once;
    -- casework counts the organizations behind it.
    (count(DISTINCT coalesce(pe.publisher, pe.source_url, pe.id::text))
       FILTER (WHERE pe.claim_type = 'negative_experience' AND pe.source_kind <> 'casework_aggregate')
     + coalesce(sum(pe.org_count) FILTER (WHERE pe.claim_type = 'negative_experience' AND pe.source_kind = 'casework_aggregate'), 0)
    )                                                                                               AS bad_sources,
    max(CASE pe.effective_confidence WHEN 'certain' THEN 3 WHEN 'likely' THEN 2 ELSE 1 END)
       FILTER (WHERE pe.polarity = 'yes')                                                           AS best_conf,
    min(pe.expires_on) FILTER (WHERE pe.polarity = 'yes' AND pe.is_local)                           AS soonest_local_expiry,
    max(greatest(pe.observed_on, coalesce(pe.accessed_on, pe.observed_on), coalesce(pe.checked_on, pe.observed_on))) AS last_evidence_on,
    array_agg(pe.id ORDER BY pe.observed_on DESC)                                                   AS evidence_ids
  FROM directory_place_evidence pe
  GROUP BY pe.target_place_id
), s AS (
  SELECT pl.id AS place_id, pl.org_id, f.best_conf, f.soonest_local_expiry, f.last_evidence_on, f.evidence_ids,
    CASE
      WHEN coalesce(f.hire OR f.attest OR f.local_yes, false) AND (coalesce(f.said_no, false) OR coalesce(f.bad_sources, 0) >= 2) THEN 'mixed'
      WHEN coalesce(f.said_no, false)   THEN 'says_no'
      WHEN coalesce(f.hire, false)      THEN 'proven_here'
      WHEN coalesce(f.attest, false)    THEN 'vouched_here'
      WHEN coalesce(f.local_yes, false) THEN 'says_yes_here'
      WHEN coalesce(f.reported, false)  THEN 'reported_here'
      WHEN coalesce(f.corporate, false) THEN 'company_policy'
      ELSE 'lead'
    END AS standing
  FROM employer_place pl
  LEFT JOIN f ON f.target_place_id = pl.id
)
SELECT s.place_id, s.org_id, s.standing,
       (s.standing IN ('proven_here', 'vouched_here', 'says_yes_here') AND o.org_kind <> 'ecosystem_partner') AS earns_mark,
       CASE s.best_conf WHEN 3 THEN 'certain' WHEN 2 THEN 'likely' WHEN 1 THEN 'guessing' END AS confidence,
       s.soonest_local_expiry, s.last_evidence_on, coalesce(s.evidence_ids, '{}') AS evidence_ids
  FROM s JOIN employer_org o ON o.id = s.org_id;

-- ---------------------------------------------------------------------------
-- 8. The doors the app may use
-- ---------------------------------------------------------------------------
-- The board: public employers, where they are, their standing, and how fresh it
-- is. No contacts, no notes.
CREATE OR REPLACE VIEW directory_public_v WITH (security_barrier = true) AS
SELECT o.id AS org_id, o.canonical_name, o.org_kind, o.industry, o.careers_url, o.website, o.operating_model,
       pl.id AS place_id, pl.place_kind, pl.city, pl.county, pl.state,
       st.standing, st.earns_mark, st.confidence, st.soonest_local_expiry, st.last_evidence_on
  FROM employer_org o
  JOIN employer_place pl ON pl.org_id = o.id
  JOIN employer_standing_v st ON st.place_id = pl.id
 WHERE o.listing_visibility = 'public';

-- "Why this mark": the evidence behind a public standing. Casework detail is
-- coarsened when small (a count under 3 is not shown, dates show as a quarter),
-- so a report cannot point at one person in a small town. Negatives carry the
-- employer's reply beside them.
CREATE OR REPLACE VIEW directory_public_evidence_v WITH (security_barrier = true) AS
SELECT ev.id, ev.org_id, ev.place_id, ev.scope, ev.claim_type, ev.polarity, ev.role_family,
       CASE WHEN ev.source_kind = 'casework_aggregate' THEN NULL ELSE ev.role_title END AS role_title,
       ev.source_kind, ev.source_url, ev.source_title, ev.publisher, ev.excerpt, ev.source_grade,
       ev.effective_confidence AS confidence,
       CASE WHEN ev.source_kind = 'casework_aggregate' THEN date_trunc('quarter', ev.observed_on)::date ELSE ev.observed_on END AS observed_on,
       ev.expires_on,
       CASE WHEN ev.source_kind = 'casework_aggregate' AND ev.hire_count < 3 THEN NULL ELSE ev.hire_count END AS hire_count,
       ev.limitations,
       (SELECT r.reply_text FROM employer_reply r WHERE r.evidence_id = ev.id AND r.shown ORDER BY r.received_on DESC LIMIT 1) AS employer_reply
  FROM directory_evidence_live ev
  JOIN employer_org o ON o.id = ev.org_id
 WHERE o.listing_visibility = 'public'
   AND ev.polarity IN ('yes', 'no');

-- The names that may carry the mark on a job listing, and WHERE. A mark earned
-- in Kalispell says nothing about a store in Milwaukee, so the app matches the
-- name and the listing's state (and county when known). Exact keys only.
CREATE OR REPLACE VIEW directory_mark_v WITH (security_barrier = true) AS
SELECT DISTINCT k.key AS name_key, pl.state, pl.county, pl.city, st.standing
  FROM employer_standing_v st
  JOIN employer_place pl ON pl.id = st.place_id
  JOIN employer_org o ON o.id = st.org_id
  CROSS JOIN LATERAL (SELECT o.name_key AS key UNION SELECT a.alias_key FROM employer_alias a WHERE a.org_id = o.id) k
 WHERE st.earns_mark AND o.listing_visibility <> 'hidden';

-- For the health check: what is about to go stale, what has nothing, what lapsed.
CREATE OR REPLACE VIEW directory_health_v WITH (security_barrier = true) AS
SELECT
  (SELECT count(*) FROM employer_org)                                                             AS orgs,
  (SELECT count(*) FROM employer_place)                                                           AS places,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active')                                AS evidence_active,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active' AND expires_on < current_date)  AS evidence_expired,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active' AND expires_on BETWEEN current_date AND current_date + 14) AS evidence_expiring_14d,
  (SELECT count(*) FROM employer_standing_v WHERE earns_mark)                                     AS places_with_mark,
  (SELECT count(*) FROM employer_standing_v WHERE standing = 'lead')                              AS places_lead_only,
  (SELECT count(*) FROM employer_relationship r WHERE r.status = 'active'
      AND NOT public.directory_relationship_is_live(r.status, r.last_confirmed_on, r.cadence_days)) AS relationships_lapsed,
  (SELECT count(*) FROM directory_proposal WHERE status = 'pending')                              AS proposals_pending
 WHERE EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 9. Row-level security: platform admins only, on every table
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directory_claim_policy', 'employer_org', 'employer_alias', 'employer_place', 'employer_contact',
                           'employer_relationship', 'employer_evidence', 'employer_signup', 'employer_requirement',
                           'employer_reply', 'directory_proposal', 'directory_import'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
                                                 WITH CHECK (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_update', t);
  END LOOP;
END $$;

-- The rules are public knowledge: anyone may read them.
DROP POLICY IF EXISTS directory_claim_policy_read ON directory_claim_policy;
CREATE POLICY directory_claim_policy_read ON directory_claim_policy FOR SELECT USING (true);

-- Grants. The same list lives in scripts/lib/restricted-grants.mjs so a fresh
-- database (CI) ends up exactly like production. Production's default
-- privileges hand a new table OR VIEW full rights to smr_app on creation, so
-- every object here is revoked first, then given back only what it needs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON directory_claim_policy, employer_org, employer_alias, employer_place, employer_contact,
                  employer_relationship, employer_evidence, employer_signup, employer_requirement,
                  employer_reply, directory_proposal, directory_import,
                  directory_evidence_live, directory_place_evidence, employer_standing_v,
                  directory_public_v, directory_public_evidence_v, directory_mark_v, directory_health_v FROM smr_app;
    GRANT SELECT ON directory_claim_policy TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON employer_org, employer_alias, employer_place, employer_contact,
                  employer_relationship, employer_evidence, employer_signup, employer_requirement,
                  employer_reply, directory_proposal TO smr_app;
    GRANT SELECT ON directory_import TO smr_app;
    GRANT SELECT ON directory_public_v, directory_public_evidence_v, directory_mark_v, directory_health_v TO smr_app;
  END IF;
END $$;
