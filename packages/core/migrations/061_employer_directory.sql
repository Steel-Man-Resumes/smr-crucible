-- 061_employer_directory.sql
-- The employer directory, rebuilt around dated evidence.
--
-- WHY. The old `employer` table (018) holds one row per employer and a
-- `published` switch. "Verified" meant a person flipped that switch, once, and
-- `last_verified` was stored and never read, so a mark could be months stale and
-- still shown. Here the unit is the EVIDENCE ITEM: what was said, by whom, where
-- it applies, how sure we are, and when it stops counting. What a job seeker sees
-- (the standing) is derived from unexpired evidence when it is read, so expiry
-- cannot be forgotten and nothing has to run on a schedule to enforce it.
--
-- ADDITIVE. Nothing here touches `employer` or the job-search mark. The app keeps
-- reading `employer` until a later change switches it, behind a flag.
--
-- REVISED BEFORE FIRST APPLY after an adversarial review (Codex, 2026-09-24,
-- todash collab/fair-chance-directory-2026-09-24/CODEX-REVIEW-061.md). Every
-- finding is addressed below; the section comments name them.
--
-- WHO MAY SEE WHAT. These tables belong to the platform, not to any partner
-- organization. Row-level security is on and forced; only a platform admin
-- (platform_admin, a table the app cannot write) reads or writes them. The app
-- role reads four public views, which run with the owner's rights and are
-- security barriers, so they are the only door. A security barrier does not
-- sanitize the columns it selects, so each public view selects only what may be
-- public. Contacts are never in a public view. Nothing is deleted: evidence is
-- superseded or withdrawn, on the record.
--
-- TRUST BOUNDARY (inherited, not new): RLS here protects against application
-- queries made under the right identity. `app.user_id` is set by the server; a
-- stolen smr_app credential running raw SQL could set it. Do not advertise RLS
-- as surviving compromise of the database credential.
--
-- ROLLBACK (pre-import, pre-cutover only; destroys directory rows): see
-- CC-NEON-SCHEMA-DESIGN.md section 12 in the todash collab folder.

