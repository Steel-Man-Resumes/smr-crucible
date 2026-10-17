-- 088_resource_tier_confidence.sql  (drafted 2026-10-17, lane L12; Troy's ruling 2026-10-17:
-- "either high tier one or low tier two; multiple diff points increases confidence")
--
-- WHAT CHANGES
--   1. resource_directory_publisher: an owner-written allowlist of CURATED directory hosts (reentry
--      coalition guides, agency guides, 211, libraries). Insert-only, no app grant. Seeded with the
--      Anchorage Reentry Coalition guide. Scraped aggregators are never inserted here.
--   2. resource_service_tier_v (073 v2) is replaced, keeping 073's logic for every non-directory row and
--      adding ONE lift: a corroboration with source_type 'directory' whose host is on the allowlist now
--      counts toward R2, flagged weak. Two columns are appended:
--        tier_confidence     'high' when at least one NON-directory independent, non-weak, unexpired,
--                            non-void corroboration from a different host exists for the service's live
--                            check; 'low' when the service reads R2 only through curated directory rows;
--                            NULL for R0, R1, R3 and R4 (the org's own confirmation or a working contact
--                            is not graded by second sources).
--        corroboration_points count of DISTINCT resource_host among the corroborations that count
--                            (same filters), reported for R2, R3 and R4; 0 for R0 and R1. The live check's
--                            own host is not a point. "Multiple diff points increases confidence."
--      Aggregator hosts never lift: the allowlist join is the gate, not source_type. A dataset row is
--      lifted only by the org's own site, as in 073; directories never lift a dataset row.
--      Column order, names and types of the six 073 columns are unchanged (CREATE OR REPLACE VIEW).
--      resource_chain_tier_v is untouched.
--   3. resource_publication_rows() (084) is recreated with tier_confidence and corroboration_points in
--      RETURNS TABLE and in the version md5, so every client sees a new version string. PostgreSQL does not
--      allow CREATE OR REPLACE to change a return type, so resource_publication_v is dropped and recreated
--      with it and the 084 grants are re-issued exactly (SELECT on the view and EXECUTE on the function to
--      smr_app; nothing to PUBLIC). resource_public_v and resource_chain_public_v are not touched, so the
--      md5 baselines in tooling/neon-prod/resource-verify-readonly.mjs do not move.
--
-- GUARDS. One BEGIN/COMMIT. Refuses unless run by the owner (BYPASSRLS or superuser), 073 and 084 are in
-- _migrations, the 084 function still has 25 output columns and the 073 view six. If 088 is already in
-- _migrations the body is skipped after a shape check (a NOTICE, no error, nothing changed). After the
-- body: the view has the two new columns, the function has 27, the seed row is present, and smr_app can
-- read neither resource_service_tier_v nor resource_directory_publisher. The ledger row is written here;
-- packages/core/src/migrate.ts tolerates that (ON CONFLICT DO NOTHING).
--
-- ROLLBACK (owner, by hand, in one transaction):
--   DROP VIEW resource_publication_v; DROP FUNCTION public.resource_publication_rows();
--   re-create the 084 function and view from 084_directory_publication.sql and re-grant as there;
--   re-run the CREATE VIEW resource_service_tier_v block of 073 as CREATE OR REPLACE is refused when
--   columns are dropped: DROP VIEW resource_service_tier_v; then the 073 CREATE VIEW and its grants;
--   DROP TABLE resource_directory_publisher;
--   DELETE FROM _migrations WHERE filename = '088_resource_tier_confidence.sql';
--   and remove resource_directory_publisher from scripts/lib/restricted-grants.mjs.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $release088$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '088 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = '073_resource_verification_tiers.sql') THEN
    RAISE EXCEPTION '088 needs migration 073 recorded in _migrations first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = '084_directory_publication.sql') THEN
    RAISE EXCEPTION '088 needs migration 084 recorded in _migrations first';
  END IF;

  IF EXISTS (SELECT 1 FROM _migrations WHERE filename = '088_resource_tier_confidence.sql') THEN
    IF to_regclass('public.resource_directory_publisher') IS NULL THEN
      RAISE EXCEPTION '088 is recorded but resource_directory_publisher is missing; inspect without dropping data';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'resource_service_tier_v'
          AND column_name IN ('tier_confidence','corroboration_points')) <> 2 THEN
      RAISE EXCEPTION '088 is recorded but resource_service_tier_v lacks its columns; inspect without dropping data';
    END IF;
    RAISE NOTICE 'Already recorded, skipped: 088_resource_tier_confidence.sql';
    RETURN;
  END IF;

  -- Preflight: the objects 088 replaces are in their 073 / 084 shape.
  IF to_regclass('public.resource_directory_publisher') IS NOT NULL THEN
    RAISE EXCEPTION 'resource_directory_publisher exists but 088 is not recorded; inspect before running';
  END IF;
  IF to_regprocedure('public.resource_publication_rows()') IS NULL OR to_regclass('public.resource_publication_v') IS NULL THEN
    RAISE EXCEPTION '084 objects missing (resource_publication_rows or resource_publication_v)';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_publication_rows()'::regprocedure AND m = 't';
  IF n <> 25 THEN
    RAISE EXCEPTION '088 preflight: resource_publication_rows() has % output columns, expected 25 (084 shape); stop', n;
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'resource_service_tier_v';
  IF n <> 6 THEN
    RAISE EXCEPTION '088 preflight: resource_service_tier_v has % columns, expected 6 (073 shape); stop', n;
  END IF;

  EXECUTE $migration088$
