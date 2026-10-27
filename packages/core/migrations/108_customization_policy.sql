-- 108_customization_policy.sql
-- What staff may change about their own screens, and a log of every change
-- to a person's own view so any of it can be undone (staff build S3,
-- 2026-10-27). Depends on 102 (org_activity_write) and 104 (smr_org_manager,
-- smr_org_staff_session). Merge order 107 to 112.
--
-- WHAT IT ADDS
--   org_customization_policy  per organization, role (org_admin, staff) and
--                             screen (today, people, person): which personal
--                             changes that role may make, as booleans
--                             ({"today_order": false, ...}). No row, or a key
--                             left out, means allowed: a personal change only
--                             ever touches the person who made it. The owner
--                             is never limited (no 'owner' role here).
--                             Read by the organization's staff; written by
--                             its managers (owner or org admin). The app
--                             (core customizationPolicyShared) enforces it
--                             when prefs and personal views are written AND
--                             read.
--   view_change_log           every change to a person's OWN view or prefs,
--                             made by hand or by t.ROY (by_ai): which screen,
--                             what changed, the value before and after, so one
--                             list can undo any of it. Owner-only: a person
--                             reads and writes only their own rows, in the
--                             organization in scope. Append-only except the
--                             one mark "undone at", set once.
--
-- WHO MAY DO WHAT, AS DATABASE FACTS (the app checks capabilities first)
--   policy read     staff of the organization (smr_org_staff_session).
--   policy write    a manager (smr_org_manager): its owner or an org admin.
--                   A platform admin acting on an org is neither.
--   log insert      the person themselves (app.user_id), in the org in scope,
--                   and only if they are its owner or on its staff.
--   log read        the person themselves only. Not their manager, not the
--                   owner: it is a record of how one person arranges their
--                   own screen.
--   log update      only undone_at (column grant), only your own row, once.
--   log delete      nobody through the app (no grant). Account deletion
--                   removes a person's rows by foreign key.
--
-- WHAT IS NEVER STORED. No participant data: before and after hold section
-- keys, column ids, widths, view names and view definitions. Summaries are
-- written by the app from fixed words.
--
-- AUDIT: changing a policy writes org_activity (entity 'org', fixed words,
-- no values), like 104's layouts.
--
-- Additive: two tables, three functions, triggers and policies on the new
-- tables only. Nothing existing changes.
-- APPLY BEFORE THE APP RELEASE that ships "What staff can change for
-- themselves" and the People grid: the RLS health check lists both tables.
-- (Without it the app treats the policy as all-allowed and skips the log.)
--
-- ROLLBACK, in this order:
--   1. Revert the S3 app code and deploy that.
--   2. As the owner role, in one transaction:
--        DROP TABLE IF EXISTS view_change_log, org_customization_policy CASCADE;
--        DROP FUNCTION IF EXISTS public.org_customization_policy_guard(), public.org_customization_policy_activity(),
--          public.view_change_log_guard();
--        DELETE FROM _migrations WHERE filename = '108_customization_policy.sql';
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '108 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.smr_org_manager(uuid)') IS NULL OR to_regprocedure('public.smr_org_staff_session(uuid)') IS NULL THEN
    RAISE EXCEPTION '108 needs migration 104 (smr_org_manager, smr_org_staff_session) applied first';
  END IF;
  IF to_regprocedure('public.org_activity_write(uuid,uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '108 needs migration 102 (public.org_activity_write) applied first';
  END IF;
END $$;

-- ------------------------------------------------------------------ tables --
CREATE TABLE IF NOT EXISTS org_customization_policy (
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('org_admin', 'staff')),
  surface        TEXT NOT NULL CHECK (surface IN ('today', 'people', 'person')),
  -- Shape owned by TypeScript (customizationPolicyShared.ts), normalized on
  -- every read; the guard below keeps it to known-looking keys and booleans.
  allowed        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(allowed) = 'object' AND octet_length(allowed::text) <= 2000),
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (access_code_id, role, surface)
);

