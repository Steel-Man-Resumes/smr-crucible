-- 106_ai_skill_run.sql
-- Staff t.ROY skill runs: who ran which skill, about whom, and whether a
-- person used what it drafted (house build L6, 2026-10-26).
--
-- WHAT THIS ADDS
--   ai_skill_run   one row per staff t.ROY answer: the organization, the staff
--                  member who asked (actor), the skill, the participant it was
--                  about (NULL for caseload skills), a short input summary,
--                  the names of the tools that ran, a sha256 of the answer,
--                  and who accepted it and when (NULL until a staff member
--                  saves or copies the draft with their own click).
--
-- WHAT IS NEVER STORED. Not the answer (only its hash), not a note body, not
-- a tool result. input_summary is the staff member's own words with record,
-- court and supervision text withheld by the app (lib/staff-ai-safety.ts
-- skillRunInputSummary) and capped at 300 characters here.
--
-- WHO MAY DO WHAT, AS DATABASE FACTS (not only route checks):
--   insert   a staff member or the owner of the organization in scope
--            (app.org_id), as themselves (app.user_id), never pre-accepted,
--            about a participant who is a member of that organization AND in
--            their reach.
--   read     your own runs; the owner and org admins read every run in their
--            organization (the AI audit, BUILD R33 and R40). RESTRICTIVE: a
--            run about a participant is visible only while the reader reaches
--            that participant.
--   update   only accepted_by and accepted_at (column grant), only your own
--            run, only once, and only as yourself.
--   delete   nobody through the app (no grant). Append-only.
--
-- REACH. smr_staff_reach(org, staff, participant) is lane L3b's function
-- (102, replaced by 103). ai_skill_run_reach calls it when it exists. Before
-- 102 is applied it falls back to a NARROWER rule (owner, an org admin or a
-- view_all grant without a deny, or an assignment), so this file applies on
-- its own and never reaches wider than 102 will.
--
-- Additive: one table, three functions, one trigger, policies on the new
-- table only. APPLY BEFORE THE APP RELEASE that ships the L6 staff skills:
-- the protected-table health check lists ai_skill_run, and the app logs every
-- staff skill run to it (best effort: a failed log is reported, the answer is
-- still shown, the participant's access log is written by the reads as before).
--
-- ROLLBACK, in this order:
--   1. Revert the L6 app code and deploy that.
--   2. As the owner role, in one transaction:
--        DROP TABLE IF EXISTS ai_skill_run CASCADE;
--        DROP FUNCTION IF EXISTS public.ai_skill_run_guard();
--        DROP FUNCTION IF EXISTS public.ai_skill_run_reach(uuid, uuid, uuid);
--        DROP FUNCTION IF EXISTS public.ai_skill_run_org_admin(uuid, uuid);
--        DELETE FROM _migrations WHERE filename = '106_ai_skill_run.sql';
SET LOCAL lock_timeout = '5s';

-- The helpers read RLS-forced tables (org_staff, access_code_redemption,
-- client_staff_assignment, org_capability_override) on behalf of a policy, so
-- their owner must bypass RLS, or every policy check would see nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '106 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_skill_run (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  skill               TEXT NOT NULL CHECK (skill ~ '^staff-[a-z][a-z-]{1,40}$'),
  participant_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  input_summary       TEXT NOT NULL CHECK (length(btrim(input_summary)) BETWEEN 1 AND 300),
  tools               TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tools) <= 12),
  output_hash         TEXT NOT NULL CHECK (output_hash ~ '^[0-9a-f]{64}$'),
  accepted_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at         TIMESTAMPTZ,
  at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An acceptance names a time. (accepted_by may later be nulled by a deleted account.)
  CONSTRAINT ai_skill_run_accept_whole CHECK (accepted_by IS NULL OR accepted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_skill_run_org_at ON ai_skill_run (access_code_id, at DESC);
CREATE INDEX IF NOT EXISTS ai_skill_run_participant ON ai_skill_run (access_code_id, participant_user_id, at DESC)
  WHERE participant_user_id IS NOT NULL;

-- Owner or org admin of the organization: they read every run (the audit).
CREATE OR REPLACE FUNCTION public.ai_skill_run_org_admin(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user AND s.role = 'org_admin'));
$$;
REVOKE ALL ON FUNCTION public.ai_skill_run_org_admin(uuid, uuid) FROM PUBLIC;

-- Does this staff member reach this participant? 102's rule when it exists;
-- a narrower one before (header, REACH).
CREATE OR REPLACE FUNCTION public.ai_skill_run_reach(p_org uuid, p_staff uuid, p_participant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v boolean;
BEGIN
  IF p_participant IS NULL THEN RETURN true; END IF;
  IF p_staff IS NULL OR p_org IS NULL THEN RETURN false; END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.smr_staff_reach($1, $2, $3)' INTO v USING p_org, p_staff, p_participant;
    RETURN COALESCE(v, false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_staff) THEN
    RETURN true;
  END IF;
  IF (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_staff AND s.role = 'org_admin')
      OR EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_staff
                   AND o.capability = 'org.client.view_all' AND o.effect = 'grant'))
     AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_staff)
     AND NOT EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_staff
                       AND o.capability = 'org.client.view_all' AND o.effect = 'deny') THEN
    RETURN true;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.client_staff_assignment c
                  WHERE c.access_code_id = p_org AND c.client_user_id = p_participant AND c.staff_user_id = p_staff);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_skill_run_reach(uuid, uuid, uuid) FROM PUBLIC;

