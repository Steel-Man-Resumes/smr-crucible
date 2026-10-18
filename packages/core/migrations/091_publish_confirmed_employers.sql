-- 091_publish_confirmed_employers.sql
-- Restores Troy's 2026-10-12 ruling on the public site ("solar hollar go live": a listing whose
-- proof is the employer's own email, quoted with permission, is published). 084's
-- employer_publication_rows() required every published place to carry a yes evidence row WITH a
-- source URL. A Tier 2 or Tier 3 place (a person confirmed it with us, or we work with them)
-- often has no URL: the proof is the confirmation itself. Since the site switched to publication
-- reads on 2026-10-16, eight marked Tier 2 places (Bolder Industries IN and MO, The Doggy Port,
-- Heliene x2, Metropolitan Community College, Lost Borough Ice Cream, City of Tulsa) and hidden
-- Solar Holler dropped off their state pages while their marks stayed live in the job search.
--
-- CHANGE (replace in place, same 17 columns and types, so 090's employer_band_rows() keeps its
-- dependency): the evidence join accepts a yes row without a source URL when the place's
-- relationship tier is 2 or 3. Everything else in 084 is unchanged. Privileges are kept by
-- CREATE OR REPLACE. Solar Holler's listing_visibility is a separate data change (neon-run).
--
-- ROLLBACK: re-run the CREATE FUNCTION public.employer_publication_rows() block of
-- 084_directory_publication.sql as CREATE OR REPLACE, then
--   DELETE FROM _migrations WHERE filename = '091_publish_confirmed_employers.sql';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
DO $release091$
DECLARE n int; before_n int; after_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '091 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE filename = '090_employer_public_bands.sql') THEN
    RAISE EXCEPTION '091 needs migration 090 recorded in _migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM _migrations WHERE filename = '091_publish_confirmed_employers.sql') THEN
    RAISE NOTICE 'Already recorded, skipped: 091_publish_confirmed_employers.sql';
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.employer_publication_rows()'::regprocedure AND m = 't';
  IF n <> 17 THEN
    RAISE EXCEPTION '091 preflight: employer_publication_rows() has % output columns, expected 17; stop', n;
  END IF;
  SELECT count(*) INTO before_n FROM employer_publication_v;

  EXECUTE $migration091$
CREATE OR REPLACE FUNCTION public.employer_publication_rows()
RETURNS TABLE(id uuid, name text, industry text, state text, city text, location text,
 apply_url text, role_types text, evidence text, caveats text, checked_at date,
 expires_at date, source_url text, relationship_tier text, scope text, standing text, version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT p.place_id, p.canonical_name, p.industry, p.state, p.city,
 concat_ws(', ',coalesce(p.city,p.county),p.state), coalesce(p.careers_url,p.website),
 ev.role_title, ev.excerpt, ev.limitations, ev.observed_on, ev.expires_on, ev.source_url,
 CASE WHEN t.tier IN (1,2,3) THEN 'T'||t.tier::text END, p.place_kind, p.standing,
 md5(concat_ws('|',p.place_id::text,p.canonical_name,p.industry,p.state,p.city,p.county,
 p.careers_url,p.website,p.standing,t.tier::text,ev.id::text,ev.observed_on::text,
 ev.expires_on::text,ev.source_url,ev.excerpt,ev.limitations,ev.role_title))
 FROM public.directory_public_v p
 LEFT JOIN public.directory_tier_v t ON t.place_id=p.place_id
 JOIN LATERAL (
  SELECT e.* FROM public.directory_public_evidence_v e
  WHERE e.org_id=p.org_id AND EXISTS (SELECT 1 FROM public.directory_place_evidence pe WHERE pe.target_place_id=p.place_id AND pe.id=e.id)
    AND e.polarity='yes' AND e.expires_on > (now() AT TIME ZONE 'UTC')::date
    -- 091: a confirmed place (Tier 2 or 3) may rest on a yes row with no URL: the confirmation is the proof.
    AND (e.source_url IS NOT NULL OR t.tier IN (2,3)) AND e.source_kind <> 'casework_aggregate'
  ORDER BY (e.source_url IS NOT NULL) DESC, e.observed_on DESC,e.id LIMIT 1
 ) ev ON true
 WHERE p.earns_mark OR p.standing='says_yes_for_roles';
END;
$migration091$;

  SELECT count(*) INTO n FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargmodes) m
   WHERE p.oid = 'public.employer_publication_rows()'::regprocedure AND m = 't';
  IF n <> 17 THEN
    RAISE EXCEPTION '091 after: employer_publication_rows() has % output columns, expected 17', n;
  END IF;
  SELECT count(*) INTO after_n FROM employer_publication_v;
  IF after_n < before_n THEN
    RAISE EXCEPTION '091 after: the publication shrank from % to %; a widening must never lose a row', before_n, after_n;
  END IF;
  IF EXISTS (SELECT 1 FROM employer_publication_v e WHERE e.source_url IS NULL AND e.relationship_tier NOT IN ('T2','T3')) THEN
    RAISE EXCEPTION '091 after: a row without a source URL is published below Tier 2';
  END IF;
  IF (SELECT count(*) FROM employer_band_publication_v WHERE band = 'A') <> after_n THEN
    RAISE EXCEPTION '091 after: band A no longer equals the publication';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF NOT has_function_privilege('smr_app', 'public.employer_publication_rows()', 'EXECUTE')
       OR NOT has_table_privilege('smr_app', 'public.employer_publication_v', 'SELECT') THEN
      RAISE EXCEPTION '091 after: smr_app lost its read on the employer publication';
    END IF;
  END IF;
  INSERT INTO _migrations (filename) VALUES ('091_publish_confirmed_employers.sql');
  RAISE NOTICE 'Applied: 091_publish_confirmed_employers.sql (publication % -> % rows)', before_n, after_n;
END
$release091$;
COMMIT;
