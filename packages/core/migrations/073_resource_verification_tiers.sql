-- 073_resource_verification_tiers.sql  (v1, drafted 2026-10-08, NOT APPLIED, NOT REVIEWED)
-- Verification tiers for the resource directory (Troy 2026-10-08):
--   R1 public record      the org's or an agency's own page, quote on the page (lowest, may be shown)
--   R2 multiple proof     two or more INDEPENDENT sources agree
--   R3 contacted          the org itself confirmed the listing
--   R4 working            a working relationship or active contact
-- R0 is "held": nothing is claimed. A tier is DERIVED when read, never stored on a row, so a lapsed
-- check, an expired confirmation or a lapsed relationship drops the tier by itself (same idea as 072).
-- NOT the same thing as resource_check.review_tier ('T1','T4') in 072: that column marks content that
-- needs a named person's approval before it shows (legal, ID, courts). It is unchanged by this file.
--
-- ADDITIVE. Adds five tables and two owner-only views. Alters no existing table, trigger or view,
-- and does not touch resource_public_v or resource_chain_public_v (so the recorded md5 baselines for
-- those two views do not move). Exposing a tier to the app is a later, separate change made when
-- services are activated; it will need new baselines.
--
-- WHAT COUNTS (stated so it cannot drift):
--  R1 service: the newest live check is unexpired, confidence high or medium, its fields hash matches
--     the service as it is now, review_result PASS, and the check is not a dataset check.
--  R2 service: R1, plus at least one corroboration row that is flagged independent, is not weak, and
--     whose source host differs from the check's source host. A dataset check can reach R2 only through
--     such a corroboration from an org-owned or government page (source_type official_site or
--     government_site) that is unexpired; a dataset row with no such corroboration is R0.
--  R3 service: R2 not required. A live unexpired org_reply check (072: source_type org_confirmed_email),
--     OR a 'confirmed' relationship event for that service within 180 days. "We emailed" ('asked') is
--     recorded and never raises a tier.
--  R4 service: an active relationship for the org (service-scoped or org-wide) with a 'working' event
--     inside cadence_days + 14 days (same rule as directory_relationship_is_live in 061).
--  R3 and R4 need the service to be R1 or better first (a confirmed row whose own check has lapsed
--     does not show a high tier on stale data).
--  Chain: a chain is only as strong as its weakest step. Step R1 = latest review CONFIRMED or CERTIFIED
--     at depth facts and no open law conflict; step R2 = R1 plus an independent, non-weak step
--     corroboration whose host differs from the step's source host. Chain tier is the minimum over its
--     steps, and R0 unless the chain is live, unexpired, confidence high or medium. Chains reach R2 at
--     most in this version; agency confirmation of a chain is a later change.
--
-- COST, stated: independence is judged by source host plus the stored flag, so two hosts run by the
-- same organization can be wrongly counted independent if a person flags them so. The flag is a
-- process control (the importer records the reviewer's call), not a schema guarantee, as with approvals in 072.
--
-- ALSO REQUIRED IN THE SAME CHANGE: add the five tables and two views to scripts/lib/restricted-grants.mjs
-- (RESTRICTED_GRANTS and DIRECTORY_OBJECTS) with [] for every one.
--
-- ROLLBACK (data in the new tables is lost; run as owner, by hand; order matters):
--   DROP VIEW resource_chain_tier_v, resource_service_tier_v;
--   DROP TABLE resource_relationship_event, resource_relationship, resource_chain_step_corroboration,
--     resource_corroboration;
--   DROP FUNCTION public.resource_host(text), public.resource_corroboration_guard(),
--     public.resource_step_corroboration_guard(), public.resource_relationship_event_guard(),
--     public.resource_relationship_guard();
--   and remove the new names from restricted-grants.mjs.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'resource tier views need an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regclass('public.resource_check') IS NULL OR to_regclass('public.resource_chain_step_review') IS NULL THEN
    RAISE EXCEPTION '073 needs migration 072 applied first';
  END IF;
END $$;

-- Host of a URL, lowercased, no leading www. NULL for anything that is not http(s).
CREATE OR REPLACE FUNCTION public.resource_host(u text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN u ~* '^https?://' THEN
    regexp_replace(lower(split_part(split_part(split_part(u, '://', 2), '/', 1), ':', 1)), '^www\.', '') END
$$;

-- 1. Corroboration of a service check: a second source for the same service, from a different host.
CREATE TABLE resource_corroboration (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   uuid NOT NULL REFERENCES resource_service(id),
  check_id     uuid NOT NULL REFERENCES resource_check(id),
  source_url   text NOT NULL CHECK (source_url ~ '^https?://'),
  source_type  text NOT NULL CHECK (source_type IN ('official_site','government_site','federal_dataset','state_dataset','news','directory')),
  quote        text NOT NULL CHECK (length(btrim(quote)) > 0),
  observed_on  date NOT NULL,
  ttl_days     int  NOT NULL DEFAULT 90 CHECK (ttl_days BETWEEN 30 AND 365),
  expires_on   date GENERATED ALWAYS AS (observed_on + ttl_days) STORED,
  independent  boolean NOT NULL,                 -- a person's call: a different publisher, not the same organization
  weak         boolean NOT NULL DEFAULT false,   -- quote supports only part of the row
  recorded_by  text NOT NULL CHECK (length(btrim(recorded_by)) >= 2),
  import_batch text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_corroboration_service ON resource_corroboration (service_id);

CREATE OR REPLACE FUNCTION public.resource_corroboration_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM resource_check k WHERE k.id = NEW.check_id AND k.service_id = NEW.service_id AND k.status = 'live') THEN
    RAISE EXCEPTION 'corroboration must name a live check of the same service' USING ERRCODE = 'check_violation';
  END IF;
  IF public.resource_host(NEW.source_url) IS NULL THEN
    RAISE EXCEPTION 'corroboration needs an http(s) source url' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_corroboration_guard BEFORE INSERT ON resource_corroboration
  FOR EACH ROW EXECUTE FUNCTION public.resource_corroboration_guard();

-- 2. Corroboration of a chain step.
CREATE TABLE resource_chain_step_corroboration (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id     uuid NOT NULL,
  n            int  NOT NULL,
  source_url   text NOT NULL CHECK (source_url ~ '^https?://'),
  quote        text NOT NULL CHECK (length(btrim(quote)) > 0),
  observed_on  date NOT NULL,
  independent  boolean NOT NULL,
  weak         boolean NOT NULL DEFAULT false,
  recorded_by  text NOT NULL CHECK (length(btrim(recorded_by)) >= 2),
  import_batch text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id, n) REFERENCES resource_chain_step (chain_id, n)
);
CREATE INDEX resource_chain_step_corroboration_step ON resource_chain_step_corroboration (chain_id, n);

CREATE OR REPLACE FUNCTION public.resource_step_corroboration_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM resource_chain c WHERE c.id = NEW.chain_id AND c.status = 'live') THEN
    RAISE EXCEPTION 'step corroboration must name a live chain' USING ERRCODE = 'check_violation';
  END IF;
  IF public.resource_host(NEW.source_url) IS NULL THEN
    RAISE EXCEPTION 'step corroboration needs an http(s) source url' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_chain_step_corroboration_guard BEFORE INSERT ON resource_chain_step_corroboration
  FOR EACH ROW EXECUTE FUNCTION public.resource_step_corroboration_guard();

