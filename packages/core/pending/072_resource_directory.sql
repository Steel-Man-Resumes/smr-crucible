-- 072_resource_directory.sql  (v3.7, drafted 2026-10-05, NOT APPLIED)
-- v3.7: sixth-review fixes. A service that has ever had a T1 check cannot take a lower tier, and an
-- approved T1 check cannot be withdrawn (no withdraw-then-relabel). A superseded or withdrawn
-- prerequisite holds its dependents AND clears their approval. A suppression added later reaches
-- existing contacts. Header assumptions now state the costs: an approver's platform_admin row cannot
-- be deleted while it is referenced (by design), and the approver name is a process control, not a
-- schema guarantee.
-- v3.6: fifth-review fixes. Approval is a platform admin's user id (a real FK, never blank), can
-- be set only on a live check, and a review change on an approved chain puts it back on hold.
-- A T1 service cannot be downgraded by a later check. Dataset and risky contacts are held.
-- Approver and reviewer identities are NOT verified against a login: the design relies on the owner
-- recording the real person. The post-apply counts do not detect a forged name. The approver name is a
-- PROCESS control (approval is run from Troy's own session and recorded in the change log), not a
-- schema guarantee. An approver's platform_admin row cannot be deleted while it is referenced: that is
-- by design (the approval record must keep pointing at a real admin). Revoking an admin is a later
-- migration (revoked_on), and Troy decides when.
-- v3.5: human approval for the top tier (Troy 2026-10-05). A service check at review tier T1 shows
-- only with human_approved_by set. A chain shows only with human_approved_by set. AI review is
-- accepted below the top tier. Recorded, not inferred: the approver's name is written by a person.
-- v3.4: fourth-review fixes. Reviewer identity on every PASS (M2). A superseded prerequisite holds
-- its dependents (M3). CERTIFIED needs depth facts (L1). A contact on a suppressed address is
-- do-not-contact at insert (L5). ASSUMPTION, stated: protection against the table owner rests on
-- the owner's discipline and on the post-apply counts (triggers, view definitions). The app role
-- has no base-table grants and no EXECUTE on these functions; an owner who disables triggers or
-- replaces a view leaves no row trace, so record the counts after each change.
-- v3.3: third review fixes (F1-F3, F5, F6, F8, F10-F14, F21-F22). Hash is jsonb-based (no delimiter
-- collisions). Barrier tags and urgency are hidden from the public view until each has a source.
-- v3.2: adversary re-review fixes (2026-10-05): H1 transitive chain dependencies, H2 org name
-- and website are in the hash, H3 paused services and chains are in a recheck queue, H4 review
-- order by identity sequence, M2 one live check per service, M3 no delete or truncate on every
-- base table, M4 step freshness, M5 stated-limits chains hidden until a limits field exists (D-3),
-- L2 STABLE hash, L3 PASS needs a tier. Dataset and low-confidence rows still never show.
-- v3.1: guards exclude the generated column expires_on (found by a live test, PostgreSQL 18).
-- Local help and step-by-step document paths, built around dated checks.
--
-- Supersedes the v2 draft (prospect-machine output/resource-intel). v3 applies
-- the adversary review of v2 (2026-10-05): BLOCK-1..4 and FIX-1..9, FIX-11, and
-- LOW-2..4. Still open and NOT settled here: FIX-10 (notes counts), barrier
-- tags need a source field (see the note at resource_fields_hash), and the
-- Troy decisions D-1, D-3, D-9.
--
-- WHY. A directory of local help goes stale quietly: a phone changes, a shelter
-- closes, a clinic moves. Here the unit of trust is the CHECK: one dated look at
-- one service against one source. What a reader sees is derived from the newest
-- check when it is read, so a lapsed or contradicted row drops out by itself and
-- nothing has to run on a schedule to hide it. Same idea as 061 for employers.
--
-- ADDITIVE. Touches no existing table.
--
-- WHO MAY SEE WHAT. Platform tables. RLS on and forced; only a platform admin
-- reads or writes base tables, and nothing is deleted. The app role holds SELECT
-- on two public views and nothing else here. Contacts are in their own table and
-- are in no view. As in 061, the views run with the owner's rights and are
-- security barriers; the owner must have BYPASSRLS (guard below).
--
-- ALSO REQUIRED IN THE SAME CHANGE: add every resource_* object to
-- scripts/lib/restricted-grants.mjs (RESTRICTED_GRANTS and DIRECTORY_OBJECTS):
-- [] for every table and for resource_recheck_queue_v, ["SELECT"] for the two
-- public views. Without that, a fresh database re-grants full DML to the app role.
--
-- ROLLBACK (pre-import only; destroys directory rows; run as owner, by hand; order matters):
--   DROP VIEW resource_chain_recheck_queue_v, resource_recheck_queue_v;
--   DROP VIEW resource_chain_public_v, resource_public_v;
--   DROP TABLE resource_suppression, resource_chain_step_review, resource_chain_step_dep,
--     resource_chain_step, resource_chain, resource_contact, resource_check,
--     resource_service, resource_org, resource_area;
--   DROP FUNCTION public.resource_check_guard(), public.resource_check_insert(),
--     public.resource_chain_guard(), public.resource_step_insert_guard(), public.resource_no_change(),
--     public.resource_no_delete(), public.resource_fields_hash(resource_service, text, text),
--     public.resource_contact_guard(), public.resource_service_guard(), public.resource_org_guard(),
--     public.resource_chain_insert_guard(), public.resource_step_future_guard(), public.resource_dep_guard();
--   and remove the resource_* rows from restricted-grants.mjs.

-- 0. Fail loudly where the views would be silently empty.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'resource views need an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

-- 1. Areas. default_ttl_days is the CAP on a check's ttl for that area (enforced
--    in resource_check_insert). A rule change is a new migration.
CREATE TABLE resource_area (
  area_id          text PRIMARY KEY,
  domain_id        text NOT NULL CHECK (domain_id IN
                     ('stability','health','legal_identity','employment_education','connection')),
  label            text NOT NULL,
  default_ttl_days int  NOT NULL CHECK (default_ttl_days BETWEEN 30 AND 365)
);
INSERT INTO resource_area (area_id, domain_id, label, default_ttl_days) VALUES
  ('shelter','stability','Shelter & Housing',60), ('food','stability','Food & Meals',60),
  ('clothing','stability','Clothing & Supplies',90), ('safety','stability','Safety & DV',60),
  ('physical','health','Physical Health',90), ('mental','health','Mental Health',90),
  ('recovery','health','Substance Recovery',90),
  ('id_documents','legal_identity','ID & Documents',90), ('legal_aid','legal_identity','Legal Aid',90),
  ('expungement','legal_identity','Expungement & Records',90), ('courts','legal_identity','Courts & Compliance',180),
  ('jobs','employment_education','Jobs & Employment',90), ('training','employment_education','Job Training',90),
  ('education','employment_education','Education',90), ('financial','employment_education','Financial Help',90),
  ('community','connection','Community & Peer Support',90), ('faith','connection','Faith Communities',90),
  ('veterans','connection','Veterans Services',90), ('youth','connection','Youth Services',90),
  ('transportation','connection','Transportation',90);

