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
-- REPLACE, same signature and columns), revokes then grants, and takes TEMP on
-- the database away from PUBLIC while preserving an active Neon Auth role's
-- prior access (see the last block). Touches no table, no existing view or
-- function, no data. Re-running it changes nothing.
--
-- ROLLBACK (no data is lost; the support search falls back to its earlier list
-- when the view is missing). The first line restores TEMP for PUBLIC only if
-- PUBLIC held it before 082 (the recorded state, see the last block); it must
-- run before the function, which carries that record, is dropped:
--   DO $r$ DECLARE state text := coalesce(obj_description(to_regprocedure('public.resource_app_rows()'), 'pg_proc'), ''); BEGIN IF state ~ 'public_had_temp=true' THEN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database()); END IF; IF state ~ 'auth_temp_grant_added=true' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='neon_auth') THEN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM neon_auth', current_database()); END IF; END $r$;
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
-- that the app holds no EXECUTE on its functions stays true.
--
-- HARDENED (review H1, L1, 2026-10-10):
--   * search_path ends in pg_temp. Left out, pg_temp is searched FIRST for
--     relations and types, so a caller's temp type named "date" (with temp
--     casts) ran the caller's code as the owner inside a $$ body.
--   * The body is SQL-standard BEGIN ATOMIC: parsed once, here, as the owner,
--     with every name and type resolved now (casts written ::pg_catalog.date),
--     so nothing a caller creates later can change what it calls.
--   * BEGIN ATOMIC also records a dependency on resource_public_v and
--     resource_area: dropping 072's view while this exists is refused instead
--     of silently breaking the app's read. A CREATE OR REPLACE of that view
--     that keeps its columns still flows through (by design: one definition
--     of "may be shown"), so any migration that touches resource_public_v must
--     re-run the 082 PGlite proof before it is applied.
--   No arguments (nothing to inject), STABLE, read-only.
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
BEGIN ATOMIC
  SELECT p.service_id, p.org_name, p.service_name, p.description, p.eligibility,
         p.area_id, a.label, p.geo_scope, p.state, p.county, p.counties, p.city,
         p.address, p.zip, p.phone, p.hours, p.website, p.source_url, p.verified_on
  FROM public.resource_public_v p
  JOIN public.resource_area a ON a.area_id = p.area_id
  WHERE p.expires_on > (pg_catalog.now() AT TIME ZONE 'UTC')::pg_catalog.date;
END;

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