CREATE TABLE IF NOT EXISTS view_change_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- Whose view changed. Always the person acting: t.ROY changes only the
  -- view of the person it is working for (by_ai says it was t.ROY).
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface        TEXT NOT NULL CHECK (surface IN ('today', 'people', 'person', 'views')),
  action         TEXT NOT NULL CHECK (action ~ '^[a-z][a-z_]{1,40}$'),
  -- What the before/after values belong to: a pref ("pref:todayOrder"), a
  -- personal view ("view:<id>") or a grid look ("layout:default").
  target         TEXT NOT NULL CHECK (target ~ '^[a-z][a-zA-Z]{1,30}(:[0-9a-zA-Z_-]{1,60})?$'),
  summary        TEXT NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 200),
  before         JSONB CHECK (before IS NULL OR octet_length(before::text) <= 20000),
  after          JSONB CHECK (after IS NULL OR octet_length(after::text) <= 20000),
  by_ai          BOOLEAN NOT NULL DEFAULT false,
  -- An undo is a change too; it names the change it undid.
  undoes         UUID REFERENCES view_change_log(id) ON DELETE SET NULL,
  undone_at      TIMESTAMPTZ,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS view_change_log_mine ON view_change_log (access_code_id, user_id, at DESC);

-- ------------------------------------------------------------------ guards --
-- The policy's switches: known-looking keys, boolean values, at most 20.
CREATE OR REPLACE FUNCTION public.org_customization_policy_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  k text;
  v jsonb;
  n int := 0;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each(NEW.allowed) LOOP
    n := n + 1;
    IF k !~ '^[a-z][a-z_]{1,40}$' OR jsonb_typeof(v) <> 'boolean' THEN
      RAISE EXCEPTION 'a customization switch is a name and yes or no' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF n > 20 THEN
    RAISE EXCEPTION 'too many customization switches' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_customization_policy_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_customization_policy_guard ON org_customization_policy;
CREATE TRIGGER org_customization_policy_guard BEFORE INSERT OR UPDATE ON org_customization_policy
  FOR EACH ROW EXECUTE FUNCTION public.org_customization_policy_guard();

-- Activity, in fixed words (role and screen from CHECK-listed columns).
CREATE OR REPLACE FUNCTION public.org_customization_policy_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role   text := CASE COALESCE(NEW.role, OLD.role) WHEN 'org_admin' THEN 'admins' ELSE 'staff' END;
  v_screen text := CASE COALESCE(NEW.surface, OLD.surface) WHEN 'today' THEN 'Today' WHEN 'people' THEN 'People' ELSE 'a person''s page' END;
BEGIN
  PERFORM public.org_activity_write(COALESCE(NEW.access_code_id, OLD.access_code_id), NULL, NULL, 'org',
    COALESCE(NEW.access_code_id, OLD.access_code_id)::text, 'updated',
    format('%s what %s can change for themselves on %s', CASE TG_OP WHEN 'DELETE' THEN 'reset' ELSE 'changed' END, v_role, v_screen));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_customization_policy_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_customization_policy_activity ON org_customization_policy;
CREATE TRIGGER org_customization_policy_activity AFTER INSERT OR UPDATE OR DELETE ON org_customization_policy
  FOR EACH ROW EXECUTE FUNCTION public.org_customization_policy_activity();

-- The log: written by the person, as themselves, in their own organization;
-- after that only "undone at" can be added, once. SECURITY DEFINER because it
-- reads the RLS-forced staff table on the caller's behalf.
CREATE OR REPLACE FUNCTION public.view_change_log_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR v_org IS NULL OR NEW.user_id IS DISTINCT FROM v_actor OR NEW.access_code_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'a view change is written by the person, in their own organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = v_org AND a.partner_user_id = v_actor)
            OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = v_org AND s.user_id = v_actor)) THEN
      RAISE EXCEPTION 'only staff of this organization keep a view change log here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.undone_at IS NOT NULL THEN
      RAISE EXCEPTION 'a view change starts not undone' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.undoes IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.view_change_log l WHERE l.id = NEW.undoes AND l.user_id = v_actor AND l.access_code_id = v_org) THEN
      RAISE EXCEPTION 'an undo names one of your own changes' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: a deleted "undoes" target nulls the pointer (ON DELETE SET NULL);
  -- allow exactly that. Otherwise only undone_at, once, set here.
  IF NEW.undoes IS NULL AND OLD.undoes IS NOT NULL AND NEW.undone_at IS NOT DISTINCT FROM OLD.undone_at THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.access_code_id <> OLD.access_code_id OR NEW.user_id <> OLD.user_id OR NEW.surface <> OLD.surface
     OR NEW.action <> OLD.action OR NEW.target <> OLD.target OR NEW.summary <> OLD.summary
     OR NEW.before IS DISTINCT FROM OLD.before OR NEW.after IS DISTINCT FROM OLD.after OR NEW.by_ai <> OLD.by_ai
     OR NEW.undoes IS DISTINCT FROM OLD.undoes OR NEW.at <> OLD.at THEN
    RAISE EXCEPTION 'a view change is a record: only "undone" can be added' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'this change was already undone' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL OR OLD.user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'only the person whose view it is marks a change undone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.undone_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.view_change_log_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS view_change_log_guard ON view_change_log;
