-- 090_employer_public_bands.sql
-- The employer ledger in two bands (Troy 2026-10-18, decision 5 of the resource-map plan):
--   A  the mark. Exactly 084's employer_publication_rows(): the place earns the mark, or a live
--      posting says yes for roles. Unchanged.
--   B  "Reported". A public place with a non-negative standing, Likely or Certain confidence and a
--      live, unexpired, linked 'yes' evidence row, that does NOT earn the mark: reported by a third
--      party, two public reports not confirmed with the employer, a company-wide policy, or the
--      employer's own words that do not yet meet the mark's rule.
--   never  mixed, says_no, reported_turned_down, not_an_employer, lead; Guessing confidence (069:
--      guessing never marks, and here never shows); hidden or case-manager-only listings; casework
--      aggregates; evidence with no source URL.
-- The job-search MARK (directory_mark_v) is untouched: band B never marks a listing.
--
-- ADD ONLY: one definer function and one security-barrier view over existing views; no table, view,
-- function or row is changed. App role gets SELECT on the view and EXECUTE on the function only.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS employer_band_publication_v;
--   DROP FUNCTION IF EXISTS public.employer_band_rows();
--   DELETE FROM _migrations WHERE filename = '090_employer_public_bands.sql';
--   and remove employer_band_publication_v from scripts/lib/restricted-grants.mjs.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $release090$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '090 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = '089_resource_public_bands.sql') THEN
    RAISE EXCEPTION '090 needs migration 089 recorded in _migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM _migrations WHERE filename = '090_employer_public_bands.sql') THEN
    IF to_regclass('public.employer_band_publication_v') IS NULL THEN
      RAISE EXCEPTION '090 is recorded but employer_band_publication_v is missing; inspect without dropping data';
    END IF;
    RAISE NOTICE 'Already recorded, skipped: 090_employer_public_bands.sql';
    RETURN;
  END IF;
  IF to_regclass('public.employer_band_publication_v') IS NOT NULL OR to_regprocedure('public.employer_band_rows()') IS NOT NULL THEN
    RAISE EXCEPTION '090 objects exist but 090 is not recorded; inspect before running';
  END IF;
  IF to_regprocedure('public.employer_publication_rows()') IS NULL OR to_regclass('public.directory_public_v') IS NULL
     OR to_regclass('public.directory_public_evidence_v') IS NULL OR to_regclass('public.directory_tier_v') IS NULL THEN
    RAISE EXCEPTION '090 preflight: a 061/071/084 object is missing; stop';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.employer_publication_rows()'::regprocedure AND m = 't';
  IF n <> 17 THEN
    RAISE EXCEPTION '090 preflight: employer_publication_rows() has % output columns, expected 17 (084 shape); stop', n;
  END IF;

  EXECUTE $migration090$