-- 1. Curated directory publishers. Owner writes only; insert-only like the 073 tables.
CREATE TABLE resource_directory_publisher (
  host     text PRIMARY KEY CHECK (host = public.resource_host('https://' || host) AND length(host) BETWEEN 3 AND 253),
  kind     text NOT NULL CHECK (kind IN ('reentry_coalition','agency_guide','211','library')),
  added_by text NOT NULL CHECK (length(btrim(added_by)) >= 2),
  added_on date NOT NULL DEFAULT current_date,
  note     text CHECK (note IS NULL OR length(note) <= 500)
);
CREATE TRIGGER resource_directory_publisher_fixed BEFORE UPDATE OR DELETE ON resource_directory_publisher
  FOR EACH ROW EXECUTE FUNCTION public.resource_no_change();
CREATE TRIGGER resource_directory_publisher_no_truncate BEFORE TRUNCATE ON resource_directory_publisher
  FOR EACH STATEMENT EXECUTE FUNCTION public.resource_no_delete();
ALTER TABLE resource_directory_publisher ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_directory_publisher FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_directory_publisher_admin_select ON resource_directory_publisher FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
REVOKE ALL ON resource_directory_publisher FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON resource_directory_publisher FROM smr_app;
  END IF;
END $$;
INSERT INTO resource_directory_publisher (host, kind, added_by, note) VALUES
  ('anchoragereentry.glide.page', 'reentry_coalition', 'CC boss 2026-10-17', 'Anchorage Reentry Coalition resource guide');