-- 2. Organizations and services. A new service starts PAUSED and must name
--    whether it is adult-facing: nothing shows by default (FIX-6).
CREATE TABLE resource_org (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_key         text NOT NULL UNIQUE,
  name            text NOT NULL,
  org_type        text NOT NULL CHECK (org_type IN
                    ('government','nonprofit','legal_aid','tribal','faith_nonprofit','public_health','other')),
  nonprofit_check text,
  website         text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','hijacked','excluded')),
  status_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resource_service (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES resource_org(id),
  source_row_id   text,                          -- staging key; makes the import rerunnable
  service_name    text,
  description     text NOT NULL,
  area_id         text NOT NULL REFERENCES resource_area(area_id),
  stew_tier       text NOT NULL DEFAULT 'core' CHECK (stew_tier IN ('critical','core','extended')),
  ecosystem_level text CHECK (ecosystem_level IN ('individual','community','organization','system')),
  geo_scope       text NOT NULL CHECK (geo_scope IN ('city','county','multi_county','statewide','national')),
  state           text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  county          text,
  counties        text[] NOT NULL DEFAULT '{}',  -- for multi_county
  city            text,
  address         text,
  zip             text,
  phone           text,
  hours           text,
  eligibility     text,
  fees            text,
  what_to_bring   text,
  limits          text,
  barrier_tags    text[] NOT NULL DEFAULT '{}' CHECK (barrier_tags <@ ARRAY[
                    'no_id_required','justice_friendly','free','sliding_scale','spanish_available',
                    'wheelchair_accessible','walk_in','children_ok','no_insurance_ok']),
  urgency_fit     text CHECK (urgency_fit IN ('today','this_week','ongoing')),
  adult_facing    boolean NOT NULL,              -- no default: every row says it (FIX-6). false for school-based sites
  status          text NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused','closed','withdrawn')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_service_geo_shape CHECK (
       (geo_scope IN ('statewide','national') AND city IS NULL AND county IS NULL)
    OR (geo_scope = 'county' AND county IS NOT NULL)
    OR (geo_scope = 'city' AND city IS NOT NULL)
    OR (geo_scope = 'multi_county'))
);
CREATE UNIQUE INDEX resource_service_source_row ON resource_service (source_row_id) WHERE source_row_id IS NOT NULL;
CREATE INDEX resource_service_geo ON resource_service (state, county, area_id) WHERE status = 'active';

