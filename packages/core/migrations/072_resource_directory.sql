-- 072_resource_directory.sql  (v3, drafted 2026-10-05, NOT APPLIED)
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
-- ROLLBACK (pre-import only; destroys directory rows; run as owner, by hand):
--   DROP VIEW resource_recheck_queue_v, resource_chain_public_v, resource_public_v;
--   DROP TABLE resource_suppression, resource_chain_step_review, resource_chain_step_dep,
--     resource_chain_step, resource_chain, resource_contact, resource_check,
--     resource_service, resource_org, resource_area;
--   DROP FUNCTION public.resource_check_guard(), public.resource_check_insert(),
--     public.resource_chain_guard(), public.resource_step_insert_guard(),
--     public.resource_no_change(), public.resource_no_delete(), public.resource_fields_hash(resource_service);
--   and remove the resource_* rows from restricted-grants.mjs.
--   (Written as comments on purpose: a migration never drops. Run by hand only.)

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
  CHECK (verify_method = 'dataset' OR review_result IS NOT NULL)
);
CREATE INDEX resource_check_live ON resource_check (service_id) WHERE status = 'live';

-- The hash both sides must agree on. If a service's public fields are edited
-- after a check, the hash no longer matches and the row leaves the public view
-- until it is checked again. FIX-2: covers every column the public view shows.
-- NOT covered by this hash: barrier_tags and urgency_fit are claims. Until each
-- has a source field, the import must leave a tag only when the check's quote
-- supports it (import rule, see the import script).
CREATE OR REPLACE FUNCTION public.resource_fields_hash(s resource_service) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT md5(concat_ws('|',
    coalesce(s.service_name,''), coalesce(s.description,''), coalesce(s.area_id,''), coalesce(s.stew_tier,''),
    coalesce(s.geo_scope,''), coalesce(s.state,''), coalesce(s.county,''), array_to_string(s.counties, ','),
    coalesce(s.city,''), coalesce(s.address,''), coalesce(s.zip,''), coalesce(s.phone,''), coalesce(s.hours,''),
    coalesce(s.eligibility,''), coalesce(s.fees,''), coalesce(s.what_to_bring,''), coalesce(s.limits,''),
    array_to_string(s.barrier_tags, ','), coalesce(s.urgency_fit,''), s.adult_facing::text))
$$;
REVOKE EXECUTE ON FUNCTION public.resource_fields_hash(resource_service) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resource_check_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cap int; svc resource_service%ROWTYPE; newest date;
BEGIN
  SELECT * INTO svc FROM resource_service WHERE id = NEW.service_id;
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
  IF NEW.fields_hash IS DISTINCT FROM public.resource_fields_hash(svc) THEN
    RAISE EXCEPTION 'fields_hash does not match service %', NEW.service_id USING ERRCODE = 'check_violation';
  END IF;
  -- FIX-4: a backdated check never supersedes a newer live one.
  SELECT max(observed_on) INTO newest FROM resource_check WHERE service_id = NEW.service_id AND status = 'live';
  IF newest IS NOT NULL AND NEW.observed_on < newest THEN
    RAISE EXCEPTION 'observed_on % is older than the live check (%)', NEW.observed_on, newest USING ERRCODE = 'check_violation';
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
  IF (to_jsonb(NEW) - 'status' - 'status_reason' - 'expires_on') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason' - 'expires_on') THEN
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
  send_status      text NOT NULL DEFAULT 'ok' CHECK (send_status IN ('ok','bounced','do_not_contact')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR contact_page_url IS NOT NULL)
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
  chain_id        uuid NOT NULL,
  n               int  NOT NULL,
  review_verdict  text NOT NULL CHECK (review_verdict IN
                    ('UNREVIEWED','CONFIRMED','CERTIFIED','STALE','OVERREACH','WRONG','UNVERIFIABLE')),
  review_depth    text CHECK (review_depth IN ('quote','facts')),
  reviewer        text NOT NULL,
  reviewed_on     date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id, n) REFERENCES resource_chain_step (chain_id, n)
);
CREATE INDEX resource_chain_step_review_latest ON resource_chain_step_review (chain_id, n, created_at DESC);

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
  IF (to_jsonb(NEW) - 'status' - 'status_reason' - 'use_status' - 'expires_on')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason' - 'use_status' - 'expires_on') THEN
    RAISE EXCEPTION 'a chain is versioned, never rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'live' THEN
    RAISE EXCEPTION 'a chain cannot leave %', OLD.status USING ERRCODE = 'check_violation';
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
                   AND status = 'live' AND use_status IN ('unreviewed','hold')) THEN
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