-- 3. Relationships and contact events (R3, R4). started_on is the first DOCUMENTED contact, never the
--    day research began. Events are written once.
CREATE TABLE resource_relationship (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES resource_org(id),
  service_id    uuid REFERENCES resource_service(id),      -- NULL = the whole organization
  started_on    date NOT NULL,
  cadence_days  int  NOT NULL DEFAULT 90 CHECK (cadence_days BETWEEN 7 AND 365),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','lapsed','ended')),
  note          text CHECK (note IS NULL OR length(note) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX resource_relationship_org ON resource_relationship (org_id);

CREATE OR REPLACE FUNCTION public.resource_relationship_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM resource_service s WHERE s.id = NEW.service_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'relationship service must belong to the relationship org' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'status' - 'note') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'note') THEN
      RAISE EXCEPTION 'only status and note of a relationship change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
      RAISE EXCEPTION 'an ended relationship stays ended; record a new one' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_relationship_guard BEFORE INSERT OR UPDATE ON resource_relationship
  FOR EACH ROW EXECUTE FUNCTION public.resource_relationship_guard();

CREATE TABLE resource_relationship_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES resource_relationship(id),
  service_id      uuid REFERENCES resource_service(id),
  kind            text NOT NULL CHECK (kind IN ('asked','confirmed','working')),
  occurred_on     date NOT NULL,
  method          text NOT NULL CHECK (method IN ('email_reply','phone_call','in_person','web_form','partner_report','email_sent')),
  recorded_by     text NOT NULL CHECK (length(btrim(recorded_by)) >= 2),
  note            text CHECK (note IS NULL OR length(note) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- an outbound email alone is only 'asked'; a confirmation or working contact is a reply, call, visit, form or partner report
  CHECK (kind = 'asked' OR method <> 'email_sent'),
  -- a confirmation is about a named service
  CHECK (kind <> 'confirmed' OR service_id IS NOT NULL)
);
CREATE INDEX resource_relationship_event_rel ON resource_relationship_event (relationship_id, occurred_on DESC);