-- 3. Checks. Insert-only except status. A new check supersedes the previous live
--    one for the service, so "the newest check" is always the only live one.
CREATE TABLE resource_check (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES resource_service(id),
  source_url      text NOT NULL CHECK (source_url ~ '^https?://'),
  source_type     text NOT NULL CHECK (source_type IN
                    ('official_site','government_site','federal_dataset','state_dataset','org_confirmed_email')),
  quote           text NOT NULL CHECK (length(btrim(quote)) > 0),
  page_dated      date,
  observed_on     date NOT NULL,
  verify_method   text NOT NULL CHECK (verify_method IN ('playwright','fetch','dataset','org_reply')),
  confidence      text NOT NULL CHECK (confidence IN ('high','medium','low')),
  ttl_days        int  NOT NULL CHECK (ttl_days BETWEEN 30 AND 365),
  expires_on      date GENERATED ALWAYS AS (observed_on + ttl_days) STORED,
  fields_hash     text NOT NULL,                 -- md5 of the public service fields this check covered; verified at insert
  volatile_fields text[] NOT NULL DEFAULT '{}',
  review_tier     text CHECK (review_tier IN ('T1','T4')),
  review_result   text CHECK (review_result IN ('PASS','PARTIAL','FAIL','UNVERIFIABLE')),
  review_by       text,                          -- M2: who reviewed; required when a result is set
  review_on       date,
  human_approved_by uuid REFERENCES platform_admin(user_id),  -- top tier (T1): a named person signs off
  human_approved_on date,
  status          text NOT NULL DEFAULT 'live' CHECK (status IN ('live','superseded','withdrawn')),
  status_reason   text,
  lane            text,
  import_batch    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (verify_method = 'dataset' AND confidence = 'high')),
  CHECK ((verify_method = 'org_reply') = (source_type = 'org_confirmed_email')),
  -- FIX-7: a dataset row is a federal or state dataset, and only those are dataset rows.
  CHECK ((verify_method = 'dataset') = (source_type IN ('federal_dataset','state_dataset'))),
  -- BLOCK-1: a non-dataset row cannot show without a recorded review. Blank is not a pass.
  CHECK (verify_method = 'dataset' OR review_result IS NOT NULL),
  CHECK (review_result IS DISTINCT FROM 'PASS' OR review_tier IS NOT NULL),
  CHECK (review_result IS NULL OR review_by IS NOT NULL),
  CHECK ((human_approved_by IS NULL) = (human_approved_on IS NULL)),
  CHECK (review_by IS NULL OR length(btrim(review_by)) > 0)
);  -- top-tier approval is enforced in the public view, so an unapproved T1 row stays stored and hidden
CREATE UNIQUE INDEX resource_check_one_live ON resource_check (service_id) WHERE status = 'live';