-- 6. Public views. The only door. Dates are pinned to UTC and the expiry day
--    itself is hidden (strictly greater), which errs toward hiding early.
--    Each open decision is marked OWNER.
CREATE VIEW resource_public_v WITH (security_barrier = true) AS
SELECT s.id AS service_id, o.name AS org_name, s.service_name, s.description,
       a.domain_id, s.area_id, s.stew_tier, s.geo_scope, s.state, s.county, s.counties, s.city,
       s.address, s.zip, s.phone, s.hours, s.eligibility, s.fees, s.what_to_bring, s.limits,
       s.barrier_tags, s.urgency_fit,
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
   AND c.fields_hash = public.resource_fields_hash(s)
   AND c.review_result = 'PASS'                          -- BLOCK-1: blank is not a pass
   AND c.verify_method <> 'dataset'                      -- OWNER D-1: dataset-only rows hidden until decided
WHERE s.status = 'active' AND s.adult_facing;            -- OWNER D-9: school-based sites hidden

-- A chain shows only when it is live, unexpired, confidence high or medium,
-- marked usable, and every step's LATEST review is fact-checked clean with no
-- open law conflict. Every chain it depends on must itself show. A chain with one
-- bad step is a wrong chain, so chains hide whole, never by step.
CREATE VIEW resource_chain_public_v WITH (security_barrier = true) AS
WITH latest AS (
  SELECT DISTINCT ON (r.chain_id, r.n) r.chain_id, r.n, r.review_verdict, r.review_depth
  FROM resource_chain_step_review r
  ORDER BY r.chain_id, r.n, r.created_at DESC
),
ok AS (
  SELECT ch.id, ch.chain_key
  FROM resource_chain ch
  WHERE ch.status = 'live'
    AND ch.expires_on > (now() AT TIME ZONE 'UTC')::date
    AND ch.confidence IN ('high','medium')                       -- BLOCK-2: low chains never show
    AND ch.use_status IN ('usable','usable_with_stated_limits')  -- OWNER D-3: stated-limits chains
    AND NOT EXISTS (
      SELECT 1 FROM resource_chain_step st
      LEFT JOIN latest lr ON lr.chain_id = st.chain_id AND lr.n = st.n
      WHERE st.chain_id = ch.id
        AND (st.law_conflict IS NOT NULL                          -- OWNER D-3 / S-8
          OR coalesce(NOT (lr.review_verdict = 'CERTIFIED'
               OR (lr.review_verdict = 'CONFIRMED' AND lr.review_depth = 'facts')), true))
    )
)
SELECT ch.chain_key, ch.state, ch.goal, ch.unlocks, ch.observed_on AS verified_on, ch.expires_on,
       ch.confidence, ch.use_status, st.n, st.action, st.agency, st.requires, st.cost, st.wait_time,
       st.where_how, st.url, st.phone, st.no_docs_fallback, st.fee_waiver, st.record_specific,
       st.source_url, st.observed_on AS step_verified_on
FROM ok
JOIN resource_chain ch      ON ch.id = ok.id
JOIN resource_chain_step st ON st.chain_id = ch.id
WHERE NOT EXISTS (
  SELECT 1 FROM resource_chain_step_dep d
  WHERE d.chain_id = ch.id AND d.dep_kind = 'chain'
    AND d.dep_chain_key NOT IN (SELECT chain_key FROM ok));

-- What needs a look: every active service that is not showing, plus any showing
-- service whose check expires within 14 days. Ids and place only. Not for the app role.
CREATE VIEW resource_recheck_queue_v WITH (security_barrier = true) AS
SELECT s.id AS service_id, s.state, s.county, s.area_id, s.stew_tier,
       k.expires_on AS live_until, k.confidence AS last_confidence
FROM resource_service s
LEFT JOIN LATERAL (
  SELECT k2.* FROM resource_check k2
  WHERE k2.service_id = s.id AND k2.status = 'live'
  ORDER BY k2.observed_on DESC, k2.created_at DESC LIMIT 1
) k ON true
WHERE s.status = 'active'
  AND (NOT EXISTS (SELECT 1 FROM resource_public_v p WHERE p.service_id = s.id)
    OR k.expires_on <= (now() AT TIME ZONE 'UTC')::date + 14);

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
              resource_chain_step_dep, resource_public_v, resource_chain_public_v, resource_recheck_queue_v FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON resource_area, resource_org, resource_service, resource_check, resource_contact,
                  resource_suppression, resource_chain, resource_chain_step, resource_chain_step_review,
                  resource_chain_step_dep, resource_public_v, resource_chain_public_v, resource_recheck_queue_v FROM smr_app;
    GRANT SELECT ON resource_public_v, resource_chain_public_v TO smr_app;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.resource_check_insert(), public.resource_check_guard(),
                           public.resource_chain_guard(), public.resource_step_insert_guard(),
                           public.resource_no_change(), public.resource_no_delete() FROM PUBLIC;
