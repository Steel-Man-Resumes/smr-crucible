-- 082_temp_preflight.sql
-- READ-ONLY. Makes no writes: the whole file runs inside a READ ONLY
-- transaction that is rolled back. Run on a fresh Neon branch of production
-- (or production itself) BEFORE applying 082, as the role that will apply it.
-- From the R3 round 2 review (review-p5-r3-r2.md, section 2). Role names and
-- privilege flags only: no rows, no names of people.
--
-- WHY. 082 revokes TEMPORARY on the database from PUBLIC (and smr_app). Every
-- non-owner, non-superuser role loses TEMP. This shows who that is, whether
-- anything uses temp objects today, and the database ACL before the change
-- (keep the output: it is the exact rollback target).
--
-- Read it like this:
--   1. owner must equal current_user (expected neondb_owner) and
--      migrator_bypassrls must be true. If owner <> current_user and the
--      migrator is not superuser, 082 STOPS with an exception (review N2)
--      unless smr.skip_082_temp_revoke is set on purpose (see 082's header).
--      public_has_temp_now is what 082 will record as public_had_temp.
--   2. Every row with temp_now AND NOT rolsuper AND NOT owner_or_member AND NOT
--      explicit_temp loses TEMP. On 2026-10-10 that should be exactly:
--      anonymous, authenticated, authenticator, smr_app, smr_runner.
--   3. Temp objects alive right now: expect none.
--   4. Invoker-rights functions in public that create temp objects (they would
--      break for non-owner callers): expect none, or only owner-run helpers.
--   5. Statements that created temp objects, by role, from pg_stat_statements.
--      Last on purpose: it fails with "relation does not exist" when that
--      extension is not installed, which is fine (steps 1 to 4 already ran).
-- Stop and ask before applying 082 if step 2 lists any other role, or if
-- step 3, 4 or 5 shows a non-owner role using temp objects.

BEGIN TRANSACTION READ ONLY;

-- 1. Who owns the database, who is migrating, and the database ACL now.
SELECT d.datname, d.datdba::regrole AS owner, d.datacl, current_user,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS migrator_super,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS migrator_bypassrls,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'TEMPORARY') AS public_has_temp_now
FROM pg_database d WHERE d.datname = current_database();

-- 2. Every role that has TEMP today, and whether it would keep it.
WITH db AS (SELECT oid, datdba, datacl FROM pg_database WHERE datname = current_database())
SELECT r.rolname, r.rolcanlogin, r.rolsuper,
       has_database_privilege(r.oid, current_database(), 'TEMP') AS temp_now,
       r.oid = db.datdba OR pg_has_role(r.oid, db.datdba, 'MEMBER') AS owner_or_member,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(db.datacl, acldefault('d', db.datdba))) a
               WHERE a.grantee = r.oid AND a.privilege_type = 'TEMPORARY') AS explicit_temp
FROM pg_roles r, db
WHERE r.rolname !~ '^pg_'
ORDER BY 1;

-- 3. Temp objects that exist right now (any live session using them).
SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relpersistence = 't';

-- 4. Invoker-rights functions that create temp objects.
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.prosrc ~* 'create\s+(temp|temporary)\s|pg_temp\.';

-- 5. Statements that created temp objects, by role (needs pg_stat_statements).
SELECT userid::regrole, calls, left(query, 120)
FROM pg_stat_statements WHERE query ~* 'create\s+(temp|temporary)\s|pg_temp\.' ORDER BY calls DESC LIMIT 20;

ROLLBACK;

-- AFTER APPLYING 082 (also read-only; each must hold, or stop and ask):
--   SELECT has_database_privilege('smr_app', current_database(), 'TEMP');      -- false
--   SELECT has_database_privilege('smr_runner', current_database(), 'TEMP');   -- false
--   SELECT has_database_privilege(current_user, current_database(), 'TEMP');   -- true (owner)
--   SELECT obj_description('public.resource_app_rows()'::regprocedure, 'pg_proc');
--        -- "082 temp state: public_had_temp=true; revoke=done; ..."
--   SELECT array_to_string(proconfig, ','), prosqlbody IS NOT NULL
--     FROM pg_proc WHERE proname = 'resource_app_rows';                          -- ...pg_temp, true
--   SET ROLE smr_app; SELECT count(*) FROM resource_app_v; RESET ROLE;          -- runs, no error
--   GET /api/health/rls on the preview: no "TEMP" problem listed.