-- The hash both sides must agree on. A jsonb array keeps NULL distinct from '' and
-- escapes every delimiter, so no two different field sets share a hash (F10). Covers every
-- service field AND the org name and website the public view shows (H2). The import
-- mirrors this exactly (build_resource_import.py fields_hash) and the insert trigger
-- refuses any mismatch, so a drift fails loudly rather than silently.
CREATE OR REPLACE FUNCTION public.resource_fields_hash(s resource_service, org_name text, org_website text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT md5(jsonb_build_array(s.service_name, s.description, s.area_id, s.stew_tier, s.geo_scope, s.state,
    s.county, to_jsonb(s.counties), s.city, s.address, s.zip, s.phone, s.hours, s.eligibility, s.fees,
    s.what_to_bring, s.limits, to_jsonb(s.barrier_tags), s.urgency_fit, s.adult_facing,
    org_name, org_website)::text)
$$;
REVOKE EXECUTE ON FUNCTION public.resource_fields_hash(resource_service, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resource_check_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cap int; svc resource_service%ROWTYPE; newest date; org_name text; org_web text; prior_tier text;
BEGIN
  SELECT * INTO svc FROM resource_service WHERE id = NEW.service_id;
  SELECT o.name, o.website INTO org_name, org_web FROM resource_org o WHERE o.id = svc.org_id;
  SELECT a.default_ttl_days INTO cap FROM resource_area a WHERE a.area_id = svc.area_id;
  IF NEW.ttl_days > cap THEN
    RAISE EXCEPTION 'ttl % exceeds area cap %', NEW.ttl_days, cap USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.observed_on > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'observed_on is in the future' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'live' THEN
    RAISE EXCEPTION 'a new check starts live' USING ERRCODE = 'check_violation';
  END IF;
  -- FIX-11: the hash must be the hash of the service as it is now.
  IF NEW.fields_hash IS DISTINCT FROM public.resource_fields_hash(svc, org_name, org_web) THEN
    RAISE EXCEPTION 'fields_hash does not match service %', NEW.service_id USING ERRCODE = 'check_violation';
  END IF;
  -- FIX-4: a backdated check never supersedes a newer live one.
  SELECT max(observed_on) INTO newest FROM resource_check WHERE service_id = NEW.service_id;
  IF newest IS NOT NULL AND NEW.observed_on < newest THEN
    RAISE EXCEPTION 'observed_on % is older than the live check (%)', NEW.observed_on, newest USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.review_tier IS DISTINCT FROM 'T1' AND EXISTS (SELECT 1 FROM resource_check r WHERE r.service_id = NEW.service_id AND r.review_tier = 'T1') THEN
    RAISE EXCEPTION 'a T1 service cannot be replaced by a lower tier; approve a T1 check' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE resource_check SET status = 'superseded', status_reason = 'newer check'
   WHERE service_id = NEW.service_id AND status = 'live';
  RETURN NEW;
END $$;
CREATE TRIGGER resource_check_insert BEFORE INSERT ON resource_check
  FOR EACH ROW EXECUTE FUNCTION public.resource_check_insert();

CREATE OR REPLACE FUNCTION public.resource_check_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- expires_on is GENERATED: its NEW value is empty inside a BEFORE trigger, so it is excluded.
  IF NEW.status = 'withdrawn' AND OLD.review_tier = 'T1' THEN
    RAISE EXCEPTION 'an approved T1 check is not withdrawn; supersede it with a new T1 check' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.human_approved_by IS DISTINCT FROM OLD.human_approved_by AND OLD.status <> 'live' THEN
    RAISE EXCEPTION 'approval is only given on a live check' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'status_reason' - 'expires_on' - 'human_approved_by' - 'human_approved_on') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason' - 'expires_on' - 'human_approved_by' - 'human_approved_on') THEN
    RAISE EXCEPTION 'a check is superseded, never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'live' THEN
    RAISE EXCEPTION 'a check cannot leave %', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_check_guard BEFORE UPDATE ON resource_check
  FOR EACH ROW EXECUTE FUNCTION public.resource_check_guard();

-- 4. Contacts and suppression. In no view. Never granted to the app role.
--    Rule: no send to dataset_only or risky_domain without a person looking.
CREATE TABLE resource_contact (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES resource_org(id),
  email            text,
  contact_name     text,
  contact_role     text,
  contact_page_url text,
  seen_on_url      text NOT NULL,
  seen_on          date NOT NULL,                -- the check date of the row it came from
  email_trust      text NOT NULL CHECK (email_trust IN
                     ('org_site','org_site_freemail','site_confirmed','site_replaced','dataset_only','risky_domain')),
  send_status      text NOT NULL DEFAULT 'ok' CHECK (send_status IN ('ok','bounced','do_not_contact','hold')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR contact_page_url IS NOT NULL),
  -- F7: no send to a dataset or risky address without a person looking (header rule)
  CHECK (send_status <> 'ok' OR email_trust NOT IN ('dataset_only','risky_domain'))
);
CREATE UNIQUE INDEX resource_contact_email ON resource_contact (org_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE resource_suppression (             -- global, by address; checked at send time
  email_lower text PRIMARY KEY CHECK (email_lower = lower(email_lower)),
  reason      text NOT NULL,
  added_on    date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date
);

-- 5. Chains. A chain is versioned, never edited: a corrected chain is a new row
--    and the old one is superseded. Steps never change. Reviews are a separate
--    insert-only table, so a step can be reviewed later (BLOCK-3 / FIX-3).
CREATE TABLE resource_chain (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_key    text NOT NULL,
  state        text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  goal         text NOT NULL,
  unlocks      text[] NOT NULL DEFAULT '{}',
  observed_on  date NOT NULL,
  ttl_days     int  NOT NULL DEFAULT 180 CHECK (ttl_days BETWEEN 30 AND 365),
  expires_on   date GENERATED ALWAYS AS (observed_on + ttl_days) STORED,
  confidence   text NOT NULL CHECK (confidence IN ('high','medium','low')),
  use_status   text NOT NULL DEFAULT 'unreviewed' CHECK (use_status IN
                 ('unreviewed','hold','usable_with_stated_limits','usable')),
  status       text NOT NULL DEFAULT 'live' CHECK (status IN ('live','superseded','withdrawn')),
  status_reason text,
  human_approved_by uuid REFERENCES platform_admin(user_id),  -- top tier: a named person signs off
  human_approved_on date,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX resource_chain_live_key ON resource_chain (chain_key) WHERE status = 'live';

CREATE TABLE resource_chain_step (
  chain_id        uuid NOT NULL REFERENCES resource_chain(id),
  n               int  NOT NULL CHECK (n > 0),
  action          text NOT NULL,
  agency          text,
  requires        text[] NOT NULL DEFAULT '{}',  -- display text; the queryable form is resource_chain_step_dep
  cost            text,
  wait_time       text,
  where_how       text,                          -- staging column "where"
  url             text,
  phone           text,
  no_docs_fallback text,
  fee_waiver      text,
  record_specific text,
  source_url      text NOT NULL CHECK (source_url ~ '^https?://'),
  quote           text NOT NULL CHECK (length(btrim(quote)) > 0),
  observed_on     date NOT NULL,                 -- FIX-9: each step carries its own date
  page_dated      date,
  law_conflict    text,                          -- statute and agency page disagree
  PRIMARY KEY (chain_id, n)
);

CREATE TABLE resource_chain_step_review (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,  -- ordering: now() is the same for a whole transaction (H4)
  chain_id        uuid NOT NULL,
  n               int  NOT NULL,
  review_verdict  text NOT NULL CHECK (review_verdict IN
                    ('UNREVIEWED','CONFIRMED','CERTIFIED','STALE','OVERREACH','WRONG','UNVERIFIABLE')),
  review_depth    text CHECK (review_depth IN ('quote','facts')),
  reviewer        text NOT NULL,
  reviewed_on     date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id, n) REFERENCES resource_chain_step (chain_id, n),
  CHECK (review_verdict NOT IN ('CONFIRMED','CERTIFIED') OR review_depth IS NOT NULL),
  CHECK (review_verdict <> 'CERTIFIED' OR review_depth = 'facts')  -- L1
);
CREATE INDEX resource_chain_step_review_latest ON resource_chain_step_review (chain_id, n, seq DESC);

CREATE TABLE resource_chain_step_dep (
  chain_id          uuid NOT NULL,
  n                 int  NOT NULL,
  dep_kind          text NOT NULL CHECK (dep_kind IN ('document','step','chain')),
  dep_text          text,
  dep_step          int,
  dep_chain_key     text,                        -- resolved against the live chain at read time
  alternative_group int,                         -- rows sharing a group are alternatives (OR)
  FOREIGN KEY (chain_id, n) REFERENCES resource_chain_step (chain_id, n),
  CHECK ((dep_kind = 'step' AND dep_step IS NOT NULL)
      OR (dep_kind = 'chain' AND dep_chain_key IS NOT NULL)
      OR (dep_kind = 'document' AND dep_text IS NOT NULL))
);
CREATE INDEX resource_chain_step_dep_step ON resource_chain_step_dep (chain_id, n);

CREATE OR REPLACE FUNCTION public.resource_chain_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- expires_on is GENERATED: excluded (see resource_check_guard).
  IF (to_jsonb(NEW) - 'status' - 'status_reason' - 'use_status' - 'expires_on' - 'human_approved_by' - 'human_approved_on')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason' - 'use_status' - 'expires_on' - 'human_approved_by' - 'human_approved_on') THEN
    RAISE EXCEPTION 'a chain is versioned, never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'live' THEN
    RAISE EXCEPTION 'a chain cannot leave %', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  -- M3: a new version of a prerequisite may mean something else; every live dependent is held
  -- until someone re-reviews its steps against the new version.
  IF NEW.use_status IN ('usable','usable_with_stated_limits') AND NEW.human_approved_by IS NULL THEN
    RAISE EXCEPTION 'a chain needs a person to approve it before it is usable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('superseded','withdrawn') AND OLD.status = 'live' THEN
    UPDATE resource_chain SET use_status = 'hold', human_approved_by = NULL, human_approved_on = NULL
     WHERE status = 'live' AND id IN (
       SELECT d.chain_id FROM resource_chain_step_dep d
        WHERE d.dep_kind = 'chain' AND d.dep_chain_key = OLD.chain_key);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_chain_guard BEFORE UPDATE ON resource_chain
  FOR EACH ROW EXECUTE FUNCTION public.resource_chain_guard();

-- FIX (chain build): steps and their dependencies are added only while the chain
-- is live and not yet usable. Once a chain is usable, its steps are fixed.
CREATE OR REPLACE FUNCTION public.resource_step_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM resource_chain WHERE id = NEW.chain_id
                   AND status = 'live' AND use_status IN ('unreviewed','hold') AND human_approved_by IS NULL) THEN
    RAISE EXCEPTION 'steps can only be added to a live chain that is not yet usable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_chain_step_insert BEFORE INSERT ON resource_chain_step
  FOR EACH ROW EXECUTE FUNCTION public.resource_step_insert_guard();
CREATE TRIGGER resource_chain_step_dep_insert BEFORE INSERT ON resource_chain_step_dep
  FOR EACH ROW EXECUTE FUNCTION public.resource_step_insert_guard();

CREATE OR REPLACE FUNCTION public.resource_no_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% rows are insert-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
-- LOW-4 / LOW-3: nothing is deleted or truncated, for any directory table.
CREATE OR REPLACE FUNCTION public.resource_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'nothing in % is deleted; set status instead', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER resource_chain_step_fixed BEFORE UPDATE OR DELETE ON resource_chain_step
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_chain_step_dep_fixed BEFORE UPDATE OR DELETE ON resource_chain_step_dep
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_chain_step_review_fixed BEFORE UPDATE OR DELETE ON resource_chain_step_review
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_org_no_delete BEFORE DELETE ON resource_org
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_service_no_delete BEFORE DELETE ON resource_service
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_check_no_delete BEFORE DELETE ON resource_check
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_contact_no_delete BEFORE DELETE ON resource_contact
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_chain_step_no_truncate BEFORE TRUNCATE ON resource_chain_step
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_chain_step_dep_no_truncate BEFORE TRUNCATE ON resource_chain_step_dep
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_chain_step_review_no_truncate BEFORE TRUNCATE ON resource_chain_step_review
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();

-- L5: an address on the suppression list starts do-not-contact, whatever the importer says.
CREATE OR REPLACE FUNCTION public.resource_contact_suppressed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (SELECT 1 FROM resource_suppression x WHERE x.email_lower = lower(NEW.email)) THEN
    NEW.send_status := 'do_not_contact';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_contact_suppressed BEFORE INSERT ON resource_contact
  FOR EACH ROW EXECUTE FUNCTION public.resource_contact_suppressed();

-- F-C: a suppression added after a contact was written reaches that contact too.
CREATE OR REPLACE FUNCTION public.resource_suppress_existing() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE resource_contact SET send_status = 'do_not_contact'
   WHERE lower(email) = NEW.email_lower AND send_status <> 'do_not_contact';
  RETURN NULL;
END $$;
CREATE TRIGGER resource_suppress_existing AFTER INSERT ON resource_suppression
  FOR EACH ROW EXECUTE FUNCTION public.resource_suppress_existing();

-- F1 / F11: the do-not-contact list and the area rules cannot be rewritten.
CREATE TRIGGER resource_suppression_fixed BEFORE UPDATE ON resource_suppression
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_area_fixed BEFORE UPDATE ON resource_area
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();

-- F2: a do-not-contact stays; an address or trust tag never changes in place (add a new row).
CREATE OR REPLACE FUNCTION public.resource_contact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.send_status = 'do_not_contact' AND NEW.send_status IS DISTINCT FROM OLD.send_status THEN
    RAISE EXCEPTION 'a do-not-contact stays do-not-contact' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.email_trust IS DISTINCT FROM OLD.email_trust THEN
    RAISE EXCEPTION 'contact address and trust are never edited in place; add a new contact row' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_contact_guard BEFORE UPDATE ON resource_contact
  FOR EACH ROW EXECUTE FUNCTION public.resource_contact_guard();

-- F3: terminal statuses stay terminal. A reactivated service or org would show on its old check.
CREATE OR REPLACE FUNCTION public.resource_service_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status IN ('closed','withdrawn') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a % service is terminal: add a new service row and a new check', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_service_guard BEFORE UPDATE ON resource_service
  FOR EACH ROW EXECUTE FUNCTION public.resource_service_guard();

CREATE OR REPLACE FUNCTION public.resource_org_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status IN ('closed','hijacked','excluded') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a % org is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_org_guard BEFORE UPDATE ON resource_org
  FOR EACH ROW EXECUTE FUNCTION public.resource_org_guard();

-- F5 / F13: a chain enters the database unreviewed (or on hold) and dated no later than today.
CREATE OR REPLACE FUNCTION public.resource_chain_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.use_status NOT IN ('unreviewed','hold') THEN
    RAISE EXCEPTION 'a chain is inserted unreviewed or on hold, then set usable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.observed_on > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'chain observed_on is in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_chain_insert_guard BEFORE INSERT ON resource_chain
  FOR EACH ROW EXECUTE FUNCTION public.resource_chain_insert_guard();

CREATE OR REPLACE FUNCTION public.resource_step_future_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.observed_on > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'step observed_on is in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_step_future_guard BEFORE INSERT ON resource_chain_step
  FOR EACH ROW EXECUTE FUNCTION public.resource_step_future_guard();

-- F6: a dependency may not close a loop. Refused at insert, through every live link.
CREATE OR REPLACE FUNCTION public.resource_dep_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE src_key text;
BEGIN
  IF NEW.dep_kind <> 'chain' THEN RETURN NEW; END IF;
  SELECT c.chain_key INTO src_key FROM resource_chain c WHERE c.id = NEW.chain_id;
  IF src_key = NEW.dep_chain_key THEN
    RAISE EXCEPTION 'a chain cannot depend on itself' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE reach(k) AS (
      SELECT NEW.dep_chain_key
      UNION
      SELECT d.dep_chain_key FROM reach r
        JOIN resource_chain c ON c.chain_key = r.k AND c.status = 'live'
        JOIN resource_chain_step_dep d ON d.chain_id = c.id AND d.dep_kind = 'chain'
    )
    SELECT 1 FROM reach WHERE k = src_key) THEN
    RAISE EXCEPTION 'dependency % would close a loop back to %', NEW.dep_chain_key, src_key USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.resource_review_resets_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE resource_chain SET use_status = 'hold', human_approved_by = NULL, human_approved_on = NULL
   WHERE id = NEW.chain_id AND human_approved_by IS NOT NULL;
  RETURN NULL;
