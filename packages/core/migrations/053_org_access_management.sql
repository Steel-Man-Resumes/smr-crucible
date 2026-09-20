-- An organization's owner and admins can shape what each staff member may do.
--
-- org_capability_override is READ-ONLY to the application role (051): a grant
-- of power must not be something a forgotten WHERE clause or a bug can write.
-- So the write goes through this function, which does not take the caller's
-- word for anything. It reads who the actor IS from the tables -- the owner of
-- the access code, or an org_admin row -- rather than from a capability list
-- the application handed it.
--
-- THE RULES, all enforced here:
--   * the actor is the org's owner or one of its admins;
--   * the target is on this org's staff, is not the owner, and is not the actor
--     (nobody adjusts their own access);
--   * an admin cannot adjust another admin -- only the owner can;
--   * only capabilities on the delegable list below. Managing staff, managing
--     settings and viewing the audit trail are NOT delegable per person: they
--     come with being an admin or the owner, or not at all;
--   * every change is written to the audit trail with who made it.
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
  IF p_capability NOT IN (
       'org.client.view_all', 'org.client.view_content', 'org.client.request_sharing',
       'org.client.assign', 'org.note.write', 'org.participant.invite',
       'org.export', 'org.seats.view', 'org.costs.view', 'org.insights.view') THEN
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
REVOKE ALL ON FUNCTION public.smr_set_capability_override(uuid, text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_set_capability_override(uuid, text, text) TO smr_app;
  END IF;
END $$;

-- Removing someone from staff removes their exceptions with them, so a person
-- re-added later starts from their role, not from a forgotten grant.
CREATE OR REPLACE FUNCTION public.org_staff_clear_overrides() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.org_capability_override WHERE org_id = OLD.access_code_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS org_staff_clear_overrides ON org_staff;
CREATE TRIGGER org_staff_clear_overrides AFTER DELETE ON org_staff
  FOR EACH ROW EXECUTE FUNCTION public.org_staff_clear_overrides();

-- A staff invitation that has not been accepted yet: who, as what, by whom.
ALTER TABLE org_staff ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE org_staff ADD COLUMN IF NOT EXISTS invited_email TEXT;