-- BEFORE guard: who may write what. SECURITY DEFINER because it reads the
-- RLS-forced membership tables.
CREATE OR REPLACE FUNCTION public.ai_skill_run_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR v_org IS NULL OR NEW.actor_user_id IS DISTINCT FROM v_actor OR NEW.access_code_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'a skill run is written by the staff member, in their own organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (EXISTS (SELECT 1 FROM access_code a WHERE a.id = v_org AND a.partner_user_id = v_actor)
            OR EXISTS (SELECT 1 FROM org_staff s WHERE s.access_code_id = v_org AND s.user_id = v_actor)) THEN
      RAISE EXCEPTION 'only staff of this organization log a skill run' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.accepted_by IS NOT NULL OR NEW.accepted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a skill run starts unaccepted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.participant_user_id IS NOT NULL AND (
         NOT EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = NEW.participant_user_id AND r.access_code_id = v_org)
         OR NOT public.ai_skill_run_reach(v_org, v_actor, NEW.participant_user_id)) THEN
      RAISE EXCEPTION 'that participant is not in your reach here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.at := now();
    RETURN NEW;
  END IF;

  -- UPDATE. A deleted account nulls actor_user_id or accepted_by (ON DELETE
  -- SET NULL runs as an UPDATE): allow exactly that and nothing with it.
  IF (NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL) OR (NEW.accepted_by IS NULL AND OLD.accepted_by IS NOT NULL) THEN
    IF NEW.id = OLD.id AND NEW.access_code_id = OLD.access_code_id AND NEW.skill = OLD.skill
       AND NEW.participant_user_id IS NOT DISTINCT FROM OLD.participant_user_id AND NEW.input_summary = OLD.input_summary
       AND NEW.tools = OLD.tools AND NEW.output_hash = OLD.output_hash AND NEW.at = OLD.at
       AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at
       AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id = OLD.actor_user_id)
       AND (NEW.accepted_by IS NULL OR NEW.accepted_by = OLD.accepted_by) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.id <> OLD.id OR NEW.access_code_id <> OLD.access_code_id OR NEW.skill <> OLD.skill
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id
     OR NEW.input_summary <> OLD.input_summary OR NEW.tools <> OLD.tools OR NEW.output_hash <> OLD.output_hash OR NEW.at <> OLD.at THEN
    RAISE EXCEPTION 'a skill run is a record: only its acceptance can be added' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'this skill run was already accepted' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL OR NEW.accepted_by IS DISTINCT FROM v_actor OR OLD.actor_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'only the staff member who ran it accepts a skill run, as themselves' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.accepted_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_skill_run_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS ai_skill_run_guard ON ai_skill_run;
CREATE TRIGGER ai_skill_run_guard
  BEFORE INSERT OR UPDATE ON ai_skill_run
  FOR EACH ROW EXECUTE FUNCTION public.ai_skill_run_guard();

ALTER TABLE ai_skill_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_skill_run FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_skill_run_select ON ai_skill_run;
CREATE POLICY ai_skill_run_select ON ai_skill_run FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
       OR public.ai_skill_run_org_admin(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid)));

DROP POLICY IF EXISTS ai_skill_run_insert ON ai_skill_run;
CREATE POLICY ai_skill_run_insert ON ai_skill_run FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND accepted_by IS NULL AND accepted_at IS NULL);

DROP POLICY IF EXISTS ai_skill_run_update ON ai_skill_run;
CREATE POLICY ai_skill_run_update ON ai_skill_run FOR UPDATE
  USING (
    access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND accepted_at IS NULL)
  WITH CHECK (
    access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND accepted_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- The reach rule (SPEC, 102): a run about a participant only while the reader reaches them.
DROP POLICY IF EXISTS ai_skill_run_reach ON ai_skill_run;
CREATE POLICY ai_skill_run_reach ON ai_skill_run AS RESTRICTIVE FOR ALL
  USING (public.ai_skill_run_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (public.ai_skill_run_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON ai_skill_run FROM smr_app;
    GRANT SELECT, INSERT ON ai_skill_run TO smr_app;
    GRANT UPDATE (accepted_by, accepted_at) ON ai_skill_run TO smr_app;
    GRANT EXECUTE ON FUNCTION public.ai_skill_run_org_admin(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.ai_skill_run_reach(uuid, uuid, uuid) TO smr_app;
  END IF;
END $$;

-- After-guards: only what this file creates.
DO $$
DECLARE
  c record;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO c FROM pg_class WHERE oid = 'public.ai_skill_run'::regclass;
  IF NOT (c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION '106: ai_skill_run must have row-level security enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_skill_run'
        AND policyname IN ('ai_skill_run_select', 'ai_skill_run_insert', 'ai_skill_run_update', 'ai_skill_run_reach')) <> 4 THEN
    RAISE EXCEPTION '106: ai_skill_run policies are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_skill_run'
                   AND policyname = 'ai_skill_run_reach' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '106: the reach policy must be RESTRICTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ai_skill_run'::regclass AND tgname = 'ai_skill_run_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '106: the ai_skill_run guard trigger is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.ai_skill_run', 'DELETE')
       OR has_table_privilege('smr_app', 'public.ai_skill_run', 'TRUNCATE')
       OR has_column_privilege('smr_app', 'public.ai_skill_run', 'input_summary', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.ai_skill_run', 'output_hash', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.ai_skill_run', 'participant_user_id', 'UPDATE') THEN
      RAISE EXCEPTION '106: smr_app may only add an acceptance to ai_skill_run';
    END IF;
    IF NOT has_column_privilege('smr_app', 'public.ai_skill_run', 'accepted_at', 'UPDATE') THEN
      RAISE EXCEPTION '106: smr_app must be able to record an acceptance';
    END IF;
  END IF;
END $$;