END $$;
CREATE TRIGGER resource_review_resets_approval AFTER INSERT ON resource_chain_step_review
  FOR EACH ROW EXECUTE FUNCTION public.resource_review_resets_approval();

CREATE TRIGGER resource_chain_step_dep_guard BEFORE INSERT ON resource_chain_step_dep
  FOR EACH ROW EXECUTE FUNCTION public.resource_dep_guard();

-- M3: nothing deleted or truncated, on every base table.
CREATE TRIGGER resource_chain_no_delete BEFORE DELETE ON resource_chain
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_area_no_delete BEFORE DELETE ON resource_area
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_suppression_no_delete BEFORE DELETE ON resource_suppression
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_area_no_truncate BEFORE TRUNCATE ON resource_area
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_org_no_truncate BEFORE TRUNCATE ON resource_org
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_service_no_truncate BEFORE TRUNCATE ON resource_service
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_check_no_truncate BEFORE TRUNCATE ON resource_check
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_contact_no_truncate BEFORE TRUNCATE ON resource_contact
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_suppression_no_truncate BEFORE TRUNCATE ON resource_suppression
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_chain_no_truncate BEFORE TRUNCATE ON resource_chain
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();

-- 6. Public views. The only door. Dates are pinned to UTC and the expiry day
--    itself is hidden (strictly greater), which errs toward hiding early.
--    Each open decision is marked OWNER.
CREATE VIEW resource_public_v WITH (security_barrier = true) AS
SELECT s.id AS service_id, o.name AS org_name, s.service_name, s.description,
       a.domain_id, s.area_id, s.stew_tier, s.geo_scope, s.state, s.county, s.counties, s.city,
       s.address, s.zip, s.phone, s.hours, s.eligibility, s.fees, s.what_to_bring, s.limits,
       '{}'::text[] AS barrier_tags, NULL::text AS urgency_fit,  -- F8: unsourced claims, hidden until a source field exists
       -- show the website only when the check was made on that same host
       CASE WHEN o.website IS NOT NULL
             AND split_part(split_part(c.source_url, '://', 2), '/', 1)
               = split_part(split_part(o.website,   '://', 2), '/', 1) THEN o.website END AS website,
       c.source_url, c.observed_on AS verified_on, c.expires_on, c.confidence, c.verify_method
