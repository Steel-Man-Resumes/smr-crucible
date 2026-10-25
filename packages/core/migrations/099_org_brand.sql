-- Organization brand: the logo and the branding tier (C3 brand, 2026-10-25).
--
-- WHY A TABLE, AND WHY THE BYTES LIVE IN IT.
--   access_code.org_logo_url (023) renders an arbitrary external URL in an
--   <img>: a tracking pixel and a mixed-content risk, and nothing ever wrote
--   it. It stays in place, unread by new code. secure_object is owned by ONE
--   user and cascades on that user's deletion (037), which would delete an
--   organization's logo the day the person who uploaded it leaves. So the
--   bytes sit here, keyed by the organization, and are served only by the app
--   route GET /api/org/brand/{orgId}/logo to people who belong to it. Never a
--   URL. Never SVG (SVG can carry script): PNG, JPEG or WebP, 512 KB at most.
--
-- WHO MAY DO WHAT, AS DATABASE FACTS (not only route checks):
--   read     the organization's own scope (staff, admins, the owner, and a
--            platform admin acting on it through runScoped), any member who
--            joined with the code (access_code_redemption), any staff row,
--            the owner by partner_user_id, and a platform admin.
--   logo     only the organization's OWNER (access_code.partner_user_id), and
--            never a platform admin acting for them.
--   tier     only a platform admin. Tier is what Steel Man sells, so the
--            owner cannot change it, not even on first insert.
--   delete   nobody through the app (no grant). Removing a logo clears the
--            logo columns and keeps the row, so the tier survives.
--
-- AUDIT: an AFTER trigger writes org_audit for logo set, logo removed and tier
-- changed. Never the bytes: only the size, the type and the first 12 hex of
-- the sha256.
--
-- Additive: one table, two functions, two triggers, policies on the new table
-- only. Rollback: DROP TABLE org_brand CASCADE; DROP FUNCTION
-- public.org_brand_guard(); DROP FUNCTION public.org_brand_audit();
-- APPLY BEFORE THE APP RELEASE that ships the brand routes (they read this
-- table; without it every org mark falls back to the monogram).
SET LOCAL lock_timeout = '5s';

-- org_audit is FORCE RLS with no INSERT policy, so the audit trigger's owner
-- must bypass RLS. Without this guard a wrong owner would make every logo
-- write abort inside the trigger.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '099 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS org_brand (
  access_code_id UUID PRIMARY KEY REFERENCES access_code(id) ON DELETE CASCADE,
  logo           BYTEA CHECK (logo IS NULL OR octet_length(logo) BETWEEN 1 AND 524288),
  logo_mime      TEXT CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_sha256    TEXT CHECK (logo_sha256 IS NULL OR logo_sha256 ~ '^[0-9a-f]{64}$'),
  logo_bytes     INT CHECK (logo_bytes IS NULL OR logo_bytes BETWEEN 1 AND 524288),
  tier           TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'cobrand', 'full')),
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- All four logo columns together, or none: a half-set logo cannot exist.
  CONSTRAINT org_brand_logo_whole CHECK (
    (logo IS NULL AND logo_mime IS NULL AND logo_sha256 IS NULL AND logo_bytes IS NULL)
    OR (logo IS NOT NULL AND logo_mime IS NOT NULL AND logo_sha256 IS NOT NULL AND logo_bytes = octet_length(logo)))
);

-- BEFORE guard: who may change which columns. SECURITY INVOKER on purpose: it
-- reads access_code and platform_admin, which the app role can already read.
CREATE OR REPLACE FUNCTION public.org_brand_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_is_owner boolean;
  v_is_admin boolean;
  v_logo_changed boolean;
  v_tier_changed boolean;