-- No temporary objects for the app (review H1, defence in depth). The app
-- never creates temp tables, types or functions (checked 2026-10-10: only
-- migrations use pg_temp, and they run as the owner). Without TEMP a caller
-- cannot plant a temp type or function at all, which also covers the older
-- SECURITY DEFINER functions whose search_path lacks pg_temp. PostgreSQL has
-- no per-role deny: while PUBLIC holds TEMP, revoking it from smr_app alone
-- does nothing, so it is revoked from PUBLIC. The database owner keeps it
-- (owner privileges), so migrations that use pg_temp still run. COST, stated:
-- other non-owner, non-superuser roles lose TEMP too. An active Neon Auth
-- login role that owns its schema retains its prior effective TEMP through a
-- direct grant; the app must not inherit that role. Other roles that need
-- TEMP require a separately reviewed direct grant. Run the read-only
-- preflight (migrations/dry-run/082_temp_preflight.sql) first and keep its output.
--
-- WHAT WAS THERE BEFORE (review N1) is recorded as the COMMENT on
-- public.resource_app_rows(): "082 temp state: public_had_temp=<true|false>;
-- revoke=<done|skipped>; auth_temp_grant_added=<true|false>; recorded_on=<date>". It is written once, by the first
-- run, before the revoke; a re-run keeps it (PUBLIC no longer has TEMP then, so
-- re-reading would record the wrong answer). The rollback re-grants TEMP to
-- PUBLIC only when it says public_had_temp=true.
--
-- NOT SKIPPED SILENTLY (review N2). If the migrator neither owns the database
-- nor is superuser, the file stops with an EXCEPTION. For a database we
-- deliberately do not own, the documented override is a setting on the
-- migrating role, made before the run and removed after it:
--   ALTER ROLE <migrator> SET smr.skip_082_temp_revoke = 'on';   -- then reconnect
--   ... apply 082 ...
--   ALTER ROLE <migrator> RESET smr.skip_082_temp_revoke;
-- (or pass -c smr.skip_082_temp_revoke=on in the connection options). With the
-- override the revoke is skipped with a WARNING and recorded as revoke=skipped.
DO $$
DECLARE
  db      text := pg_catalog.current_database();
  fn      regprocedure := pg_catalog.to_regprocedure('public.resource_app_rows()');
  prev    text := pg_catalog.obj_description(pg_catalog.to_regprocedure('public.resource_app_rows()'), 'pg_proc');
  had     boolean;
  can     boolean;
  auth_was_temp boolean := false;
  auth_had_explicit boolean := false;
  auth_grant_added boolean := false;
  skip    boolean := COALESCE(pg_catalog.current_setting('smr.skip_082_temp_revoke', true), '') IN ('on', 'true', '1');
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'TEMPORARY')
    INTO had FROM pg_catalog.pg_database d WHERE d.datname = db;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.rolname = current_user
                  WHERE d.datname = db AND (d.datdba = r.oid OR r.rolsuper))
    INTO can;
  IF NOT can AND NOT skip THEN
    RAISE EXCEPTION '082: % does not own database %, so TEMP cannot be revoked from PUBLIC. Run as the owner, or set smr.skip_082_temp_revoke = on for a database we deliberately do not own (see the header).', current_user, db;
  END IF;
  SELECT pg_catalog.has_database_privilege(r.oid, db, 'TEMP'),
         EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
                 WHERE a.grantee = r.oid AND a.privilege_type = 'TEMPORARY')
    INTO auth_was_temp, auth_had_explicit
    FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datname = db
    WHERE r.rolname = 'neon_auth';
  auth_grant_added := can AND COALESCE(auth_was_temp, false) AND NOT COALESCE(auth_had_explicit, false);
  IF auth_grant_added THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_namespace n ON n.nspowner = r.oid
                   WHERE r.rolname = 'neon_auth' AND r.rolcanlogin AND n.nspname = 'neon_auth') THEN
      RAISE EXCEPTION '082: neon_auth role is not an active owner of its schema; inspect TEMP access before revoke';
    END IF;
  END IF;
  IF can AND COALESCE(auth_was_temp, false)
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smr_app')
     AND pg_catalog.pg_has_role('smr_app', 'neon_auth', 'USAGE') THEN
    RAISE EXCEPTION '082: smr_app inherits neon_auth; TEMP boundary would fail';
  END IF;
  IF prev IS NULL OR prev !~ '^082 temp state: ' THEN
    EXECUTE pg_catalog.format('COMMENT ON FUNCTION %s IS %L', fn,
      pg_catalog.format('082 temp state: public_had_temp=%s; revoke=%s; auth_temp_grant_added=%s; recorded_on=%s',
        CASE WHEN had THEN 'true' ELSE 'false' END, CASE WHEN can THEN 'done' ELSE 'skipped' END,
        CASE WHEN auth_grant_added THEN 'true' ELSE 'false' END, (pg_catalog.now() AT TIME ZONE 'UTC')::pg_catalog.date));
  END IF;
  IF can THEN
    EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', db);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smr_app') THEN
      EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM smr_app', db);
    END IF;
    IF auth_grant_added THEN
      EXECUTE pg_catalog.format('GRANT TEMPORARY ON DATABASE %I TO neon_auth', db);
    END IF;
  ELSE
    RAISE WARNING '082: TEMP NOT revoked (smr.skip_082_temp_revoke is on): % does not own database %', current_user, db;
  END IF;
END $$;
