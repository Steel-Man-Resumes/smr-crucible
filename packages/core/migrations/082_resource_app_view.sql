-- 082_resource_app_view.sql
-- The one door from the app to the checked resource directory (Phase 5 lane R3,
-- Codex A4 and E "Need to service" / "Service quality").
--
-- WHAT THIS ADDS
--   resource_app_rows()  a SECURITY DEFINER read of resource_public_v (why: see
--                    the note above the function).
--   resource_app_v   a narrow, read-only list of services the support search may
--                    show: name, organization, area, reach (scope, state, county,
--                    counties, city), the public contact fields (address, ZIP,
--                    phone, hours, website), eligibility, the last-checked date
--                    and the source URL. Nothing else.
--
-- WHAT A ROW MEANS. It is a row of 072's resource_public_v, so every rule there
-- holds: the service and its org are active, the service is adult-facing, its
-- newest live check passed review (a T1 check also needs a named person's
-- approval), is not low confidence, is not a dataset-only check, still matches
-- the service's fields (hash), and has not expired. The expiry test is repeated
-- here so "fresh" is visible in this file too. Building on resource_public_v
-- rather than copying its filters keeps one definition of "may be shown".
--
-- WHAT IS LEFT OUT, ON PURPOSE. Check internals (confidence, method, quote,
-- reviewer, approver, hash, expiry date), fees, what-to-bring and limits text,
-- the stewardship tier, and every 073 tier or relationship fact. 073's tier
-- views stay owner-only with their grants revoked: exposing a tier is its own
-- later change. Contacts (resource_contact) are in no view at all.
--
-- WHO MAY SEE WHAT. The read runs with the owner's rights (definer function;
-- the view is not security_invoker) and the view is a security barrier, like
-- 072's views. The owner must have BYPASSRLS (guard below), or the forced RLS
-- on resource_area and the base tables would leave it silently empty. The app
-- role gets SELECT on this view and EXECUTE on resource_app_rows() only: no
-- grant on any resource_* table, no EXECUTE on any 072/073 function, and the
-- columns are a subset of resource_public_v, which 072 already granted.
-- scripts/lib/restricted-grants.mjs lists resource_app_v as ["SELECT"] so a
-- later blanket grant on a fresh database cannot widen it.
--
-- ADD ONLY AND IDEMPOTENT. Creates one function and one view (CREATE OR
-- REPLACE, same signature and columns), revokes then grants. Touches no table,
-- no existing view or function, no data. Re-running it changes nothing.
--
-- ROLLBACK (no data is lost; the support search falls back to its earlier list
-- when the view is missing):
--   DROP VIEW IF EXISTS resource_app_v;
--   DROP FUNCTION IF EXISTS public.resource_app_rows();
--   DELETE FROM _migrations WHERE filename = '082_resource_app_view.sql';
--   and remove resource_app_v from scripts/lib/restricted-grants.mjs.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'resource_app_v needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regclass('public.resource_public_v') IS NULL OR to_regclass('public.resource_area') IS NULL THEN
    RAISE EXCEPTION '082 needs migration 072 applied first';
  END IF;
END $$;

-- The rows, read with the owner's rights. A SECURITY DEFINER function, not a
-- plain view over resource_public_v, because PostgreSQL checks EXECUTE on a
-- function called inside a view against the CALLER: resource_public_v calls
-- public.resource_fields_hash, whose EXECUTE 072 revoked from PUBLIC, so the
-- app role gets "permission denied for function resource_fields_hash" from
-- resource_public_v itself, even with zero rows (found by this file's PGlite
-- proof, 2026-10-10). Here the whole read runs as the owner, so 072's rule
-- that the app holds no EXECUTE on its functions stays true. No arguments
-- (nothing to inject), a pinned search_path, STABLE, read-only.
CREATE OR REPLACE FUNCTION public.resource_app_rows()
RETURNS TABLE (
  service_id   uuid,
  org_name     text,
  service_name text,
  description  text,
  eligibility  text,
  area_id      text,
  area_label   text,
  geo_scope    text,
  state        text,
  county       text,
  counties     text[],
  city         text,
  address      text,
  zip          text,
  phone        text,
  hours        text,
  website      text,
  source_url   text,
  last_checked date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.service_id, p.org_name, p.service_name, p.description, p.eligibility,
         p.area_id, a.label, p.geo_scope, p.state, p.county, p.counties, p.city,
         p.address, p.zip, p.phone, p.hours, p.website, p.source_url, p.verified_on
  FROM public.resource_public_v p
  JOIN public.resource_area a ON a.area_id = p.area_id
  WHERE p.expires_on > (now() AT TIME ZONE 'UTC')::date
$$;

CREATE OR REPLACE VIEW resource_app_v WITH (security_barrier = true) AS
SELECT r.service_id, r.org_name, r.service_name, r.description, r.eligibility,
       r.area_id, r.area_label, r.geo_scope, r.state, r.county, r.counties, r.city,
       r.address, r.zip, r.phone, r.hours, r.website, r.source_url, r.last_checked
FROM public.resource_app_rows() r;

-- Grants: nobody but the owner, then the app role gets SELECT on the view and
-- EXECUTE on the one function the view calls (PostgreSQL checks it against the
-- caller). The function returns exactly the view's rows and columns, so the
-- EXECUTE adds no reach. No grant on any resource_* table or 072/073 function.
REVOKE ALL ON resource_app_v FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resource_app_rows() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON resource_app_v FROM smr_app;
    GRANT SELECT ON resource_app_v TO smr_app;
    GRANT EXECUTE ON FUNCTION public.resource_app_rows() TO smr_app;
  END IF;
END $$;