BEGIN
  v_is_owner := v_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = v_actor);
  v_is_admin := v_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_admin pa WHERE pa.user_id = v_actor);
  IF TG_OP = 'INSERT' THEN
    v_logo_changed := NEW.logo IS NOT NULL;
    v_tier_changed := NEW.tier <> 'standard';
  ELSE
    IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id THEN
      RAISE EXCEPTION 'an organization brand cannot move to another organization' USING ERRCODE = 'check_violation';
    END IF;
    v_logo_changed := NEW.logo_sha256 IS DISTINCT FROM OLD.logo_sha256 OR NEW.logo_mime IS DISTINCT FROM OLD.logo_mime
                      OR NEW.logo_bytes IS DISTINCT FROM OLD.logo_bytes OR (NEW.logo IS NULL) <> (OLD.logo IS NULL);
    v_tier_changed := NEW.tier IS DISTINCT FROM OLD.tier;
  END IF;
  IF v_logo_changed AND NOT v_is_owner THEN
    RAISE EXCEPTION 'only the organization owner can change its logo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_tier_changed AND NOT v_is_admin THEN
    RAISE EXCEPTION 'only a platform admin can change the branding tier' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_by := v_actor;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_brand_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_brand_guard ON org_brand;
CREATE TRIGGER org_brand_guard
  BEFORE INSERT OR UPDATE ON org_brand
  FOR EACH ROW EXECUTE FUNCTION public.org_brand_guard();

-- AFTER audit: SECURITY DEFINER because the app role cannot write org_audit.
CREATE OR REPLACE FUNCTION public.org_brand_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor text := NULLIF(current_setting('app.user_id', true), '');
  v_diff  jsonb := '{}'::jsonb;
  v_org   uuid := COALESCE(NEW.access_code_id, OLD.access_code_id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_diff := jsonb_build_object('brand_removed', true, 'had_logo', OLD.logo IS NOT NULL, 'tier_was', OLD.tier);
  ELSE
    IF NEW.logo_sha256 IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.logo_sha256 END) THEN
      IF NEW.logo_sha256 IS NULL THEN
        v_diff := v_diff || jsonb_build_object('logo', 'removed');
      ELSE
        v_diff := v_diff || jsonb_build_object('logo', 'set', 'logo_mime', NEW.logo_mime,
                                               'logo_bytes', NEW.logo_bytes, 'logo_sha256_prefix', left(NEW.logo_sha256, 12));
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.tier <> 'standard' THEN
      v_diff := v_diff || jsonb_build_object('tier_to', NEW.tier);
    ELSIF TG_OP = 'UPDATE' AND NEW.tier IS DISTINCT FROM OLD.tier THEN
      v_diff := v_diff || jsonb_build_object('tier_from', OLD.tier, 'tier_to', NEW.tier);
    END IF;
  END IF;
  IF v_diff <> '{}'::jsonb THEN
    INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
    VALUES ('org_brand', TG_OP, v_org, NULL, v_actor, session_user, v_diff);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_brand_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_brand_audit ON org_brand;
CREATE TRIGGER org_brand_audit
  AFTER INSERT OR UPDATE OR DELETE ON org_brand
  FOR EACH ROW EXECUTE FUNCTION public.org_brand_audit();

ALTER TABLE org_brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_brand FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_brand_select ON org_brand;
CREATE POLICY org_brand_select ON org_brand FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR EXISTS (SELECT 1 FROM access_code_redemption r
              WHERE r.access_code_id = org_brand.access_code_id
                AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM org_staff s
              WHERE s.access_code_id = org_brand.access_code_id
                AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM access_code a
              WHERE a.id = org_brand.access_code_id
                AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM platform_admin pa
              WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

-- Writes: the owner (logo) or a platform admin (tier). The guard trigger then
-- decides which columns each may touch.
DROP POLICY IF EXISTS org_brand_insert ON org_brand;
CREATE POLICY org_brand_insert ON org_brand FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM access_code a
           WHERE a.id = org_brand.access_code_id
             AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM platform_admin pa
              WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS org_brand_update ON org_brand;
CREATE POLICY org_brand_update ON org_brand FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM access_code a
             WHERE a.id = org_brand.access_code_id
               AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM platform_admin pa
                WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (
    EXISTS (SELECT 1 FROM access_code a
             WHERE a.id = org_brand.access_code_id
               AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM platform_admin pa
                WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_brand FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON org_brand TO smr_app;
  END IF;
END $$;