-- 2. Service tier, 073 v2 logic plus the curated-directory lift and two appended columns.
CREATE OR REPLACE VIEW resource_service_tier_v WITH (security_barrier = true) AS
WITH base AS (
  SELECT s.id AS service_id, s.org_id, s.state, s.county, s.area_id, s.status AS service_status,
         c.id AS check_id, c.source_url AS check_url, c.verify_method, c.source_type,
         coalesce(c.confidence IN ('high','medium')
           AND c.expires_on > (now() AT TIME ZONE 'UTC')::date
           AND c.fields_hash = public.resource_fields_hash(s, o.name, o.website)
           AND o.status = 'active' AND s.status = 'active' AND s.adult_facing, false) AS check_fresh,
         coalesce(c.review_result = 'PASS'
           AND (c.review_tier IS DISTINCT FROM 'T1' OR c.human_approved_by IS NOT NULL), false) AS review_pass
  FROM resource_service s
  JOIN resource_org o ON o.id = s.org_id
  LEFT JOIN LATERAL (
    SELECT k.* FROM resource_check k WHERE k.service_id = s.id AND k.status = 'live'
    ORDER BY k.observed_on DESC, k.created_at DESC LIMIT 1
  ) c ON true
),
corr AS (
  -- Rows that count toward R2 for the service's live check. n_strong = 073's count (non-directory);
  -- n also includes curated directory rows (088); points = distinct hosts among everything that counts.
  SELECT b.service_id,
         count(*) AS n,
         count(*) FILTER (WHERE x.source_type <> 'directory') AS n_strong,
         count(DISTINCT public.resource_host(x.source_url))::int AS points
  FROM base b
  JOIN resource_corroboration x ON x.service_id = b.service_id AND x.check_id = b.check_id
  WHERE x.independent AND NOT x.weak
    AND x.expires_on > (now() AT TIME ZONE 'UTC')::date
    AND public.resource_host(x.source_url) IS DISTINCT FROM public.resource_host(b.check_url)
    AND NOT EXISTS (SELECT 1 FROM resource_corroboration_void v WHERE v.corroboration_id = x.id)
    AND (
      -- 073, unchanged: a non-directory second source; a dataset row only through the org's own site.
      (x.source_type <> 'directory' AND (b.verify_method <> 'dataset' OR x.source_type = 'official_site'))
      -- 088 (Troy 2026-10-17): a curated directory on the allowlist is a weak second place. Never for a
      -- dataset row, and never for a host that is not on the allowlist (aggregators stay out).
      OR (x.source_type = 'directory' AND b.verify_method <> 'dataset'
          AND EXISTS (SELECT 1 FROM resource_directory_publisher d WHERE d.host = public.resource_host(x.source_url)))
    )
  GROUP BY b.service_id
),
conf AS (
  SELECT b.service_id, count(*) AS n FROM base b
  WHERE b.verify_method = 'org_reply'
     OR EXISTS (SELECT 1 FROM resource_relationship_event e
                  JOIN resource_relationship r ON r.id = e.relationship_id AND r.status = 'active'
                  JOIN resource_service s2 ON s2.id = e.service_id AND s2.org_id = r.org_id
                 WHERE e.kind = 'confirmed' AND e.check_id = b.check_id
                   AND e.occurred_on + 180 >= (now() AT TIME ZONE 'UTC')::date
                   AND NOT EXISTS (SELECT 1 FROM resource_relationship_event_void v WHERE v.event_id = e.id))
  GROUP BY b.service_id
),
work AS (
  SELECT DISTINCT s.id AS service_id
  FROM resource_relationship r
  JOIN resource_service s ON s.org_id = r.org_id AND (r.service_id IS NULL OR r.service_id = s.id)
  WHERE r.status = 'active'
    AND EXISTS (SELECT 1 FROM resource_relationship_event e
                 WHERE e.relationship_id = r.id AND e.kind = 'working'
                   AND e.occurred_on + r.cadence_days + 14 >= (now() AT TIME ZONE 'UTC')::date
                   AND NOT EXISTS (SELECT 1 FROM resource_relationship_event_void v WHERE v.event_id = e.id))
),
graded AS (
  SELECT b.service_id, b.state, b.county, b.area_id,
    CASE
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND w.service_id IS NOT NULL AND cf.n > 0 THEN 'R4'
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND cf.n > 0 THEN 'R3'
      WHEN b.check_fresh AND co.n > 0 AND (b.verify_method = 'dataset' OR b.review_pass) THEN 'R2'
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' THEN 'R1'
      ELSE 'R0' END AS tier,
    CASE
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND w.service_id IS NOT NULL AND cf.n > 0 THEN 'confirmed listing plus an active relationship with a working contact inside its cadence'
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' AND cf.n > 0 THEN 'the org confirmed the listing'
      WHEN b.check_fresh AND co.n > 0 AND (b.verify_method = 'dataset' OR b.review_pass) THEN
        CASE WHEN co.n_strong > 0 THEN 'independent corroboration from a different host'
             ELSE 'listed in a curated local guide only (weak second place, 088)' END
      WHEN b.check_fresh AND b.review_pass AND b.verify_method <> 'dataset' THEN 'one source, fact-checked'
      ELSE 'held: no clean live check, or dataset only' END AS tier_basis,
    coalesce(co.n_strong, 0) AS n_strong,
    coalesce(co.points, 0) AS points
  FROM base b
  LEFT JOIN corr co ON co.service_id = b.service_id
  LEFT JOIN conf cf ON cf.service_id = b.service_id
  LEFT JOIN work w  ON w.service_id = b.service_id
)
SELECT g.service_id, g.state, g.county, g.area_id, g.tier, g.tier_basis,
  CASE WHEN g.tier = 'R2' THEN CASE WHEN g.n_strong > 0 THEN 'high' ELSE 'low' END END AS tier_confidence,
  CASE WHEN g.tier IN ('R2','R3','R4') THEN g.points ELSE 0 END AS corroboration_points