FROM resource_service s
JOIN resource_org o  ON o.id = s.org_id AND o.status = 'active'
JOIN resource_area a ON a.area_id = s.area_id
JOIN LATERAL (
  SELECT k.* FROM resource_check k
  WHERE k.service_id = s.id AND k.status = 'live'
  ORDER BY k.observed_on DESC, k.created_at DESC LIMIT 1
) c ON c.confidence IN ('high','medium')                 -- BLOCK-1/2: low never shows
   AND c.expires_on > (now() AT TIME ZONE 'UTC')::date
   AND c.fields_hash = public.resource_fields_hash(s, o.name, o.website)
   AND c.review_result = 'PASS'                          -- BLOCK-1: blank is not a pass
   AND (c.review_tier IS DISTINCT FROM 'T1' OR c.human_approved_by IS NOT NULL)   -- top tier needs a person
   AND c.verify_method <> 'dataset'                      -- OWNER D-1: dataset-only rows hidden until decided
WHERE s.status = 'active' AND s.adult_facing;            -- OWNER D-9: school-based sites hidden

-- A chain shows only when it is live, unexpired, confidence high or medium, marked
-- usable (M5 / OWNER D-3: usable_with_stated_limits stays hidden until a limits field
-- exists), every step is fresh within the chain's ttl (M4), every step's LATEST review
-- (highest seq) is fact-checked clean with no open law conflict, and every chain it
-- depends on shows too, transitively (H1). A chain hides whole, never by step.
CREATE VIEW resource_chain_public_v WITH (security_barrier = true) AS
WITH RECURSIVE latest AS (
  SELECT DISTINCT ON (r.chain_id, r.n) r.chain_id, r.n, r.review_verdict, r.review_depth
  FROM resource_chain_step_review r
  ORDER BY r.chain_id, r.n, r.seq DESC
),
own_ok AS (
  SELECT ch.id, ch.chain_key
  FROM resource_chain ch
  WHERE ch.status = 'live'
    AND ch.expires_on > (now() AT TIME ZONE 'UTC')::date
    AND ch.confidence IN ('high','medium')
    AND ch.use_status = 'usable'
    AND ch.human_approved_by IS NOT NULL
    AND EXISTS (SELECT 1 FROM resource_chain_step s0 WHERE s0.chain_id = ch.id)
    AND NOT EXISTS (
      SELECT 1 FROM resource_chain_step st
      LEFT JOIN latest lr ON lr.chain_id = st.chain_id AND lr.n = st.n
      WHERE st.chain_id = ch.id
        AND (st.law_conflict IS NOT NULL
          OR coalesce(NOT ((lr.review_verdict IN ('CONFIRMED','CERTIFIED') AND lr.review_depth = 'facts')), true)))
    AND NOT EXISTS (
      SELECT 1 FROM resource_chain_step s2
      WHERE s2.chain_id = ch.id
        AND s2.observed_on + ch.ttl_days <= (now() AT TIME ZONE 'UTC')::date)
),
bad(id) AS (
  SELECT ch.id FROM resource_chain ch
  WHERE ch.status = 'live' AND NOT EXISTS (SELECT 1 FROM own_ok o WHERE o.id = ch.id)
  UNION
  SELECT d.chain_id FROM resource_chain_step_dep d
  WHERE d.dep_kind = 'chain' AND d.dep_chain_key NOT IN (SELECT o.chain_key FROM own_ok o)
  UNION
  SELECT d.chain_id FROM resource_chain_step_dep d
  JOIN resource_chain t ON t.chain_key = d.dep_chain_key AND t.status = 'live'
  JOIN bad b ON b.id = t.id
  WHERE d.dep_kind = 'chain'
),
ok AS (
  SELECT o.id, o.chain_key FROM own_ok o WHERE o.id NOT IN (SELECT b.id FROM bad b)
)
SELECT ch.chain_key, ch.state, ch.goal, ch.unlocks, ch.observed_on AS verified_on, ch.expires_on,
       ch.confidence, ch.use_status, st.n, st.action, st.agency, st.requires, st.cost, st.wait_time,
       st.where_how, st.url, st.phone, st.no_docs_fallback, st.fee_waiver, st.record_specific,
       st.source_url, st.observed_on AS step_verified_on
