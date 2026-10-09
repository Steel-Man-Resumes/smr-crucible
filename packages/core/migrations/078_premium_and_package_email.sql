-- 078_premium_and_package_email.sql
-- Two additive parts (lane 3a, Part 2):
--   1. Premium tools come by entitlement, never by payment.
--   2. users.forge_package_email: whether a finished Forge package is emailed
--      to the person's own proven address (default yes; they can turn it off),
--      and forge_package_email_sent: one automatic send per finished version.
--   3. users.email_proof_source: HOW the inbox was proven (security review 3a
--      Part 2 r1, M2). 068 backfilled email_proven_at on every older account,
--      typed addresses included; the automatic email needs a real proof.
--   4. tablet_session: a wrong-PIN count and lock, and single-use imports
--      (security review 3a Part 2 r1, M1 and L4).
--
-- PART 1. Premium tools.
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
-- Applying this locks nothing by itself: the app's gate is off until the
-- deployment sets PREMIUM_GATE=on (apps/consumer/lib/premium.ts).
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
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS pin_failures;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS locked_at;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS imported_at;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS imported_by;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS import_saved_at;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS unlocked_at;
--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS unlocked_by;
--   ALTER TABLE users DROP COLUMN IF EXISTS email_proof_source;
--   DROP TABLE IF EXISTS forge_package_email_sent;
--   ALTER TABLE users DROP COLUMN IF EXISTS forge_package_email;
--   DELETE FROM _migrations WHERE filename = '078_premium_and_package_email.sql';

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

-- PART 2. The finished-package email preference.
--
-- When someone finishes in the Forge (finished, not a draft), their package
-- is emailed to their own account address, only once that address is proven
-- (users.email_proven_at, 068). This is the person's on/off switch. Default
-- on, so the finish page can say "We sent it to you@example.com." Nothing else
-- reads it, and no other email depends on it. Old code ignores it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS forge_package_email BOOLEAN NOT NULL DEFAULT true;

-- One automatic send per finished version. A row says "this finished resume
-- was already emailed to this person": the sender claims the row before it
-- sends (the primary key makes the claim atomic, so two tabs cannot both send)
-- and gives it back if the send does not go out. `version` is a SHA-256 of
-- the person's id and the finished resume text, never the text itself.
CREATE TABLE IF NOT EXISTS forge_package_email_sent (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version  TEXT NOT NULL CHECK (version ~ '^[0-9a-f]{64}$'),
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

-- The person's own rows only (059's owner rule). No admin reads: nobody needs
-- to know which resumes were emailed. Deleting an account cascades.
ALTER TABLE forge_package_email_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge_package_email_sent FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_package_email_sent_select ON forge_package_email_sent;
CREATE POLICY forge_package_email_sent_select ON forge_package_email_sent FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS forge_package_email_sent_insert ON forge_package_email_sent;
CREATE POLICY forge_package_email_sent_insert ON forge_package_email_sent FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS forge_package_email_sent_delete ON forge_package_email_sent;
CREATE POLICY forge_package_email_sent_delete ON forge_package_email_sent FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DO $$
BEGIN
  REVOKE ALL ON forge_package_email_sent FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON forge_package_email_sent FROM smr_app;
    -- No UPDATE: a row is claimed or given back, never changed.
    GRANT SELECT, INSERT, DELETE ON forge_package_email_sent TO smr_app;
  END IF;
END $$;

-- PART 3. How the inbox was proven.
--
-- 068 set email_proven_at = now() on EVERY account that existed then, because
-- there was no record of how they signed in. That includes accounts made with
-- a password and a typed address nobody ever proved. That was fine for the
-- question 068 answers (whether to ask "keep your password?"), but not as
-- permission to email someone's finished resume by itself.
--
-- email_proof_source is set ONLY by a real inbox proof: an email-link sign-in,
-- a Google sign-in whose address Google verified, or a password reset by
-- email (apps/consumer/lib/email-proof.ts). The automatic package email needs
-- it. NULL means "no proof on record", whatever email_proven_at says.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_proof_source TEXT
  CHECK (email_proof_source IS NULL OR email_proof_source IN ('email_link', 'google', 'password_reset', 'recorded'));

-- Proofs recorded between 068 and this migration were real: every account
-- that existed at 068 got the same backfill instant, which is 068's
-- _migrations.applied_at when the migration runner applied it (it inserts
-- that row in the same transaction). A proof more than a minute after that
-- instant came from a sign-in, so it is kept as 'recorded'.
--
-- FAIL-SAFE (security review 3a Part 2 r2, N1): the ledger time is trusted
-- only when it IS a backfill instant, i.e. some account's email_proven_at
-- equals it exactly. A 068 run by hand, a ledger row written before or after
-- the backfill, or a zone-less applied_at all fail that test, and then
-- nothing is marked. Everything not marked stays NULL, which only means the
-- person is asked to confirm their address once before the first automatic
-- email. Run migrations/dry-run/078_proof_source_preflight.sql (read-only)
-- first to see which case a database is in.
DO $$
DECLARE backfill_at TIMESTAMPTZ;
BEGIN
  IF to_regclass('public._migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = '_migrations' AND column_name = 'applied_at') THEN
    SELECT applied_at INTO backfill_at FROM _migrations WHERE filename = '068_email_proven.sql';
    IF backfill_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM users WHERE email_proven_at = backfill_at) THEN
      UPDATE users SET email_proof_source = 'recorded'
       WHERE email_proof_source IS NULL
         AND email_proven_at IS NOT NULL
         AND email_proven_at > backfill_at + interval '1 minute';
    END IF;
  END IF;
END $$;

-- PART 4. Mini Forge plans: a wrong-PIN lock, and single-use imports.
--
-- pin_failures counts wrong PINs in total (the import page and the confirm
-- step). At 5 the app sets locked_at, and the plan opens again only when an
-- admin clears it; unlocked_at / unlocked_by record who did that, and when.
-- imported_at / imported_by mark the one account a plan was loaded into;
-- after that it never loads into another (the same account may finish its
-- own interrupted import). import_saved_at is set the moment the plan was
-- actually saved into that account: from then on the claim is never released
-- or given back, by anyone, for any reason (security review 3a Part 2 r3,
-- R3-1). Old code ignores all seven.
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS pin_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS import_saved_at TIMESTAMPTZ;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS unlocked_by UUID REFERENCES users(id) ON DELETE SET NULL;