CREATE TRIGGER view_change_log_guard BEFORE INSERT OR UPDATE ON view_change_log
  FOR EACH ROW EXECUTE FUNCTION public.view_change_log_guard();

-- ---------------------------------------------------------------- policies --
ALTER TABLE org_customization_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_customization_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE view_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_change_log FORCE ROW LEVEL SECURITY;

-- The policy: the organization's staff read; managers write.
DROP POLICY IF EXISTS org_customization_policy_select ON org_customization_policy;
CREATE POLICY org_customization_policy_select ON org_customization_policy FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_staff_session(access_code_id));
DROP POLICY IF EXISTS org_customization_policy_insert ON org_customization_policy;
CREATE POLICY org_customization_policy_insert ON org_customization_policy FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS org_customization_policy_update ON org_customization_policy;
CREATE POLICY org_customization_policy_update ON org_customization_policy FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS org_customization_policy_delete ON org_customization_policy;
CREATE POLICY org_customization_policy_delete ON org_customization_policy FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));

-- The log: your own rows, in the organization in scope. Nobody else's.
DROP POLICY IF EXISTS view_change_log_select ON view_change_log;
CREATE POLICY view_change_log_select ON view_change_log FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS view_change_log_insert ON view_change_log;
CREATE POLICY view_change_log_insert ON view_change_log FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND undone_at IS NULL);
DROP POLICY IF EXISTS view_change_log_update ON view_change_log;
CREATE POLICY view_change_log_update ON view_change_log FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND undone_at IS NULL)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_customization_policy, view_change_log FROM smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON org_customization_policy TO smr_app;
    GRANT SELECT, INSERT ON view_change_log TO smr_app;
    GRANT UPDATE (undone_at) ON view_change_log TO smr_app;
    REVOKE ALL ON FUNCTION public.org_customization_policy_guard() FROM smr_app;
    REVOKE ALL ON FUNCTION public.org_customization_policy_activity() FROM smr_app;
    REVOKE ALL ON FUNCTION public.view_change_log_guard() FROM smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------ after-guards --
-- Only what this migration created.
DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_customization_policy', 'view_change_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '108 after: % does not have row-level security enabled and forced', t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_customization_policy'
        AND policyname IN ('org_customization_policy_select', 'org_customization_policy_insert',
                           'org_customization_policy_update', 'org_customization_policy_delete')) <> 4 THEN
    RAISE EXCEPTION '108 after: org_customization_policy policies are missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'view_change_log'
        AND policyname IN ('view_change_log_select', 'view_change_log_insert', 'view_change_log_update')) <> 3 THEN
    RAISE EXCEPTION '108 after: view_change_log policies are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'view_change_log' AND cmd = 'DELETE') THEN
    RAISE EXCEPTION '108 after: view_change_log must have no delete policy';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('org_customization_policy_guard', 'org_customization_policy_activity', 'view_change_log_guard') AND NOT tgisinternal;
  IF n <> 3 THEN
    RAISE EXCEPTION '108 after: expected 3 triggers, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.view_change_log', 'DELETE')
       OR has_table_privilege('smr_app', 'public.view_change_log', 'TRUNCATE')
       OR has_column_privilege('smr_app', 'public.view_change_log', 'before', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.view_change_log', 'after', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.view_change_log', 'summary', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.view_change_log', 'user_id', 'UPDATE') THEN
      RAISE EXCEPTION '108 after: smr_app may only add "undone" to view_change_log';
    END IF;
    IF NOT has_column_privilege('smr_app', 'public.view_change_log', 'undone_at', 'UPDATE') THEN
      RAISE EXCEPTION '108 after: smr_app must be able to mark a change undone';
    END IF;
    IF has_function_privilege('smr_app', 'public.org_customization_policy_activity()', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.view_change_log_guard()', 'EXECUTE') THEN
      RAISE EXCEPTION '108 after: smr_app can call a trigger function directly';
    END IF;
  END IF;
  IF has_function_privilege('public', 'public.org_customization_policy_activity()', 'EXECUTE')
     OR has_function_privilege('public', 'public.view_change_log_guard()', 'EXECUTE')
     OR has_function_privilege('public', 'public.org_customization_policy_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION '108 after: PUBLIC can call a 108 trigger function';
  END IF;
END $$;