FROM ok
JOIN resource_chain ch      ON ch.id = ok.id
JOIN resource_chain_step st ON st.chain_id = ch.id;

-- What needs a look: every active or paused service that is not showing, plus any
-- showing service whose check expires within 14 days (H3: paused is the default for a
-- new service, so it must be in the queue). Closed and withdrawn are not queued: decide.
-- Ids and place only. Not for the app role.
CREATE VIEW resource_recheck_queue_v WITH (security_barrier = true) AS
SELECT s.id AS service_id, s.state, s.county, s.area_id, s.stew_tier,
       k.expires_on AS live_until, k.confidence AS last_confidence,
       k.review_tier, k.review_result, (k.human_approved_by IS NOT NULL) AS approved
FROM resource_service s
LEFT JOIN LATERAL (
  SELECT k2.* FROM resource_check k2
  WHERE k2.service_id = s.id AND k2.status = 'live'
  ORDER BY k2.observed_on DESC, k2.created_at DESC LIMIT 1
) k ON true
WHERE s.status IN ('active','paused')
  AND (NOT EXISTS (SELECT 1 FROM resource_public_v p WHERE p.service_id = s.id)
    OR k.expires_on <= (now() AT TIME ZONE 'UTC')::date + 14);

-- Chains that are not showing, or whose check lapses within 14 days (H3).
CREATE VIEW resource_chain_recheck_queue_v WITH (security_barrier = true) AS
SELECT ch.id AS chain_id, ch.chain_key, ch.state, ch.expires_on AS live_until
FROM resource_chain ch
WHERE ch.status = 'live'
  AND (NOT EXISTS (SELECT 1 FROM resource_chain_public_v p WHERE p.chain_key = ch.chain_key)
    OR ch.expires_on <= (now() AT TIME ZONE 'UTC')::date + 14);