-- ---------------------------------------------------------------------------
-- 0. One name normalizer, identical to normalizeEmployerName() in
--    packages/core/src/employer.ts. scripts/verify-directory.mjs checks that the
--    two agree on a fixed list of names (review finding 9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.directory_normalize_name(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE s text; prev text;
BEGIN
  s := lower(coalesce(raw, ''));
  s := replace(s, '&', ' and ');
  s := btrim(regexp_replace(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  prev := NULL;
  WHILE prev IS DISTINCT FROM s LOOP
    prev := s;
    s := regexp_replace(s, '\s(incorporated|inc|llc|l l c|corporation|corp|company|co|ltd|limited|plc|lp|llp)$', '');
  END LOOP;
  RETURN s;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The rules, as data -- and the calculation reads them (finding 11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directory_claim_policy (
  claim_type        TEXT PRIMARY KEY,
  polarity          TEXT NOT NULL CHECK (polarity IN ('yes', 'no', 'context', 'lead', 'partner')),
  ttl_days          INTEGER NOT NULL CHECK (ttl_days > 0),
  earns_mark        BOOLEAN NOT NULL,
  needs_two_sources BOOLEAN NOT NULL DEFAULT false,
  -- How far a fact recorded at a county or statewide place may reach. A
  -- statewide confirmed hire does NOT make every site "proven here" (finding 5).
  inherit_level     TEXT NOT NULL CHECK (inherit_level IN ('place', 'county', 'state')),
  meaning           TEXT NOT NULL
);

-- Seeded once. A later change to a rule is a new migration, not a silent
-- overwrite by re-running this one.
INSERT INTO directory_claim_policy (claim_type, polarity, ttl_days, earns_mark, needs_two_sources, inherit_level, meaning) VALUES
  ('confirmed_hire',       'yes',     365,  true,  false, 'county', 'Someone with a record was hired here, from casework or a consented tracker outcome'),
  ('staff_attestation',    'yes',     180,  true,  false, 'county', 'A job developer or case manager placed people here, and says how they know'),
  ('employer_statement',   'yes',      90,  true,  false, 'state',  'The employer told us directly'),
  ('direct_role_signal',   'yes',      45,  true,  false, 'place',  'A posting says people with records are considered, for that role only'),
  ('confirmed_corporate',  'yes',      90,  false, false, 'state',  'An official company policy. Never earns the mark alone: a local yes is needed'),
  ('reported_hire',        'yes',     365,  false, false, 'county', 'News or a reentry organization reports hires here'),
  ('negative_experience',  'no',      365,  false, true,  'county', 'Turned down after the background check, or an offer pulled. Two independent sources before it counts or is shown'),
  ('negative_written',     'no',       90,  false, false, 'state',  'The posting or policy says records are not considered'),
  ('context_only',         'context', 365,  false, false, 'place',  'Pledge, coalition list, ban-the-box coverage, or another platform''s label. Never evidence of hiring'),
  ('candidate_unverified', 'lead',   3650,  false, false, 'place',  'A real local employer with nothing on records yet'),
  ('ecosystem_partner',    'partner',3650,  false, false, 'place',  'Not an employer: a referral source, agency or program')
ON CONFLICT (claim_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Organizations, names, places
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_org (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name     TEXT NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 2 AND 200),
  name_key           TEXT NOT NULL UNIQUE CHECK (length(name_key) >= 2 AND name_key = public.directory_normalize_name(name_key)),
  org_kind           TEXT NOT NULL DEFAULT 'employer' CHECK (org_kind IN ('employer', 'staffing_agency', 'government', 'ecosystem_partner')),
  industry           TEXT,
  website            TEXT,
  careers_url        TEXT,
  -- A franchise location takes no evidence from a county or statewide place:
  -- each operator needs evidence at its own place (finding 5).
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
  alias_key  TEXT NOT NULL UNIQUE CHECK (length(alias_key) >= 2 AND alias_key = public.directory_normalize_name(alias_key)),
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'employer_intel', 'airtable', 'job_feed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employer_alias_org ON employer_alias (org_id);

-- Canonical keys and aliases share ONE namespace: no key may point at two
-- employers, whichever table it sits in (finding 9).
CREATE OR REPLACE FUNCTION public.directory_name_namespace() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'employer_alias' THEN
    IF EXISTS (SELECT 1 FROM employer_org o WHERE o.name_key = NEW.alias_key AND o.id <> NEW.org_id) THEN
      RAISE EXCEPTION 'name key % already belongs to another employer', NEW.alias_key USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM employer_alias a WHERE a.alias_key = NEW.name_key AND a.org_id <> NEW.id) THEN
      RAISE EXCEPTION 'name key % already belongs to another employer', NEW.name_key USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_alias_namespace ON employer_alias;
CREATE TRIGGER employer_alias_namespace BEFORE INSERT OR UPDATE ON employer_alias
  FOR EACH ROW EXECUTE FUNCTION public.directory_name_namespace();
DROP TRIGGER IF EXISTS employer_org_namespace ON employer_org;
CREATE TRIGGER employer_org_namespace BEFORE INSERT OR UPDATE OF name_key ON employer_org
  FOR EACH ROW EXECUTE FUNCTION public.directory_name_namespace();

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
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CHECK (place_kind <> 'county' OR county IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS employer_place_org_geo ON employer_place (org_id, state, county, place_kind);

-- ---------------------------------------------------------------------------
-- 3. Business contacts, relationships, and dated confirmations
-- ---------------------------------------------------------------------------
-- Business contacts only, as the employer publishes them. Never a personal cell
-- number, a home address, or a personal social account.
CREATE TABLE IF NOT EXISTS employer_contact (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id      UUID,
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
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  CHECK (name IS NULL OR contact_kind = 'business_person'),
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR form_url IS NOT NULL),
  CHECK (opted_out_at IS NULL OR can_contact = false)
);
CREATE INDEX IF NOT EXISTS employer_contact_org ON employer_contact (org_id);

-- What makes a fact Certain (Troy, 2026-09-24): an ongoing relationship with a
-- verified avenue. Each avenue must name who or what it is (finding 6).
-- `started_on` is the first documented contact, never the day research began.
CREATE TABLE IF NOT EXISTS employer_relationship (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id       UUID,
  avenue         TEXT NOT NULL CHECK (avenue IN ('employer_contact', 'employer_signup', 'job_developer', 'workforce_office', 'partner_org')),
  contact_id     UUID,
  partner_org_id UUID REFERENCES access_code(id),
  started_on     DATE NOT NULL,
  cadence_days   INTEGER NOT NULL DEFAULT 90 CHECK (cadence_days BETWEEN 7 AND 365),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lapsed', 'ended')),
  note           TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES employer_contact (org_id, id),
  CONSTRAINT relationship_avenue_named CHECK (
       (avenue IN ('employer_contact', 'employer_signup') AND contact_id IS NOT NULL)
    OR (avenue = 'partner_org' AND partner_org_id IS NOT NULL)
    OR (avenue IN ('job_developer', 'workforce_office') AND (contact_id IS NOT NULL OR partner_org_id IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS employer_relationship_org ON employer_relationship (org_id);

-- A relationship is only as fresh as its last recorded confirmation: when,
-- how, and by whom. Confirmations are never edited.
CREATE TABLE IF NOT EXISTS employer_relationship_confirmation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  relationship_id UUID NOT NULL,
  confirmed_on    DATE NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('email_reply', 'phone_call', 'in_person', 'signup_form', 'partner_report')),
  confirmed_by    TEXT NOT NULL CHECK (length(btrim(confirmed_by)) >= 2),
  note            TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, relationship_id) REFERENCES employer_relationship (org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS employer_relationship_confirmation_rel ON employer_relationship_confirmation (relationship_id, confirmed_on DESC);

-- Live = active, confirmed within its cadence plus two weeks, and its contact
-- (if any) has not opted out.
CREATE OR REPLACE FUNCTION public.directory_relationship_is_live(rel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM employer_relationship r
     WHERE r.id = rel_id AND r.status = 'active'
       AND (r.contact_id IS NULL OR EXISTS (SELECT 1 FROM employer_contact c WHERE c.id = r.contact_id AND c.can_contact))
       AND (SELECT max(c.confirmed_on) FROM employer_relationship_confirmation c WHERE c.relationship_id = r.id)
           + r.cadence_days + 14 >= current_date)
$$;

-- ---------------------------------------------------------------------------
-- 4. Evidence: the unit. Written once; only its status moves (finding 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  -- NULL = company-wide.
  place_id         UUID,
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
  -- The independent organizations behind this item, normalized: a publisher
  -- key for news, 'org:<uuid>' for a partner program. Two items from the same
  -- organization are one source (finding 7). Never a person.
  source_orgs      TEXT[] NOT NULL DEFAULT '{}',
  excerpt          TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 500),
  source_grade     CHAR(1) NOT NULL CHECK (source_grade IN ('A', 'B', 'C', 'D')),
  confidence       TEXT NOT NULL CHECK (confidence IN ('certain', 'likely', 'guessing')),
  confidence_score INTEGER CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  relationship_id  UUID,
  observed_on      DATE NOT NULL,
  accessed_on      DATE,
  expires_on       DATE NOT NULL,
  -- Casework only: how many consented outcomes, from how many organizations.
  outcome_count    INTEGER,
  org_count        INTEGER,
  found_by         TEXT NOT NULL CHECK (length(btrim(found_by)) >= 2),
  checked_by       TEXT,
  checked_on       DATE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'withdrawn', 'disputed')),
  superseded_by    UUID,
  limitations      TEXT CHECK (limitations IS NULL OR length(limitations) <= 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (org_id, id),
  -- Same-employer links only (finding 4).
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  FOREIGN KEY (org_id, relationship_id) REFERENCES employer_relationship (org_id, id),
  FOREIGN KEY (org_id, superseded_by) REFERENCES employer_evidence (org_id, id),

  -- Certain needs a relationship and a strong source (Troy 2026-09-24; finding 6).
  CONSTRAINT evidence_certain_needs_relationship CHECK (confidence <> 'certain' OR (relationship_id IS NOT NULL AND source_grade IN ('A', 'B'))),
  CONSTRAINT evidence_likely_needs_source CHECK (confidence <> 'likely' OR (
      (source_url IS NOT NULL OR source_kind IN ('employer_direct', 'staff_attestation', 'casework_aggregate'))
      AND accessed_on IS NOT NULL AND source_grade IN ('A', 'B'))),
  CONSTRAINT evidence_needs_url CHECK (source_url IS NOT NULL OR source_kind IN ('employer_direct', 'staff_attestation', 'casework_aggregate')),
  CONSTRAINT evidence_role_scope CHECK (scope <> 'role' OR role_title IS NOT NULL OR role_family IS NOT NULL),
  -- A role posting speaks for that role only (finding 5).
  CONSTRAINT evidence_role_signal_is_role CHECK (claim_type <> 'direct_role_signal' OR scope = 'role'),
  CONSTRAINT evidence_place_scope CHECK (
       (scope = 'company' AND place_id IS NULL)
    OR (scope IN ('state', 'county', 'place') AND place_id IS NOT NULL)
    OR scope = 'role'),
  -- Casework: counts required, never free text or links, sources listed (findings 1, 8).
  CONSTRAINT evidence_casework_shape CHECK (
       (source_kind = 'casework_aggregate'
        AND outcome_count IS NOT NULL AND org_count IS NOT NULL AND outcome_count >= 1 AND org_count >= 1
        AND cardinality(source_orgs) = org_count
        AND source_url IS NULL AND source_title IS NULL AND publisher IS NULL
        AND excerpt IS NULL AND limitations IS NULL AND role_title IS NULL)
    OR (source_kind <> 'casework_aggregate' AND outcome_count IS NULL AND org_count IS NULL)),
  CONSTRAINT evidence_negative_names_sources CHECK (claim_type <> 'negative_experience' OR cardinality(source_orgs) >= 1),
  CONSTRAINT evidence_expiry_after_observed CHECK (expires_on > observed_on),
  CONSTRAINT evidence_supersession CHECK ((status = 'superseded') = (superseded_by IS NOT NULL) AND superseded_by IS DISTINCT FROM id)
);
CREATE INDEX IF NOT EXISTS employer_evidence_live_place ON employer_evidence (place_id, org_id, expires_on) WHERE status = 'active' AND place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employer_evidence_live_company ON employer_evidence (org_id, expires_on) WHERE status = 'active' AND place_id IS NULL;

-- On insert: expiry comes from the policy and can only be SHORTER; no date may
-- be in the future; scope must match the kind of place (findings 3, 5).
CREATE OR REPLACE FUNCTION public.employer_evidence_insert() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE ttl int; pk text;
BEGIN
  SELECT p.ttl_days INTO ttl FROM directory_claim_policy p WHERE p.claim_type = NEW.claim_type;
  IF NEW.expires_on IS NULL THEN
    NEW.expires_on := NEW.observed_on + ttl;
  ELSIF NEW.expires_on = 'infinity'::date OR NEW.expires_on > NEW.observed_on + ttl THEN
    RAISE EXCEPTION 'expiry may shorten the policy (% days), never extend it', ttl USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.observed_on > current_date OR NEW.accessed_on > current_date OR NEW.checked_on > current_date THEN
    RAISE EXCEPTION 'evidence cannot be dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'active' OR NEW.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'new evidence starts active' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.place_id IS NOT NULL THEN
    SELECT place_kind INTO pk FROM employer_place WHERE id = NEW.place_id;
    IF (NEW.scope = 'place' AND pk NOT IN ('site', 'service_area', 'remote'))
       OR (NEW.scope = 'county' AND pk <> 'county')
       OR (NEW.scope = 'state' AND pk <> 'statewide') THEN
      RAISE EXCEPTION 'scope % does not fit a % place', NEW.scope, pk USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_evidence_expiry ON employer_evidence;
DROP TRIGGER IF EXISTS employer_evidence_insert ON employer_evidence;
CREATE TRIGGER employer_evidence_insert BEFORE INSERT ON employer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.employer_evidence_insert();

-- On update: only the status may move, forward, and a supersession must point
-- at a newer active item of the same employer. A new observation is a new row.
CREATE OR REPLACE FUNCTION public.employer_evidence_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE succ record;
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'superseded_by') THEN
    RAISE EXCEPTION 'evidence is superseded, never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'active'   AND NEW.status IN ('superseded', 'withdrawn', 'disputed'))
    OR (OLD.status = 'disputed' AND NEW.status IN ('active', 'superseded', 'withdrawn'))) THEN
    RAISE EXCEPTION 'evidence cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    IF OLD.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'a supersession is not re-pointed' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id, org_id, status, created_at INTO succ FROM employer_evidence WHERE id = NEW.superseded_by;
    IF succ.id IS NULL OR succ.org_id <> NEW.org_id OR succ.status <> 'active'
       OR (succ.created_at, succ.id) <= (NEW.created_at, NEW.id) THEN
      RAISE EXCEPTION 'evidence may only be superseded by a newer active item of the same employer' USING ERRCODE = 'check_violation';
    END IF;
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
  place_id          UUID,
  contact_id        UUID NOT NULL,
  signed_up_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  terms_version     TEXT NOT NULL,
  public_listing_ok BOOLEAN NOT NULL DEFAULT true,
  wants             TEXT[] NOT NULL DEFAULT '{}' CHECK (wants <@ ARRAY['referrals', 'bonding_info', 'hiring_event', 'case_manager_reference']::text[]),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES employer_contact (org_id, id)
);

-- What can exclude a match, each tied to evidence of the same employer.
-- offense_category_bar is used only against a category the seeker chose to
-- disclose themselves (Troy, 2026-09-24). Never inferred.
CREATE TABLE IF NOT EXISTS employer_requirement (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id    UUID,
  role_family TEXT,
  role_title  TEXT,
  requirement TEXT NOT NULL CHECK (requirement IN ('cdl', 'clean_driving_years', 'caregiver_clearance', 'professional_license',
                                                   'drug_test', 'lookback_years', 'offense_category_bar')),
  value       TEXT,
  evidence_id UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  FOREIGN KEY (org_id, evidence_id) REFERENCES employer_evidence (org_id, id)
);
CREATE INDEX IF NOT EXISTS employer_requirement_org ON employer_requirement (org_id);

-- Shown beside a negative, never instead of it.
CREATE TABLE IF NOT EXISTS employer_reply (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  evidence_id UUID NOT NULL,
  reply_text  TEXT NOT NULL CHECK (length(btrim(reply_text)) BETWEEN 1 AND 1000),
  received_on DATE NOT NULL,
  contact_id  UUID,
  shown       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, evidence_id) REFERENCES employer_evidence (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES employer_contact (org_id, id)
);
CREATE INDEX IF NOT EXISTS employer_reply_latest_shown ON employer_reply (evidence_id, received_on DESC, id) WHERE shown;

-- An owned row never changes owner (finding 4).
CREATE OR REPLACE FUNCTION public.directory_owner_fixed() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION '% rows never move to another employer', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employer_alias', 'employer_place', 'employer_contact', 'employer_relationship',
                           'employer_relationship_confirmation', 'employer_signup', 'employer_requirement', 'employer_reply'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_owner_fixed', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.directory_owner_fixed()', t || '_owner_fixed', t);
  END LOOP;
END $$;

-- Confirmations are dated today or earlier (finding 6).
CREATE OR REPLACE FUNCTION public.employer_confirmation_date() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.confirmed_on > current_date THEN
    RAISE EXCEPTION 'a confirmation cannot be dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_confirmation_date ON employer_relationship_confirmation;
CREATE TRIGGER employer_confirmation_date BEFORE INSERT ON employer_relationship_confirmation
  FOR EACH ROW EXECUTE FUNCTION public.employer_confirmation_date();

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
-- Unexpired, active evidence. A Certain item whose relationship is no longer
-- live falls to Likely only if it meets Likely's own source rule, otherwise to
-- Guessing (finding 6). Internal: never granted to the app.
DROP VIEW IF EXISTS directory_health_v, directory_mark_v, directory_public_evidence_v, directory_public_v,
                    employer_standing_v, directory_place_evidence, directory_evidence_live;

CREATE VIEW directory_evidence_live WITH (security_barrier = true) AS
SELECT e.*, p.polarity, p.earns_mark AS claim_earns_mark, p.needs_two_sources, p.inherit_level,
       CASE
         WHEN e.confidence <> 'certain' THEN e.confidence
         WHEN public.directory_relationship_is_live(e.relationship_id) THEN 'certain'
         WHEN (e.source_url IS NOT NULL OR e.source_kind IN ('employer_direct', 'staff_attestation', 'casework_aggregate'))
              AND e.accessed_on IS NOT NULL AND e.source_grade IN ('A', 'B') THEN 'likely'
         ELSE 'guessing'
       END AS effective_confidence
  FROM employer_evidence e
  JOIN directory_claim_policy p ON p.claim_type = e.claim_type
 WHERE e.status = 'active' AND e.expires_on >= current_date;

-- For each place, the evidence that reaches it, in four disjoint branches:
-- its own, from a county place of the same employer, from a statewide place of
-- the same employer, or company-wide. How far each claim may reach comes from
-- the policy; a franchise location takes nothing from county or state places.
CREATE VIEW directory_place_evidence WITH (security_barrier = true) AS
SELECT pl.id AS target_place_id, 'place'::text AS coverage, ev.*
  FROM employer_place pl
  JOIN directory_evidence_live ev ON ev.place_id = pl.id AND ev.org_id = pl.org_id
UNION ALL
SELECT pl.id, 'county', ev.*
  FROM employer_place pl
  JOIN employer_org o ON o.id = pl.org_id AND o.operating_model <> 'franchise'
  JOIN employer_place ep ON ep.org_id = pl.org_id AND ep.id <> pl.id AND ep.place_kind = 'county'
   AND ep.state = pl.state AND lower(btrim(ep.county)) = lower(btrim(pl.county))
  JOIN directory_evidence_live ev ON ev.place_id = ep.id AND ev.org_id = ep.org_id AND ev.inherit_level IN ('county', 'state')
UNION ALL
SELECT pl.id, 'state', ev.*
  FROM employer_place pl
  JOIN employer_org o ON o.id = pl.org_id AND o.operating_model <> 'franchise'
  JOIN employer_place ep ON ep.org_id = pl.org_id AND ep.id <> pl.id AND ep.place_kind = 'statewide' AND ep.state = pl.state
  JOIN directory_evidence_live ev ON ev.place_id = ep.id AND ev.org_id = ep.org_id AND ev.inherit_level = 'state'
UNION ALL
SELECT pl.id, 'company', ev.*
  FROM employer_place pl
  JOIN directory_evidence_live ev ON ev.place_id IS NULL AND ev.org_id = pl.org_id;

CREATE VIEW employer_standing_v WITH (security_barrier = true) AS
WITH pe AS (
  SELECT d.*, (d.coverage <> 'company') AS is_local,
         -- Casework dates never reach the public more precisely than a quarter.
         CASE WHEN d.source_kind = 'casework_aggregate' THEN date_trunc('quarter', d.observed_on)::date
              ELSE greatest(d.observed_on, coalesce(d.accessed_on, d.observed_on)) END AS public_date,
         CASE WHEN d.source_kind = 'casework_aggregate' THEN date_trunc('quarter', d.expires_on)::date
              ELSE d.expires_on END AS public_expiry,
         CASE d.effective_confidence WHEN 'certain' THEN 3 WHEN 'likely' THEN 2 ELSE 1 END AS conf_rank
    FROM directory_place_evidence d
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
  SELECT pl.id AS place_id, pl.org_id, o.org_kind, f.*, coalesce(bad.bad_sources, 0) AS bad_sources,
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
      WHEN coalesce(s.hire OR s.attest OR s.local_yes OR s.role_yes OR s.reported, false)
           AND (coalesce(s.said_no, false) OR s.bad_enough)                       THEN 'mixed'
      WHEN coalesce(s.said_no, false)                                             THEN 'says_no'
      -- Two independent reports of being turned down, with no local yes (finding 7).
      WHEN s.bad_enough                                                           THEN 'reported_turned_down'
      WHEN coalesce(s.hire, false)                                                THEN 'proven_here'
      WHEN coalesce(s.attest, false)                                              THEN 'vouched_here'
      WHEN coalesce(s.local_yes, false)                                           THEN 'says_yes_here'
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
                                WHEN 'says_yes_here' THEN r.local_yes_mark END, false) AS earns_mark,
       CASE (CASE r.standing
               WHEN 'proven_here' THEN r.c_hire WHEN 'vouched_here' THEN r.c_attest
               WHEN 'says_yes_here' THEN r.c_local_yes WHEN 'says_yes_for_roles' THEN r.c_role
               WHEN 'reported_here' THEN r.c_reported WHEN 'company_policy' THEN r.c_corporate
               WHEN 'mixed' THEN r.c_no WHEN 'says_no' THEN r.c_no WHEN 'reported_turned_down' THEN r.c_no END)
         WHEN 3 THEN 'certain' WHEN 2 THEN 'likely' WHEN 1 THEN 'guessing' END AS confidence,
       r.bad_sources, r.soonest_local_expiry, r.last_evidence_on, coalesce(r.evidence_ids, '{}') AS evidence_ids
  FROM r;

-- ---------------------------------------------------------------------------
-- 8. The doors the app may use. Each selects only what may be public.
-- ---------------------------------------------------------------------------
-- The board: public employers, where they are, their standing, and how fresh.
-- Dates that could come from casework are already coarsened in the standing.
CREATE VIEW directory_public_v WITH (security_barrier = true) AS
SELECT o.id AS org_id, o.canonical_name, o.org_kind, o.industry, o.careers_url, o.website, o.operating_model,
       pl.id AS place_id, pl.place_kind, pl.city, pl.county, pl.state,
       st.standing, st.earns_mark, st.confidence, st.soonest_local_expiry, st.last_evidence_on
  FROM employer_org o
  JOIN employer_place pl ON pl.org_id = o.id
  JOIN employer_standing_v st ON st.place_id = pl.id
 WHERE o.listing_visibility = 'public';

-- "Why this mark": the evidence behind a public standing, in two projections.
-- Outside sources show in full. Casework shows only at county and quarter, with
-- no link, no text and no site; role family and the count appear only at three
-- or more (finding 1). A bad experience appears only once two independent
-- organizations report it (finding 7). Negatives carry the employer's reply.
CREATE VIEW directory_public_evidence_v WITH (security_barrier = true) AS
SELECT ev.id, ev.org_id, ev.place_id, pl.county, pl.state, ev.scope, ev.claim_type, ev.polarity,
       ev.role_family, ev.role_title, ev.source_kind, ev.source_url, ev.source_title, ev.publisher, ev.excerpt,
       ev.source_grade, ev.effective_confidence AS confidence, ev.observed_on, ev.expires_on,
       NULL::integer AS outcome_count, ev.limitations,
       (SELECT r.reply_text FROM employer_reply r WHERE r.evidence_id = ev.id AND r.shown ORDER BY r.received_on DESC, r.id DESC LIMIT 1) AS employer_reply
  FROM directory_evidence_live ev
  JOIN employer_org o ON o.id = ev.org_id AND o.listing_visibility = 'public'
  LEFT JOIN employer_place pl ON pl.id = ev.place_id
 WHERE ev.source_kind <> 'casework_aggregate'
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
   AND ev.polarity IN ('yes', 'no')
   AND (ev.claim_type <> 'negative_experience' OR ev.org_count >= 2);

-- The names that may carry a mark on a job listing, and WHERE, and for WHAT.
-- basis 'employer': the place's standing earns the mark for any role.
-- basis 'role': a live posting says yes for that role only; the app must match
-- the role too. Public employers only (finding 2); nothing from a place whose
-- standing is a no. Exact keys only; canonical names and aliases share one
-- namespace (finding 9).
CREATE VIEW directory_mark_v WITH (security_barrier = true) AS
WITH marks AS (
  SELECT st.org_id, st.place_id, 'employer'::text AS basis, NULL::text AS role_family, NULL::text AS role_title
    FROM employer_standing_v st
   WHERE st.earns_mark
  UNION ALL
  SELECT ev.org_id, ev.place_id, 'role', ev.role_family, ev.role_title
    FROM directory_evidence_live ev
    JOIN employer_standing_v st ON st.place_id = ev.place_id
   WHERE ev.claim_type = 'direct_role_signal' AND ev.claim_earns_mark
     AND st.standing NOT IN ('mixed', 'says_no', 'reported_turned_down', 'not_an_employer')
)
SELECT DISTINCT k.key AS name_key, m.basis, m.role_family, m.role_title,
       pl.place_kind, pl.state, pl.county, pl.city
  FROM marks m
  JOIN employer_place pl ON pl.id = m.place_id
  JOIN employer_org o ON o.id = m.org_id AND o.listing_visibility = 'public'
  CROSS JOIN LATERAL (SELECT o.name_key AS key UNION SELECT a.alias_key FROM employer_alias a WHERE a.org_id = o.id) k;

-- For the health check: what is about to go stale, what has nothing, what lapsed.
CREATE VIEW directory_health_v WITH (security_barrier = true) AS
WITH st AS (SELECT standing, earns_mark FROM employer_standing_v)
SELECT
  (SELECT count(*) FROM employer_org)                                                             AS orgs,
  (SELECT count(*) FROM employer_place)                                                           AS places,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active')                                AS evidence_active,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active' AND expires_on < current_date)  AS evidence_expired,
  (SELECT count(*) FROM employer_evidence WHERE status = 'active' AND expires_on BETWEEN current_date AND current_date + 14) AS evidence_expiring_14d,
  (SELECT count(*) FROM st WHERE earns_mark)                                                      AS places_with_mark,
  (SELECT count(*) FROM st WHERE standing = 'lead')                                               AS places_lead_only,
  (SELECT count(*) FROM employer_relationship r WHERE r.status = 'active'
      AND NOT public.directory_relationship_is_live(r.id))                                        AS relationships_not_live,
  (SELECT count(*) FROM directory_proposal WHERE status = 'pending')                              AS proposals_pending
 WHERE EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 9. Row-level security: platform admins only, on every table
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directory_claim_policy', 'employer_org', 'employer_alias', 'employer_place', 'employer_contact',
                           'employer_relationship', 'employer_relationship_confirmation', 'employer_evidence', 'employer_signup',
                           'employer_requirement', 'employer_reply', 'directory_proposal', 'directory_import'] LOOP
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

