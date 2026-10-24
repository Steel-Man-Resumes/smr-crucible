-- Platform-admin organization changes leave a record (B8 crm, 2026-10-23).
--
-- The admin "Create organization" form and its actions (add seats, set the
-- daily limit, rotate the code, set or change the owner) write access_code.
-- access_code had no audit trigger, so a change to who owns an organization,
-- or to how many seats it has, left no trace. This adds one, in the same
-- pattern as the org_staff trigger (045/046) and the SECURITY DEFINER writers
-- in 053-055: the application role cannot write org_audit, the trigger owner
-- does.
--
-- WHAT IT RECORDS: the fields that decide who runs an organization and what it
-- may spend. Not times_redeemed (it moves on every join and has its own
-- function), not display fields. THE CODE ITSELF IS NEVER WRITTEN to the audit
-- row, only that it changed: org_audit is readable by the organization's own
-- staff, and the code is a seat key.
--
-- Additive: one function, one trigger. No table, column or policy changes, so
-- the protected-table list is unchanged. The application does not depend on
-- this migration: without it the actions still work and still log through
-- emitEvent; with it they are also in org_audit.
CREATE OR REPLACE FUNCTION public.access_code_admin_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor text := NULLIF(current_setting('app.user_id', true), '');
  v_diff  jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
    VALUES ('access_code', 'INSERT', NEW.id, NEW.partner_user_id, v_actor, session_user,
            jsonb_strip_nulls(jsonb_build_object(
              'max_redemptions', NEW.max_redemptions,
              'daily_limit', NEW.daily_limit,
              'tier', NEW.tier,
              'crm_v2', NEW.crm_v2,
              'required_sharing_enabled', NEW.required_sharing_enabled,
              'owner', NEW.partner_user_id)));
    RETURN NEW;
  END IF;

  IF NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id THEN
    v_diff := v_diff || jsonb_build_object('owner_from', OLD.partner_user_id, 'owner_to', NEW.partner_user_id);
  END IF;
  IF NEW.max_redemptions IS DISTINCT FROM OLD.max_redemptions THEN
    v_diff := v_diff || jsonb_build_object('max_redemptions_from', OLD.max_redemptions, 'max_redemptions_to', NEW.max_redemptions);
  END IF;
  IF NEW.daily_limit IS DISTINCT FROM OLD.daily_limit THEN
    v_diff := v_diff || jsonb_build_object('daily_limit_from', OLD.daily_limit, 'daily_limit_to', NEW.daily_limit);
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    v_diff := v_diff || jsonb_build_object('code_rotated', true);
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_diff := v_diff || jsonb_build_object('is_active_to', NEW.is_active);
  END IF;
  IF NEW.crm_v2 IS DISTINCT FROM OLD.crm_v2 THEN
    v_diff := v_diff || jsonb_build_object('crm_v2_to', NEW.crm_v2);
  END IF;
  IF NEW.required_sharing_enabled IS DISTINCT FROM OLD.required_sharing_enabled THEN
    v_diff := v_diff || jsonb_build_object('required_sharing_enabled_to', NEW.required_sharing_enabled);
  END IF;

  IF v_diff <> '{}'::jsonb THEN
    INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
    VALUES ('access_code', 'UPDATE', NEW.id, NEW.partner_user_id, v_actor, session_user, v_diff);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.access_code_admin_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS access_code_admin_audit ON access_code;
CREATE TRIGGER access_code_admin_audit
  AFTER INSERT OR UPDATE ON access_code
  FOR EACH ROW EXECUTE FUNCTION public.access_code_admin_audit();