CREATE FUNCTION public.employer_band_rows()
RETURNS TABLE(id uuid, name text, industry text, state text, city text, location text,
 apply_url text, role_types text, evidence text, caveats text, checked_at date,
 expires_at date, source_url text, relationship_tier text, scope text, standing text, version text,
 band text, band_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
BEGIN ATOMIC
 WITH a AS (
  SELECT p.*, 'A'::text AS band, 'Hires people with records: dated evidence that meets our mark.'::text AS band_reason
  FROM public.employer_publication_rows() p
 ),
 b AS (
  SELECT p.place_id, p.canonical_name, p.industry, p.state, p.city,
         concat_ws(', ', coalesce(p.city, p.county), p.state) AS location,
         coalesce(p.careers_url, p.website) AS apply_url,
         ev.role_title, ev.excerpt, ev.limitations, ev.observed_on, ev.expires_on, ev.source_url,
         CASE WHEN t.tier IN (1,2,3) THEN 'T' || t.tier::text END AS relationship_tier,
         p.place_kind, p.standing,
         CASE p.standing
           WHEN 'reported_here'     THEN 'Reported by someone else, not in the employer''s own words.'
           WHEN 'corroborated_here' THEN 'Two public reports. Not confirmed with the employer.'
           WHEN 'company_policy'    THEN 'A company-wide policy, not this location''s own words.'
           WHEN 'says_yes_here'     THEN 'The employer said it, but the evidence does not yet meet our mark.'
           ELSE 'Public evidence below our mark.' END AS band_reason
  FROM public.directory_public_v p
  LEFT JOIN public.directory_tier_v t ON t.place_id = p.place_id
  JOIN LATERAL (
   SELECT e.* FROM public.directory_public_evidence_v e
   WHERE e.org_id = p.org_id
     AND EXISTS (SELECT 1 FROM public.directory_place_evidence pe WHERE pe.target_place_id = p.place_id AND pe.id = e.id)
     AND e.polarity = 'yes' AND e.expires_on > (now() AT TIME ZONE 'UTC')::date
     AND e.source_url IS NOT NULL AND e.source_kind <> 'casework_aggregate'
   ORDER BY e.observed_on DESC, e.id LIMIT 1
  ) ev ON true
  WHERE NOT p.earns_mark
    AND p.standing NOT IN ('mixed','says_no','reported_turned_down','not_an_employer','lead','says_yes_for_roles')
    AND p.confidence IN ('likely','certain')
    AND NOT EXISTS (SELECT 1 FROM a WHERE a.id = p.place_id)
 )
 SELECT a.id, a.name, a.industry, a.state, a.city, a.location, a.apply_url, a.role_types, a.evidence, a.caveats,
        a.checked_at, a.expires_at, a.source_url, a.relationship_tier, a.scope, a.standing, a.version, a.band, a.band_reason
 FROM a
 UNION ALL
 SELECT b.place_id, b.canonical_name, b.industry, b.state, b.city, b.location, b.apply_url, b.role_title, b.excerpt, b.limitations,
        b.observed_on, b.expires_on, b.source_url, b.relationship_tier, b.place_kind, b.standing,
        md5(concat_ws('|', b.place_id::text, b.canonical_name, b.industry, b.state, b.city, b.apply_url, b.standing,
                      b.observed_on::text, b.expires_on::text, b.source_url, b.excerpt, b.limitations, b.role_title, 'B')),
        'B'::text, b.band_reason
 FROM b;
END;
CREATE VIEW employer_band_publication_v WITH (security_barrier = true) AS SELECT * FROM public.employer_band_rows();
REVOKE ALL ON employer_band_publication_v FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employer_band_rows() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
  REVOKE ALL ON employer_band_publication_v FROM smr_app;
  GRANT SELECT ON employer_band_publication_v TO smr_app;
  GRANT EXECUTE ON FUNCTION public.employer_band_rows() TO smr_app;
 END IF;
END $$;
$migration090$;

  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.employer_band_rows()'::regprocedure AND m = 't';
  IF n <> 19 THEN
    RAISE EXCEPTION '090 after: employer_band_rows() has % output columns, expected 19', n;
  END IF;
  IF (SELECT count(*) FROM employer_band_publication_v WHERE band = 'A') <> (SELECT count(*) FROM employer_publication_v) THEN
    RAISE EXCEPTION '090 after: band A row count differs from employer_publication_v';
  END IF;
  IF EXISTS (SELECT 1 FROM employer_band_publication_v WHERE band NOT IN ('A','B')) THEN
    RAISE EXCEPTION '090 after: an employer row carries a band outside A, B';
  END IF;
  IF EXISTS (SELECT 1 FROM employer_band_publication_v b JOIN directory_public_v p ON p.place_id = b.id
             WHERE b.band = 'B' AND (p.earns_mark OR p.standing IN ('mixed','says_no','reported_turned_down','not_an_employer','lead'))) THEN
    RAISE EXCEPTION '090 after: band B carries a marked or negative place';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    -- Only what 090 creates is checked here: a fresh CI database holds blanket default privileges on
    -- older objects until rls-stage1 repairs them, and that is not this migration's to assert.
    IF NOT has_table_privilege('smr_app', 'public.employer_band_publication_v', 'SELECT') THEN
      RAISE EXCEPTION '090 after: smr_app cannot read employer_band_publication_v';
    END IF;
    IF has_table_privilege('smr_app', 'public.employer_band_publication_v', 'INSERT')
       OR has_table_privilege('smr_app', 'public.employer_band_publication_v', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.employer_band_publication_v', 'DELETE') THEN
      RAISE EXCEPTION '090 after: smr_app holds a write privilege on employer_band_publication_v';
    END IF;
  END IF;
  INSERT INTO _migrations (filename) VALUES ('090_employer_public_bands.sql');
  RAISE NOTICE 'Applied: 090_employer_public_bands.sql';
END
$release090$;
COMMIT;
