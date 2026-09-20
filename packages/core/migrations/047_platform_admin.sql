-- Platform admin stops being something a redeemed code can grant.
--
-- WHAT WAS TRUE. access_code.tier allowed 'admin'. syncUserTierFromCodes copied
-- the highest redeemed code tier into users.tier. requirePlatformAdmin
-- authorizes on users.tier = 'admin'. So one row in access_code_redemption
-- could be a platform-admin grant, and the application role has full UPDATE on
-- users, so any code path that writes tier could mint an administrator.
-- Found in review of the redemption RLS plan, 2026-09-20. Production had no
-- admin-tier codes at the time (checked as owner), so nothing was exploited;
-- this closes the door rather than cleaning up after it.
--
-- WHAT IS TRUE NOW. Who is a platform admin is a row in platform_admin, which
-- the application role can READ and nothing else. users.tier stays as the
-- cached value every screen already reads, but the database keeps it honest in
-- both directions:
--   * tier = 'admin' is refused for anyone not in platform_admin;
--   * someone in platform_admin is pinned to 'admin', so a tier re-sync after
--     redeeming a partner code can no longer quietly demote them (it could).
--
-- Granting or revoking admin is done by a human with the owner credential:
--   scripts/platform-admin.mjs grant|revoke|list

CREATE TABLE IF NOT EXISTS platform_admin (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL DEFAULT session_user,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

-- Carry over the admins that exist at the moment this first runs. After the
-- trigger below exists nobody can become tier 'admin' any other way, so a
-- re-run of this statement can only re-find people already in the table.
INSERT INTO platform_admin (user_id, note)
SELECT id, 'backfilled from users.tier by migration 047'
  FROM users WHERE tier = 'admin'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.users_tier_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = NEW.id) THEN
    NEW.tier := 'admin';
  ELSIF NEW.tier = 'admin' THEN
    RAISE EXCEPTION 'tier admin requires a platform_admin row for user %', NEW.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_tier_guard ON users;
CREATE TRIGGER users_tier_guard
  BEFORE INSERT OR UPDATE OF tier ON users
  FOR EACH ROW EXECUTE FUNCTION public.users_tier_guard();

-- Keep users.tier in step when a human grants or revokes. SECURITY DEFINER is
-- not needed: only the owner can write platform_admin in the first place.
CREATE OR REPLACE FUNCTION public.platform_admin_sync_tier() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.users SET tier = 'admin' WHERE id = NEW.user_id;
    RETURN NEW;
  END IF;
  -- Revoked: fall to 'client'. The next tier sync lifts them to whatever
  -- their redeemed codes actually entitle them to.
  UPDATE public.users SET tier = 'client' WHERE id = OLD.user_id AND tier = 'admin';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS platform_admin_sync_tier ON platform_admin;
CREATE TRIGGER platform_admin_sync_tier
  AFTER INSERT OR DELETE ON platform_admin
  FOR EACH ROW EXECUTE FUNCTION public.platform_admin_sync_tier();

-- Codes can no longer carry 'admin'. Refuse loudly if one exists rather than
-- rewriting somebody's entitlement inside a migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM access_code WHERE tier = 'admin') THEN
    RAISE EXCEPTION 'an access_code with tier admin exists; retire it by hand before applying 047';
  END IF;
  ALTER TABLE access_code DROP CONSTRAINT IF EXISTS access_code_tier_check;
  ALTER TABLE access_code ADD CONSTRAINT access_code_tier_check
    CHECK (tier IN ('client', 'partner', 'unlimited'));
END $$;

-- The application reads this table and never writes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON platform_admin FROM smr_app;
    GRANT SELECT ON platform_admin TO smr_app;
  END IF;
END $$;