CREATE OR REPLACE FUNCTION public.resource_relationship_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE rel resource_relationship%ROWTYPE;
BEGIN
  SELECT * INTO rel FROM resource_relationship WHERE id = NEW.relationship_id;
  IF NOT FOUND OR rel.status <> 'active' THEN
    RAISE EXCEPTION 'events go on an active relationship' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.occurred_on > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'an event cannot be dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.occurred_on < rel.started_on THEN
    RAISE EXCEPTION 'an event cannot predate the first documented contact' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM resource_service s WHERE s.id = NEW.service_id AND s.org_id = rel.org_id) THEN
    RAISE EXCEPTION 'event service must belong to the relationship org' USING ERRCODE = 'check_violation';
  END IF;
  IF rel.service_id IS NOT NULL AND NEW.service_id IS DISTINCT FROM rel.service_id THEN
    RAISE EXCEPTION 'event service must match a service-scoped relationship' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_relationship_event_guard BEFORE INSERT ON resource_relationship_event
  FOR EACH ROW EXECUTE FUNCTION public.resource_relationship_event_guard();

-- Insert-only / no delete / no truncate, as in 072.
CREATE TRIGGER resource_corroboration_fixed BEFORE UPDATE OR DELETE ON resource_corroboration
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_chain_step_corroboration_fixed BEFORE UPDATE OR DELETE ON resource_chain_step_corroboration
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_relationship_event_fixed BEFORE UPDATE OR DELETE ON resource_relationship_event
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_relationship_no_delete BEFORE DELETE ON resource_relationship
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_corroboration_no_truncate BEFORE TRUNCATE ON resource_corroboration
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_chain_step_corroboration_no_truncate BEFORE TRUNCATE ON resource_chain_step_corroboration
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_relationship_no_truncate BEFORE TRUNCATE ON resource_relationship
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
CREATE TRIGGER resource_relationship_event_no_truncate BEFORE TRUNCATE ON resource_relationship_event
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();

-- 4. Service tier. Owner-only. Fail closed: no rule matched = R0.
CREATE VIEW resource_service_tier_v WITH (security_barrier = true) AS
WITH base AS (
  SELECT s.id AS service_id, s.org_id, s.state, s.county, s.area_id, s.status AS service_status,
         c.id AS check_id, c.source_url AS check_url, c.verify_method, c.source_type,
         (c.confidence IN ('high','medium')
           AND c.expires_on > (now() AT TIME ZONE 'UTC')::date
           AND c.fields_hash = public.resource_fields_hash(s, o.name, o.website)
           AND o.status = 'active') AS check_fresh,
         (c.review_result = 'PASS') AS review_pass
  FROM resource_service s
  JOIN resource_org o ON o.id = s.org_id
  LEFT JOIN LATERAL (
    SELECT k.* FROM resource_check k WHERE k.service_id = s.id AND k.status = 'live'
    ORDER BY k.observed_on DESC, k.created_at DESC LIMIT 1
  ) c ON true
),
corr AS (
  SELECT b.service_id, count(*) AS n
  FROM base b
  JOIN resource_corroboration x ON x.service_id = b.service_id AND x.check_id = b.check_id
  WHERE x.independent AND NOT x.weak
    AND x.expires_on > (now() AT TIME ZONE 'UTC')::date
    AND public.resource_host(x.source_url) IS DISTINCT FROM public.resource_host(b.check_url)
    AND (b.verify_method <> 'dataset' OR x.source_type IN ('official_site','government_site'))
  GROUP BY b.service_id
),
conf AS (
  SELECT service_id, count(*) AS n FROM (
    SELECT k.service_id FROM resource_check k
     WHERE k.status = 'live' AND k.verify_method = 'org_reply'
       AND k.expires_on > (now() AT TIME ZONE 'UTC')::date
    UNION ALL
    SELECT coalesce(e.service_id, r.service_id) FROM resource_relationship_event e
      JOIN resource_relationship r ON r.id = e.relationship_id AND r.status = 'active'
     WHERE e.kind = 'confirmed' AND e.occurred_on + 180 >= (now() AT TIME ZONE 'UTC')::date
  ) t GROUP BY service_id
),
work AS (
  SELECT DISTINCT s.id AS service_id
  FROM resource_relationship r
  JOIN resource_service s ON s.org_id = r.org_id AND (r.service_id IS NULL OR r.service_id = s.id)
  WHERE r.status = 'active'
    AND EXISTS (SELECT 1 FROM resource_relationship_event e
                 WHERE e.relationship_id = r.id AND e.kind = 'working'
                   AND e.occurred_on + r.cadence_days + 14 >= (now() AT TIME ZONE 'UTC')::date)
)
SELECT b.service_id, b.state, b.county, b.area_id,
  CASE
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND w.service_id IS NOT NULL THEN 'R4'
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND cf.n > 0 THEN 'R3'
    WHEN b.check_fresh AND co.n > 0 AND (b.verify_method = 'dataset' OR b.review_pass) THEN 'R2'
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' THEN 'R1'
    ELSE 'R0' END AS tier,
  CASE
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND w.service_id IS NOT NULL THEN 'active relationship with a working contact inside its cadence'
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND cf.n > 0 THEN 'the org confirmed the listing'
    WHEN b.check_fresh AND co.n > 0 AND (b.verify_method = 'dataset' OR b.review_pass) THEN 'independent corroboration from a different host'
    WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' THEN 'one source, fact-checked'
    ELSE 'held: no clean live check, or dataset only' END AS tier_basis