FROM graded g;

-- 3. Publication (084) with the two columns. Return type changes need drop and create.
DROP VIEW resource_publication_v;
DROP FUNCTION public.resource_publication_rows();
CREATE FUNCTION public.resource_publication_rows()
RETURNS TABLE(service_id uuid, org_name text, service_name text, description text, eligibility text,
 area_id text, area_label text, geo_scope text, state text, county text, counties text[],city text,
 address text,zip text,phone text,hours text,website text,source_url text,last_checked date,
 fees text,what_to_bring text,limits text,expires_on date,verification_tier text,
 tier_confidence text,corroboration_points integer,version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT p.service_id,p.org_name,p.service_name,p.description,p.eligibility,p.area_id,a.label,
 p.geo_scope,p.state,p.county,p.counties,p.city,p.address,p.zip,p.phone,p.hours,p.website,
 p.source_url,p.verified_on,p.fees,p.what_to_bring,p.limits,p.expires_on,t.tier,
 t.tier_confidence,t.corroboration_points,
 md5(row(p.service_id,p.org_name,p.service_name,p.description,p.eligibility,p.area_id,
 p.geo_scope,p.state,p.county,p.counties,p.city,p.address,p.zip,p.phone,p.hours,p.website,
 p.source_url,p.verified_on,p.fees,p.what_to_bring,p.limits,p.expires_on,t.tier,
 t.tier_confidence,t.corroboration_points)::text)
 FROM public.resource_public_v p JOIN public.resource_area a ON a.area_id=p.area_id
 JOIN public.resource_service_tier_v t ON t.service_id=p.service_id
 WHERE p.expires_on > (now() AT TIME ZONE 'UTC')::date;
END;
CREATE VIEW resource_publication_v WITH (security_barrier=true) AS SELECT * FROM public.resource_publication_rows();
REVOKE ALL ON resource_publication_v FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resource_publication_rows() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='smr_app') THEN
  REVOKE ALL ON resource_publication_v FROM smr_app;
  GRANT SELECT ON resource_publication_v TO smr_app;
  GRANT EXECUTE ON FUNCTION public.resource_publication_rows() TO smr_app;
  -- 073's stance restated for the replaced view: the app holds nothing on the tier view.
  REVOKE ALL ON resource_service_tier_v FROM smr_app;
 END IF;
END $$;
REVOKE ALL ON resource_service_tier_v FROM PUBLIC;
$migration088$;

  -- After: shape and privileges.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'resource_service_tier_v'
        AND column_name IN ('tier_confidence','corroboration_points')) <> 2 THEN
    RAISE EXCEPTION '088 after: resource_service_tier_v lacks tier_confidence / corroboration_points';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.resource_publication_rows()'::regprocedure AND m = 't';
  IF n <> 27 THEN
    RAISE EXCEPTION '088 after: resource_publication_rows() has % output columns, expected 27', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM resource_directory_publisher WHERE host = 'anchoragereentry.glide.page' AND kind = 'reentry_coalition') THEN
    RAISE EXCEPTION '088 after: allowlist seed row missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.resource_service_tier_v', 'SELECT') THEN
      RAISE EXCEPTION '088 after: smr_app can read resource_service_tier_v';
    END IF;
    IF has_table_privilege('smr_app', 'public.resource_directory_publisher', 'SELECT') THEN
      RAISE EXCEPTION '088 after: smr_app can read resource_directory_publisher';
    END IF;
    IF NOT has_table_privilege('smr_app', 'public.resource_publication_v', 'SELECT') THEN
      RAISE EXCEPTION '088 after: smr_app lost SELECT on resource_publication_v';
    END IF;
    IF NOT has_function_privilege('smr_app', 'public.resource_publication_rows()', 'EXECUTE') THEN
      RAISE EXCEPTION '088 after: smr_app lost EXECUTE on resource_publication_rows()';
    END IF;
  END IF;
  INSERT INTO _migrations (filename) VALUES ('088_resource_tier_confidence.sql');
  RAISE NOTICE 'Applied: 088_resource_tier_confidence.sql';
END
$release088$;
COMMIT;
