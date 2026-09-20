-- Staff tasks: what a case manager has to do, optionally about one participant,
-- optionally shared WITH that participant ("bring your ID Thursday").
--
-- A task belongs to the organization, like a case note. It can be finished or
-- cancelled, never deleted: "what did we say we would do, and did we" is part
-- of the record. A shared task is visible to the participant and they can tick
-- it off themselves -- through a function, so ticking is ALL they can do to it.
CREATE TABLE IF NOT EXISTS staff_task (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id          UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- NULL = a task that is not about one participant ("call Job Service back").
  client_user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 300),
  due_on                  DATE,
  shared_with_participant BOOLEAN NOT NULL DEFAULT false,
  done_at                 TIMESTAMPTZ,
  done_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT shared_with_participant OR client_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS staff_task_open ON staff_task (access_code_id, owner_user_id, due_on) WHERE done_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_task_client ON staff_task (client_user_id) WHERE shared_with_participant;

CREATE OR REPLACE FUNCTION public.staff_task_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a task cannot be moved to another person or organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staff_task_guard ON staff_task;
CREATE TRIGGER staff_task_guard BEFORE UPDATE ON staff_task FOR EACH ROW EXECUTE FUNCTION public.staff_task_guard();

ALTER TABLE staff_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_task FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_task_select ON staff_task;
CREATE POLICY staff_task_select ON staff_task FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR (shared_with_participant AND cancelled_at IS NULL
      AND client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS staff_task_insert ON staff_task;
CREATE POLICY staff_task_insert ON staff_task FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND (client_user_id IS NULL OR EXISTS (SELECT 1 FROM access_code_redemption r
        WHERE r.user_id = staff_task.client_user_id AND r.access_code_id = staff_task.access_code_id)));
DROP POLICY IF EXISTS staff_task_update ON staff_task;
CREATE POLICY staff_task_update ON staff_task FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The participant's one permitted change: ticking (or un-ticking) a task that
-- was shared with them. No argument names a user; it acts for app.user_id.
CREATE OR REPLACE FUNCTION public.smr_tick_my_task(p_task uuid, p_done boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_user IS NULL OR NULLIF(current_setting('app.org_id', true), '') IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.staff_task
     SET done_at = CASE WHEN p_done THEN now() ELSE NULL END, done_by = CASE WHEN p_done THEN v_user ELSE NULL END
   WHERE id = p_task AND client_user_id = v_user AND shared_with_participant AND cancelled_at IS NULL
     AND (p_done OR done_by = v_user);  -- they can only un-tick what THEY ticked
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_tick_my_task(uuid, boolean) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_tick_my_task(uuid, boolean) TO smr_app;
    REVOKE ALL ON staff_task FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON staff_task TO smr_app;
  END IF;
END $$;

-- The delegable list becomes ONE function, so adding a capability is a one-line
-- migration instead of a copy of the whole access function. Must match
-- DELEGABLE_CAPABILITIES in packages/core/src/authz/capabilities.ts.
CREATE OR REPLACE FUNCTION public.smr_delegable_capabilities() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT ARRAY['org.client.view_all', 'org.client.view_content', 'org.client.request_sharing',
               'org.client.assign', 'org.note.write', 'org.task.write', 'org.participant.invite',
               'org.export', 'org.seats.view', 'org.costs.view', 'org.insights.view']::text[]
$$;

CREATE OR REPLACE FUNCTION public.smr_set_capability_override(p_target uuid, p_capability text, p_effect text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_owner uuid;
  v_actor_role text;
  v_target_role text;
BEGIN
  IF v_org IS NULL OR v_actor IS NULL OR p_target IS NULL THEN RETURN 'refused'; END IF;
  IF p_effect NOT IN ('grant', 'deny', 'clear') THEN RETURN 'refused'; END IF;
  IF NOT (p_capability = ANY (public.smr_delegable_capabilities())) THEN
    RETURN 'not_delegable';
  END IF;

  SELECT partner_user_id INTO v_owner FROM public.access_code WHERE id = v_org;
  IF v_actor = v_owner THEN v_actor_role := 'owner';
  ELSE SELECT role INTO v_actor_role FROM public.org_staff WHERE access_code_id = v_org AND user_id = v_actor;
  END IF;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'org_admin') THEN RETURN 'refused'; END IF;

  IF p_target = v_actor THEN RETURN 'not_yourself'; END IF;
  IF p_target = v_owner THEN RETURN 'not_the_owner'; END IF;
  SELECT role INTO v_target_role FROM public.org_staff WHERE access_code_id = v_org AND user_id = p_target;
  IF v_target_role IS NULL THEN RETURN 'not_staff'; END IF;
  IF v_target_role = 'org_admin' AND v_actor_role <> 'owner' THEN RETURN 'owner_only'; END IF;

  IF p_effect = 'clear' THEN
    DELETE FROM public.org_capability_override WHERE org_id = v_org AND user_id = p_target AND capability = p_capability;
  ELSE
    INSERT INTO public.org_capability_override (org_id, user_id, capability, effect, set_by)
    VALUES (v_org, p_target, p_capability, p_effect, v_actor::text)
    ON CONFLICT (org_id, user_id, capability) DO UPDATE SET effect = EXCLUDED.effect, set_by = EXCLUDED.set_by, set_at = now();
  END IF;

  INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
  VALUES ('org_capability_override', upper(p_effect), v_org, p_target, v_actor::text, session_user,
          jsonb_build_object('capability', p_capability));
  RETURN 'ok';
END;
$$;