-- 7. RLS: admin-only on base tables; select, insert, update. No delete policy.
DO $$
DECLARE t text;
  adm constant text := $q$EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$q$;
BEGIN
  FOREACH t IN ARRAY ARRAY['resource_area','resource_org','resource_service','resource_check','resource_contact',
                           'resource_suppression','resource_chain','resource_chain_step','resource_chain_step_review',
                           'resource_chain_step_dep'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (%s)', t || '_admin_select', t, adm);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (%s)', t || '_admin_insert', t, adm);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (%s) WITH CHECK (%s)', t || '_admin_update', t, adm, adm);
  END LOOP;
END $$;

-- 8. Grants. The app role is born with default DML on new objects; take it away,
--    then give back SELECT on the two public views only. Not inside an IF EXISTS
--    for the revoke itself: PUBLIC is always revoked (FIX, restricted-grants trap).
REVOKE ALL ON resource_area, resource_org, resource_service, resource_check, resource_contact,
              resource_suppression, resource_chain, resource_chain_step, resource_chain_step_review,
              resource_chain_step_dep, resource_public_v, resource_chain_public_v, resource_recheck_queue_v, resource_chain_recheck_queue_v FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON resource_area, resource_org, resource_service, resource_check, resource_contact,
                  resource_suppression, resource_chain, resource_chain_step, resource_chain_step_review,
                  resource_chain_step_dep, resource_public_v, resource_chain_public_v, resource_recheck_queue_v, resource_chain_recheck_queue_v FROM smr_app;
    GRANT SELECT ON resource_public_v, resource_chain_public_v TO smr_app;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.resource_check_insert(), public.resource_check_guard(),
                           public.resource_chain_guard(), public.resource_step_insert_guard(),
                           public.resource_no_change(), public.resource_no_delete(),
                           public.resource_contact_guard(), public.resource_service_guard(), public.resource_org_guard(),
                           public.resource_chain_insert_guard(), public.resource_step_future_guard(), public.resource_dep_guard(),
                           public.resource_contact_suppressed(), public.resource_review_resets_approval(),
                           public.resource_suppress_existing() FROM PUBLIC;
