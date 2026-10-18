-- 089_resource_public_bands.sql
-- Layered public resource publication (Troy 2026-10-18: "the data we have collected
-- should be shown publicly and immediately ... single source resources can be posted,
-- but siloed so its not claimed as canon ... list the best data first, then middle,
-- then poor so we are always serving some helpful info").
--
-- WHAT THIS ADDS (add only; no existing table, view, function or row is changed)
--   resource_band_rows()              SECURITY DEFINER read: every row of 084/088's
--                                     resource_publication_rows() as band 'A', plus the
--                                     services that 072's gate holds back, as band 'B' or
--                                     'C', with a plain-words band_reason.
--   resource_band_publication_v       the view over it; the app role reads it, nothing under it.
--   resource_chain_band_rows()        every row of resource_chain_publication_rows() as 'A',
--                                     plus live, fresh, high/medium chains with clean steps that
--                                     no person has approved yet, as 'B'.
--   resource_chain_band_publication_v the view over it.
--
-- THE BANDS
--   A  "Checked by Steel Man"               exactly resource_public_v / resource_publication_v:
--                                           review PASS, confidence high or medium, unexpired,
--                                           fields unchanged since the check, not dataset-only,
--                                           T1 content only with a named approval.
--   B  "Listed, not yet checked by us"      a dated public source, confidence high or medium,
--                                           unexpired, fields unchanged, but the review was
--                                           PARTIAL or UNVERIFIABLE, or T1 content still waits
--                                           for a named approval.
--   C  "Found, could not confirm. Call first."  dataset-only source (OWNER D-1 rows: Troy's
--                                           2026-10-18 ruling shows them, labelled), or low
--                                           confidence, or a check that lapsed within 90 days.
--   never                                   review FAIL (the page contradicted the listing),
--                                           fields changed since the check, no live check, a
--                                           check lapsed more than 90 days, closed or withdrawn
--                                           services, closed or excluded orgs, school-based
--                                           sites (adult_facing false). Contacts are in no view.
--   Chains: B needs status live, unexpired, confidence high or medium, at least one step, no
--   step with a law conflict, no stale step, use_status not usable_with_stated_limits (OWNER
--   D-3 still holds: a limit we cannot print is not shown), and no named approval yet.
--
-- WHO MAY SEE WHAT. Same shape as 082/084: definer functions (the owner must have BYPASSRLS),
-- security-barrier views, app role gets SELECT on the views and EXECUTE on the functions only.
-- 073's tier view stays owner-only. version = md5 of the published fields plus the band.
--
-- ROLLBACK (no data is lost; the site and the app fall back to the A-only publication):
--   DROP VIEW IF EXISTS resource_chain_band_publication_v;
--   DROP FUNCTION IF EXISTS public.resource_chain_band_rows();
--   DROP VIEW IF EXISTS resource_band_publication_v;
--   DROP FUNCTION IF EXISTS public.resource_band_rows();
--   DELETE FROM _migrations WHERE filename = '089_resource_public_bands.sql';
--   and remove the two views from scripts/lib/restricted-grants.mjs.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $release089$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '089 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = '088_resource_tier_confidence.sql') THEN
    RAISE EXCEPTION '089 needs migration 088 recorded in _migrations first';
  END IF;

  IF EXISTS (SELECT 1 FROM _migrations WHERE filename = '089_resource_public_bands.sql') THEN
    IF to_regclass('public.resource_band_publication_v') IS NULL OR to_regclass('public.resource_chain_band_publication_v') IS NULL THEN
      RAISE EXCEPTION '089 is recorded but a band view is missing; inspect without dropping data';
    END IF;
    RAISE NOTICE 'Already recorded, skipped: 089_resource_public_bands.sql';
    RETURN;
  END IF;

  -- Preflight: the objects 089 builds on are in their 088 shape, and nothing of 089 exists yet.
  IF to_regclass('public.resource_band_publication_v') IS NOT NULL OR to_regprocedure('public.resource_band_rows()') IS NOT NULL
     OR to_regclass('public.resource_chain_band_publication_v') IS NOT NULL OR to_regprocedure('public.resource_chain_band_rows()') IS NOT NULL THEN
    RAISE EXCEPTION '089 objects exist but 089 is not recorded; inspect before running';
  END IF;
  IF to_regprocedure('public.resource_publication_rows()') IS NULL OR to_regprocedure('public.resource_chain_publication_rows()') IS NULL
     OR to_regprocedure('public.resource_fields_hash(resource_service,text,text)') IS NULL OR to_regprocedure('public.resource_host(text)') IS NULL THEN
    RAISE EXCEPTION '089 preflight: a 072/073/084 function is missing; stop';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_publication_rows()'::regprocedure AND m = 't';
  IF n <> 27 THEN
    RAISE EXCEPTION '089 preflight: resource_publication_rows() has % output columns, expected 27 (088 shape); stop', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_chain_publication_rows()'::regprocedure AND m = 't';
  IF n <> 20 THEN
    RAISE EXCEPTION '089 preflight: resource_chain_publication_rows() has % output columns, expected 20 (084 shape); stop', n;
  END IF;

  EXECUTE $migration089$
-- 1. Services in bands.
CREATE FUNCTION public.resource_band_rows()
RETURNS TABLE(service_id uuid, org_name text, service_name text, description text, eligibility text,
 area_id text, area_label text, geo_scope text, state text, county text, counties text[], city text,
 address text, zip text, phone text, hours text, website text, source_url text, last_checked date,
 fees text, what_to_bring text, limits text, expires_on date, verification_tier text,
 tier_confidence text, corroboration_points integer, version text, band text, band_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
BEGIN ATOMIC
 WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d),
 a AS (
  SELECT p.*, 'A'::text AS band, 'We checked the page and it passed review.'::text AS band_reason
  FROM public.resource_publication_rows() p
 ),
 cand AS (
  SELECT s.id AS service_id, o.name AS org_name, s.service_name, s.description, s.eligibility, s.area_id, ar.label AS area_label,
         s.geo_scope, s.state, s.county, s.counties, s.city, s.address, s.zip, s.phone, s.hours,
         CASE WHEN o.website IS NOT NULL AND public.resource_host(c.source_url) = public.resource_host(o.website) THEN o.website END AS website,
         c.source_url, c.observed_on AS last_checked, s.fees, s.what_to_bring, s.limits, c.expires_on,
         c.confidence, c.verify_method, c.review_result, c.review_tier, c.human_approved_by, t.d AS today
  FROM public.resource_service s
  JOIN public.resource_org o ON o.id = s.org_id AND o.status = 'active'
  JOIN public.resource_area ar ON ar.area_id = s.area_id
  JOIN LATERAL (
    SELECT k.* FROM public.resource_check k
    WHERE k.service_id = s.id AND k.status = 'live'
    ORDER BY k.observed_on DESC, k.created_at DESC LIMIT 1
  ) c ON true
  CROSS JOIN today t
  WHERE s.status IN ('active','paused') AND s.adult_facing
    AND NOT EXISTS (SELECT 1 FROM a WHERE a.service_id = s.id)
    AND c.review_result IS DISTINCT FROM 'FAIL'
    AND c.fields_hash = public.resource_fields_hash(s, o.name, o.website)
    AND c.expires_on > t.d - 90
 ),
 bc AS (
  SELECT cd.service_id, cd.org_name, cd.service_name, cd.description, cd.eligibility, cd.area_id, cd.area_label,
         cd.geo_scope, cd.state, cd.county, cd.counties, cd.city, cd.address, cd.zip, cd.phone, cd.hours, cd.website,
         cd.source_url, cd.last_checked, cd.fees, cd.what_to_bring, cd.limits, cd.expires_on,
         coalesce(tv.tier, 'R0') AS verification_tier, NULL::text AS tier_confidence, 0 AS corroboration_points,
         CASE WHEN cd.verify_method = 'dataset' OR cd.confidence = 'low' OR cd.expires_on <= cd.today THEN 'C' ELSE 'B' END AS band,
         CASE WHEN cd.verify_method = 'dataset' THEN 'Found in a government dataset. We have not checked the page.'
              WHEN cd.confidence = 'low' THEN 'Our check of the page was low confidence.'
              WHEN cd.expires_on <= cd.today THEN 'Our last check has lapsed and is due again.'
              WHEN cd.review_tier = 'T1' AND cd.review_result = 'PASS' AND cd.human_approved_by IS NULL THEN 'Legal, ID or government content waiting for a named approval.'
              WHEN cd.review_result = 'PARTIAL' THEN 'The page supported part of this listing.'
              ELSE 'Listed from the page. No fact check yet.' END AS band_reason
  FROM cand cd
  LEFT JOIN public.resource_service_tier_v tv ON tv.service_id = cd.service_id
 )
 SELECT a.service_id, a.org_name, a.service_name, a.description, a.eligibility, a.area_id, a.area_label, a.geo_scope, a.state, a.county,
        a.counties, a.city, a.address, a.zip, a.phone, a.hours, a.website, a.source_url, a.last_checked, a.fees, a.what_to_bring, a.limits,
        a.expires_on, a.verification_tier, a.tier_confidence, a.corroboration_points, a.version, a.band, a.band_reason
 FROM a
 UNION ALL
 SELECT bc.service_id, bc.org_name, bc.service_name, bc.description, bc.eligibility, bc.area_id, bc.area_label, bc.geo_scope, bc.state, bc.county,
        bc.counties, bc.city, bc.address, bc.zip, bc.phone, bc.hours, bc.website, bc.source_url, bc.last_checked, bc.fees, bc.what_to_bring, bc.limits,
        bc.expires_on, bc.verification_tier, bc.tier_confidence, bc.corroboration_points,
        md5(row(bc.service_id, bc.org_name, bc.service_name, bc.description, bc.eligibility, bc.area_id, bc.geo_scope, bc.state, bc.county, bc.counties,
                bc.city, bc.address, bc.zip, bc.phone, bc.hours, bc.website, bc.source_url, bc.last_checked, bc.fees, bc.what_to_bring, bc.limits,
                bc.expires_on, bc.verification_tier, bc.band)::text),
        bc.band, bc.band_reason
 FROM bc;
END;
CREATE VIEW resource_band_publication_v WITH (security_barrier = true) AS SELECT * FROM public.resource_band_rows();

-- 2. Chains in bands.
CREATE FUNCTION public.resource_chain_band_rows()
RETURNS TABLE(chain_key text, state text, goal text, unlocks text[], verified_on date, expires_on date,
 n integer, action text, agency text, requires text[], cost text, wait_time text, where_how text, url text,
 phone text, no_docs_fallback text, fee_waiver text, source_url text, step_verified_on date, version text,
 band text, band_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
BEGIN ATOMIC
 WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d),
 a AS (
  SELECT p.*, 'A'::text AS band, 'Approved by a person. Every step was fact-checked.'::text AS band_reason
  FROM public.resource_chain_publication_rows() p
 ),
 own AS (
  SELECT ch.id, ch.chain_key, ch.state, ch.goal, ch.unlocks, ch.observed_on, ch.expires_on
  FROM public.resource_chain ch CROSS JOIN today t
  WHERE ch.status = 'live'
    AND ch.expires_on > t.d
    AND ch.confidence IN ('high','medium')
    AND ch.use_status <> 'usable_with_stated_limits'
    AND ch.human_approved_by IS NULL
    AND NOT EXISTS (SELECT 1 FROM a WHERE a.chain_key = ch.chain_key)
    AND EXISTS (SELECT 1 FROM public.resource_chain_step s0 WHERE s0.chain_id = ch.id)
    AND NOT EXISTS (SELECT 1 FROM public.resource_chain_step s1 WHERE s1.chain_id = ch.id AND s1.law_conflict IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.resource_chain_step s2 WHERE s2.chain_id = ch.id AND s2.observed_on + ch.ttl_days <= t.d)
 )
 SELECT a.chain_key, a.state, a.goal, a.unlocks, a.verified_on, a.expires_on, a.n, a.action, a.agency, a.requires, a.cost, a.wait_time,
        a.where_how, a.url, a.phone, a.no_docs_fallback, a.fee_waiver, a.source_url, a.step_verified_on, a.version, a.band, a.band_reason
 FROM a
 UNION ALL
 SELECT o.chain_key, o.state, o.goal, o.unlocks, o.observed_on, o.expires_on, st.n, st.action, st.agency, st.requires, st.cost, st.wait_time,
        st.where_how, st.url, st.phone, st.no_docs_fallback, st.fee_waiver, st.source_url, st.observed_on,
        md5(row(o.chain_key, o.state, o.goal, o.unlocks, o.observed_on, o.expires_on, st.n, st.action, st.agency, st.requires, st.cost, st.wait_time,
                st.where_how, st.url, st.phone, st.no_docs_fallback, st.fee_waiver, st.source_url, st.observed_on, 'B')::text),
        'B'::text, 'Steps found on official pages. Not yet approved by a person.'::text
 FROM own o JOIN public.resource_chain_step st ON st.chain_id = o.id;
END;
CREATE VIEW resource_chain_band_publication_v WITH (security_barrier = true) AS SELECT * FROM public.resource_chain_band_rows();

-- 3. Privileges: read-only for the app, nothing for PUBLIC, tier view still owner-only.
REVOKE ALL ON resource_band_publication_v, resource_chain_band_publication_v FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resource_band_rows(), public.resource_chain_band_rows() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
  REVOKE ALL ON resource_band_publication_v, resource_chain_band_publication_v FROM smr_app;
  GRANT SELECT ON resource_band_publication_v, resource_chain_band_publication_v TO smr_app;
  GRANT EXECUTE ON FUNCTION public.resource_band_rows(), public.resource_chain_band_rows() TO smr_app;
  REVOKE ALL ON resource_service_tier_v FROM smr_app;
 END IF;
END $$;
$migration089$;

  -- After: shape and privileges.
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_band_rows()'::regprocedure AND m = 't';
  IF n <> 29 THEN
    RAISE EXCEPTION '089 after: resource_band_rows() has % output columns, expected 29', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_chain_band_rows()'::regprocedure AND m = 't';
  IF n <> 22 THEN
    RAISE EXCEPTION '089 after: resource_chain_band_rows() has % output columns, expected 22', n;
  END IF;
  -- Band A is the A-only publication, row for row.
  IF (SELECT count(*) FROM resource_band_publication_v WHERE band = 'A') <> (SELECT count(*) FROM resource_publication_v) THEN
    RAISE EXCEPTION '089 after: band A row count differs from resource_publication_v';
  END IF;
  IF EXISTS (SELECT 1 FROM resource_band_publication_v WHERE band NOT IN ('A','B','C')) THEN
    RAISE EXCEPTION '089 after: a service row carries a band outside A, B, C';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF NOT has_table_privilege('smr_app', 'public.resource_band_publication_v', 'SELECT') THEN
      RAISE EXCEPTION '089 after: smr_app cannot read resource_band_publication_v';
    END IF;
    IF has_table_privilege('smr_app', 'public.resource_band_publication_v', 'INSERT')
       OR has_table_privilege('smr_app', 'public.resource_band_publication_v', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.resource_band_publication_v', 'DELETE') THEN
      RAISE EXCEPTION '089 after: smr_app holds a write privilege on resource_band_publication_v';
    END IF;
    IF NOT has_table_privilege('smr_app', 'public.resource_chain_band_publication_v', 'SELECT') THEN
      RAISE EXCEPTION '089 after: smr_app cannot read resource_chain_band_publication_v';
    END IF;
    IF has_table_privilege('smr_app', 'public.resource_service_tier_v', 'SELECT') THEN
      RAISE EXCEPTION '089 after: smr_app can read resource_service_tier_v';
    END IF;
    IF has_table_privilege('smr_app', 'public.resource_check', 'SELECT') OR has_table_privilege('smr_app', 'public.resource_contact', 'SELECT') THEN
      RAISE EXCEPTION '089 after: smr_app can read a resource base table';
    END IF;
  END IF;
  INSERT INTO _migrations (filename) VALUES ('089_resource_public_bands.sql');
  RAISE NOTICE 'Applied: 089_resource_public_bands.sql';
END
$release089$;
COMMIT;
