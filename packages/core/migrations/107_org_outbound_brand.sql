-- 107_org_outbound_brand.sql
-- Outbound branding: how what staff send out of the Refinery is branded
-- (staff pass 2026-10-27, lane S2).
--
-- WHAT THIS ADDS
--   org_profile.branding   'co_brand' (default) or 'exclusive'.
--     co_brand   every outbound surface staff produce (printed reports, the
--                Insights print, CSV downloads, invite emails, digests) reads
--                "<Organization> with Steel Man Resumes".
--     exclusive  the organization's name only. Exclusive branding is what an
--                organization buys, so ONLY A PLATFORM ADMIN sets it.
--   Troy, 2026-10-27: emails to colleagues and reports "will have the
--   organization format, which should be co-branded with Steel Man Resumes
--   unless they pay for exclusive branding."
--   The in-app participant co-brand (org_brand.tier, 099) is a separate axis
--   and is untouched.
--
-- WHO MAY DO WHAT (database facts, not only route checks):
--   read    anyone who may read the profile row today (103's select policy:
--           the org's scope, members, staff, the owner, a platform admin).
--   set     a platform admin only, through smr_set_org_branding (SECURITY
--           DEFINER: 103's update policy refuses a platform admin acting for
--           an organization, on purpose, and this migration does not widen
--           it). A BEFORE guard refuses any other change to the column, on
--           INSERT (an owner's first save cannot pick 'exclusive') and on
--           UPDATE (an owner or admin of the organization cannot flip it),
--           whatever route the write came from.
--
-- AUDIT: smr_set_org_branding writes one org_audit row (from, to, actor) and
-- one org_activity line through 103's smr_structure_activity, fixed words only.
--
-- Additive: one column, one CHECK, one guard function and trigger, one setter.
-- Rollback: DROP TRIGGER org_profile_branding_guard ON org_profile;
--   DROP FUNCTION public.org_profile_branding_guard();
--   DROP FUNCTION public.smr_set_org_branding(uuid, text);
--   ALTER TABLE org_profile DROP COLUMN branding;
-- APPLY AFTER 103 (merge order 107 after 106) and BEFORE the app release that
-- reads branding. Without the column the app answers co_brand everywhere
-- (packages/core/src/orgOutboundBrand.ts), which is the safe default.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '107 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regclass('public.org_profile') IS NULL THEN
    RAISE EXCEPTION '107 needs migration 103 (org_profile) applied first';
  END IF;
  IF to_regclass('public.platform_admin') IS NULL OR to_regclass('public.org_audit') IS NULL THEN
    RAISE EXCEPTION '107 preflight: platform_admin or org_audit is missing; stop';
  END IF;
  IF to_regprocedure('public.smr_structure_activity(uuid, uuid, uuid, text, uuid, text, text)') IS NULL THEN
    RAISE NOTICE '107: smr_structure_activity (103) is not here; branding changes go to org_audit only';
  END IF;
END $$;

-- ------------------------------------------------------------------ column --
ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS branding TEXT NOT NULL DEFAULT 'co_brand';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_profile_branding_check' AND conrelid = 'public.org_profile'::regclass) THEN
    ALTER TABLE org_profile ADD CONSTRAINT org_profile_branding_check CHECK (branding IN ('co_brand', 'exclusive'));
  END IF;
END $$;

-- ------------------------------------------------------------------- guard --
-- SECURITY INVOKER on purpose (099's org_brand_guard shape): it reads
-- platform_admin, which the app role can already read. The actor is
-- app.user_id, which only the app's own session code sets.
CREATE OR REPLACE FUNCTION public.org_profile_branding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.branding IS DISTINCT FROM 'co_brand';
  ELSE
    v_changed := NEW.branding IS DISTINCT FROM OLD.branding;
  END IF;
  IF v_changed AND NOT (v_actor IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = v_actor)) THEN
    RAISE EXCEPTION 'only a platform admin can change how an organization''s outgoing work is branded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_profile_branding_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_profile_branding_guard ON org_profile;
CREATE TRIGGER org_profile_branding_guard BEFORE INSERT OR UPDATE ON org_profile
  FOR EACH ROW EXECUTE FUNCTION public.org_profile_branding_guard();

-- ------------------------------------------------------------------ setter --
-- The one way to change it. Refuses anyone who is not a platform admin (by
-- app.user_id, the same fact the guard checks), an unknown value, and an
-- organization that does not exist. Creates the profile row when the
-- organization never ran setup (setup still shows: it reads
-- setup_completed_at, not whether a row exists).
CREATE OR REPLACE FUNCTION public.smr_set_org_branding(p_org uuid, p_branding text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_before text;
  v_after text;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = v_actor) THEN
    RAISE EXCEPTION 'only a platform admin can change how an organization''s outgoing work is branded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_branding IS NULL OR p_branding NOT IN ('co_brand', 'exclusive') THEN
    RAISE EXCEPTION 'branding is co_brand or exclusive' USING ERRCODE = 'check_violation';
  END IF;
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org) THEN
    RAISE EXCEPTION 'no such organization' USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT branding INTO v_before FROM public.org_profile WHERE access_code_id = p_org;
  INSERT INTO public.org_profile (access_code_id, branding) VALUES (p_org, p_branding)
  ON CONFLICT (access_code_id) DO UPDATE SET branding = EXCLUDED.branding
  RETURNING branding INTO v_after;
  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
    VALUES ('org_profile', 'BRANDING', p_org, NULL, v_actor::text, session_user,
            jsonb_build_object('branding_from', COALESCE(v_before, 'co_brand'), 'branding_to', v_after));
    IF to_regprocedure('public.smr_structure_activity(uuid, uuid, uuid, text, uuid, text, text)') IS NOT NULL THEN
      PERFORM public.smr_structure_activity(p_org, NULL, NULL, 'org', p_org, 'updated',
        CASE v_after WHEN 'exclusive' THEN 'set outgoing reports and emails to the organization''s own name'
                     ELSE 'set outgoing reports and emails to show the organization with Steel Man Resumes' END);
    END IF;
  END IF;
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_set_org_branding(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_set_org_branding(uuid, text) TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------ after-guards --
-- Only what this file creates.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'org_profile' AND column_name = 'branding'
                    AND is_nullable = 'NO' AND column_default LIKE '''co_brand''%') THEN
    RAISE EXCEPTION '107 after: org_profile.branding is missing, nullable or not defaulted to co_brand';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_profile_branding_check' AND conrelid = 'public.org_profile'::regclass) THEN
    RAISE EXCEPTION '107 after: the branding CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'org_profile_branding_guard' AND tgrelid = 'public.org_profile'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '107 after: the branding guard trigger is missing';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.smr_set_org_branding(uuid, text)')) THEN
    RAISE EXCEPTION '107 after: smr_set_org_branding is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('public', 'public.smr_set_org_branding(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '107 after: PUBLIC can run smr_set_org_branding';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF NOT has_function_privilege('smr_app', 'public.smr_set_org_branding(uuid, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '107 after: smr_app cannot run smr_set_org_branding';
    END IF;
    IF has_table_privilege('smr_app', 'org_profile', 'DELETE') THEN
      RAISE EXCEPTION '107 after: smr_app can delete a profile';
    END IF;
  END IF;
END $$;
