-- 078_premium_access.sql
-- Premium tools come by entitlement, never by payment (lane 3a, Part 2).
--
-- Troy's rule (locked): individuals never pay. The premium tools (local
-- resources, interview coaching, one-click apply) open for a person when
--   (a) they belong to a sponsoring organization: an active, unexpired access
--       code they redeemed (the existing access_code / redemption model, no
--       change here), or
--   (b) Troy grants it, case by case, from the admin side: a reason is
--       required, an end date is optional.
-- A locked tool says how to get it ("Ask your organization" or "Ask SMR for
-- access"). Asking files a row Troy sees in admin. It sends no email.
--
-- WHAT THIS ADDS (additive only; nothing existing changes)
--   premium_grant           one row per grant. Revoked, never deleted by the
--                           app. A grant names which premium tools it opens.
--   premium_access_request  "Ask SMR for access": one open request per person.
--
-- THE TOOL NAMES ARE AN ALLOWLIST, here and in packages/core/src/premium.ts.
-- A CHECK keeps any other string out of the table, and the code filters what
-- it reads against its own list too, so a stale or tampered value can never
-- open something the code does not define.
--
-- ROW-LEVEL SECURITY, the shapes the org model already uses:
--   * a person reads their OWN grants and requests (059's owner rule);
--   * a platform admin (platform_admin, 047) reads all, makes grants, revokes
--     them, and closes requests (071's admin rule);
--   * a person may file a request for themself, open, and nothing else;
--   * nobody may delete through the app role, and a written grant or request
--     can only move forward (revoke once; close once). Triggers enforce it.
-- Cascades from deleting a user are referential actions and are not subject
-- to these policies, so account deletion keeps working.
--
-- ROLLBACK (no data anyone else depends on; the code treats a missing table
-- as "no grants", so roll the code back first only if you want the admin
-- screen gone too):
--   DROP TABLE IF EXISTS premium_grant;
--   DROP TABLE IF EXISTS premium_access_request;
--   DROP FUNCTION IF EXISTS public.premium_grant_guard();
--   DROP FUNCTION IF EXISTS public.premium_request_guard();
--   DELETE FROM _migrations WHERE filename = '078_premium_access.sql';

CREATE TABLE IF NOT EXISTS premium_access_request (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool        TEXT NOT NULL CHECK (tool IN ('resources', 'interview_coaching', 'one_click_apply')),
  -- The person's own words, optional and short.
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'granted', 'declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at  TIMESTAMPTZ,
  handled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT premium_request_handled_together
    CHECK ((status = 'open') = (handled_at IS NULL))
);

-- One open request per person: asking twice adds nothing.
CREATE UNIQUE INDEX IF NOT EXISTS premium_access_request_one_open
  ON premium_access_request (user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_premium_access_request_status
  ON premium_access_request (status, created_at DESC);

CREATE TABLE IF NOT EXISTS premium_grant (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tools       TEXT[] NOT NULL DEFAULT ARRAY['resources', 'interview_coaching', 'one_click_apply']
                CHECK (cardinality(tools) BETWEEN 1 AND 3
                       AND tools <@ ARRAY['resources', 'interview_coaching', 'one_click_apply']),
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  ends_at     TIMESTAMPTZ,
  granted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The request this grant answered, if any.
  request_id  UUID REFERENCES premium_access_request(id) ON DELETE SET NULL,
  CONSTRAINT premium_grant_ends_after_start CHECK (ends_at IS NULL OR ends_at > granted_at)
);

CREATE INDEX IF NOT EXISTS idx_premium_grant_user
  ON premium_grant (user_id) WHERE revoked_at IS NULL;

-- A grant is written once. The only later changes are a revoke (once), and a
-- link going to NULL when the linked account or request is deleted (the
-- ON DELETE SET NULL actions above).
CREATE OR REPLACE FUNCTION public.premium_grant_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tools IS DISTINCT FROM OLD.tools
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR (NEW.granted_by IS DISTINCT FROM OLD.granted_by AND NEW.granted_by IS NOT NULL)
     OR (NEW.request_id IS DISTINCT FROM OLD.request_id AND NEW.request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a premium grant is written once; revoke it and grant again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
    -- Not a revoke: only a link going to NULL.
    IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by AND NEW.revoked_by IS NOT NULL THEN
      RAISE EXCEPTION 'the only change to a grant is a revoke' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'this grant is already revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS premium_grant_guard ON premium_grant;
CREATE TRIGGER premium_grant_guard BEFORE UPDATE ON premium_grant
  FOR EACH ROW EXECUTE FUNCTION public.premium_grant_guard();

-- A request is closed once (granted or declined); what the person asked stays
-- as asked. handled_by may go to NULL when that admin's account is deleted.
CREATE OR REPLACE FUNCTION public.premium_request_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tool IS DISTINCT FROM OLD.tool
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'what the person asked is kept as asked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status AND NEW.handled_at IS NOT DISTINCT FROM OLD.handled_at THEN
    IF NEW.handled_by IS DISTINCT FROM OLD.handled_by AND NEW.handled_by IS NOT NULL THEN
      RAISE EXCEPTION 'a request is closed once' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'this request is already closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS premium_request_guard ON premium_access_request;
CREATE TRIGGER premium_request_guard BEFORE UPDATE ON premium_access_request
  FOR EACH ROW EXECUTE FUNCTION public.premium_request_guard();

-- Row-level security.
ALTER TABLE premium_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE premium_access_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_access_request FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS premium_grant_select ON premium_grant;
CREATE POLICY premium_grant_select ON premium_grant FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  );

-- Only a platform admin grants, and the grant names that admin.
DROP POLICY IF EXISTS premium_grant_insert ON premium_grant;
CREATE POLICY premium_grant_insert ON premium_grant FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND granted_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND revoked_at IS NULL
    AND revoked_by IS NULL
  );

-- Only a platform admin revokes, and the revoke names that admin.
DROP POLICY IF EXISTS premium_grant_update ON premium_grant;
CREATE POLICY premium_grant_update ON premium_grant FOR UPDATE
  USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (
    EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND revoked_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

DROP POLICY IF EXISTS premium_request_select ON premium_access_request;
CREATE POLICY premium_request_select ON premium_access_request FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  );

-- A person asks for themself, and the request starts open.
DROP POLICY IF EXISTS premium_request_insert ON premium_access_request;
CREATE POLICY premium_request_insert ON premium_access_request FOR INSERT
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND status = 'open'
    AND handled_at IS NULL
    AND handled_by IS NULL
  );

-- Only a platform admin closes a request, and the close names that admin.
DROP POLICY IF EXISTS premium_request_update ON premium_access_request;
CREATE POLICY premium_request_update ON premium_access_request FOR UPDATE
  USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (
    EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND handled_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

-- The person's own "delete my data" removes what they asked (their words).
DROP POLICY IF EXISTS premium_request_delete ON premium_access_request;
CREATE POLICY premium_request_delete ON premium_access_request FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DO $$
BEGIN
  REVOKE ALL ON premium_grant, premium_access_request FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON premium_grant, premium_access_request FROM smr_app;
    -- No DELETE on grants: a grant is revoked, never erased by the app.
    GRANT SELECT, INSERT, UPDATE ON premium_grant TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON premium_access_request TO smr_app;
  END IF;
END $$;