-- Grants. The same list lives in scripts/lib/restricted-grants.mjs, and
-- scripts/verify-directory-grants.mjs checks the effective result BEFORE any
-- repair script runs (finding 10). Production's default privileges hand a new
-- table OR VIEW full rights to smr_app on creation, so every object here is
-- revoked first, then given back only what it needs. PUBLIC gets nothing.
DO $$
BEGIN
  REVOKE ALL ON directory_claim_policy, employer_org, employer_alias, employer_place, employer_contact,
                employer_relationship, employer_relationship_confirmation, employer_evidence, employer_signup,
                employer_requirement, employer_reply, directory_proposal, directory_import,
                directory_evidence_live, directory_place_evidence, employer_standing_v,
                directory_public_v, directory_public_evidence_v, directory_mark_v, directory_health_v FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON directory_claim_policy, employer_org, employer_alias, employer_place, employer_contact,
                  employer_relationship, employer_relationship_confirmation, employer_evidence, employer_signup,
                  employer_requirement, employer_reply, directory_proposal, directory_import,
                  directory_evidence_live, directory_place_evidence, employer_standing_v,
                  directory_public_v, directory_public_evidence_v, directory_mark_v, directory_health_v FROM smr_app;
    GRANT SELECT ON directory_claim_policy TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON employer_org, employer_alias, employer_place, employer_contact,
                  employer_relationship, employer_evidence, employer_signup, employer_requirement,
                  employer_reply, directory_proposal TO smr_app;
    GRANT SELECT, INSERT ON employer_relationship_confirmation TO smr_app;
    GRANT SELECT ON directory_import TO smr_app;
    GRANT SELECT ON directory_public_v, directory_public_evidence_v, directory_mark_v, directory_health_v TO smr_app;
  END IF;
END $$;