FROM base b
LEFT JOIN corr co ON co.service_id = b.service_id
LEFT JOIN conf cf ON cf.service_id = b.service_id
LEFT JOIN work w  ON w.service_id = b.service_id;

-- 5. Chain tier. Owner-only. Minimum over steps; R0 unless the chain itself is live and unexpired.
CREATE VIEW resource_chain_tier_v WITH (security_barrier = true) AS
WITH latest AS (
  SELECT DISTINCT ON (r.chain_id, r.n) r.chain_id, r.n, r.review_verdict, r.review_depth
  FROM resource_chain_step_review r
  ORDER BY r.chain_id, r.n, r.seq DESC
),
step_tier AS (
  SELECT st.chain_id, st.n,
    CASE
      WHEN st.law_conflict IS NULL AND l.review_verdict IN ('CONFIRMED','CERTIFIED') AND l.review_depth = 'facts' THEN
        CASE WHEN EXISTS (
               SELECT 1 FROM resource_chain_step_corroboration x
                WHERE x.chain_id = st.chain_id AND x.n = st.n AND x.independent AND NOT x.weak
                  AND public.resource_host(x.source_url) IS DISTINCT FROM public.resource_host(st.source_url))
             THEN 2 ELSE 1 END
      ELSE 0 END AS lvl
  FROM resource_chain_step st
  LEFT JOIN latest l ON l.chain_id = st.chain_id AND l.n = st.n
)
SELECT ch.id AS chain_id, ch.chain_key, ch.state,
  CASE WHEN ch.status = 'live' AND ch.expires_on > (now() AT TIME ZONE 'UTC')::date
            AND ch.confidence IN ('high','medium')
            AND EXISTS (SELECT 1 FROM step_tier t WHERE t.chain_id = ch.id)
       THEN 'R' || (SELECT min(t.lvl) FROM step_tier t WHERE t.chain_id = ch.id)::text
       ELSE 'R0' END AS tier,
  (SELECT count(*) FROM step_tier t WHERE t.chain_id = ch.id AND t.lvl < 2) AS steps_below_r2
FROM resource_chain ch;

-- 6. RLS: admin-only, as in 072. No delete policy.
DO $$
DECLARE t text;
  adm constant text := $q$EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$q$;
BEGIN
  FOREACH t IN ARRAY ARRAY['resource_corroboration','resource_chain_step_corroboration','resource_relationship','resource_relationship_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (%s)', t || '_admin_select', t, adm);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (%s)', t || '_admin_insert', t, adm);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (%s) WITH CHECK (%s)', t || '_admin_update', t, adm, adm);
  END LOOP;
END $$;

-- 7. Grants: the app role gets nothing here.
REVOKE ALL ON resource_corroboration, resource_chain_step_corroboration, resource_relationship,
              resource_relationship_event, resource_service_tier_v, resource_chain_tier_v FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON resource_corroboration, resource_chain_step_corroboration, resource_relationship,
                  resource_relationship_event, resource_service_tier_v, resource_chain_tier_v FROM smr_app;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.resource_host(text), public.resource_corroboration_guard(),
                           public.resource_step_corroboration_guard(), public.resource_relationship_guard(),
                           public.resource_relationship_event_guard() FROM PUBLIC;
