-- 100_org_lifecycle_invites.sql
-- Organization lifecycle and staff invitations (house build 2026-10-26, lane L1).
--
-- 1. CLOSE, REOPEN, RENAME, DELETE AN ORGANIZATION.
--    An organization is its access_code row. "Closed" is is_active = false,
--    which every resolver already honors (staff of a closed organization reach
--    nothing in it, new joins are refused). Until now nothing recorded WHEN,
--    BY WHOM or WHY, and nothing in the product could close or reopen one.
--    access_code gains closed_at, closed_by and close_reason. A BEFORE UPDATE
--    trigger keeps them true to is_active whatever path writes it (the admin
--    screen, the retire script, a console session): turning an organization
--    off stamps closed_at and the actor, turning it on clears all three.
--    Members keep their accounts and their own work; staff lose the workspace
--    for that organization; every note, task and outcome stays.
--    Delete exists only for an organization with no history at all
--    (smr_admin_delete_org): not one member, staff row, invite, note, task,
--    outcome, sharing row or audited change. Anything else is closed, never
--    deleted, because a real relationship's record is not ours to erase.
--
-- 2. STAFF INVITATIONS WITH A LIFECYCLE (org_staff_invite).
--    Staff invites used to be an org_staff row with invited_at: no expiry, no
--    resend, no revoke but "Remove", no record of how many times the email
--    went out, and an address that already had an account was refused with
--    "contact us". This table is the staff invitation ledger: one row per
--    invitation, with send count, last sent, a 14-day expiry, accepted,
--    declined and revoked (with who revoked). Status is derived from those
--    stamps (packages/core/src/staffInvites.ts staffInviteStatus).
--    It is a table of its own, not more columns on org_invite: org_invite is
--    the PARTICIPANT ledger, keyed UNIQUE (access_code_id, user_id) with
--    ON CONFLICT targets the seat and offer flows depend on (096), so a staff
--    invitation for someone who is also a participant would collide with it.
--
--    Three paths, recorded in `path` (never shown to the organization):
--      new_account       an address with no account: a shell account is made
--                        so the emailed sign-in link works, and NOTHING else.
--                        The person lands on /dashboard/invites and accepts
--                        (smr_answer_staff_invite), exactly like an existing
--                        account. No org_staff row exists before that yes, so
--                        an expired, revoked or declined invitation grants
--                        nothing on any later sign-in (security review B2).
--      existing_account  an address that already has an account, invited by
--                        the owner or an admin: nothing is attached until the
--                        person signs in and accepts.
--                        Both paths look the same to the organization (status,
--                        counts, places, answers), so the screen never says
--                        whether an address has an account (review B1).
--      admin_added       a platform admin attached an existing account
--                        directly, from Admin > Organizations (support path).
--
-- WHO MAY DO WHAT, AS DATABASE FACTS:
--   read      the organization's own scope (app.org_id), and the invitee their
--             own invitations (app.user_id), so the accept page can list them.
--   insert    org scope only. The guard trigger stamps invited_by from
--             app.user_id, refuses an admin-role invitation unless the actor
--             owns the organization or is a platform admin, and keeps
--             capability_denies inside the delegable list. A staff invitation
--             can only RESTRICT (denies), never grant.
--   update    org scope, and only send_count, last_sent_at, expires_at and
--             revoked_at: the guard trigger refuses any change to who, where,
--             what role or how it was made, and refuses accepted_at and
--             declined_at unless the writer is the SECURITY DEFINER answer
--             function (an owner with BYPASSRLS; the app role never is). A
--             trigger rather than column grants, because the blanket grant
--             after a fresh CI database (scripts/lib/restricted-grants.mjs)
--             works per table, so a column grant would silently widen there.
--             An answered or revoked invitation is final. revoked_by is
--             stamped from app.user_id.
--   delete    nobody through the app (no grant).
--
-- AUDIT: an AFTER trigger writes org_audit for every insert and update, with
-- role, path, send count and the state stamps. Never the email address or the
-- typed name. A rename and a close write their own org_audit row from the
-- access_code lifecycle trigger (name from and to; whether a reason was given,
-- never the reason text, because org_audit is readable by the organization's
-- staff and a close reason is the platform's note).
--
-- Additive: three columns, one table, five functions, five triggers, policies
-- on the new table only. No existing policy changes.
-- Rollback: DROP TABLE org_staff_invite CASCADE;
--   DROP FUNCTION public.smr_answer_staff_invite(uuid, boolean);
--   DROP FUNCTION public.smr_admin_org_history(uuid);
--   DROP FUNCTION public.smr_admin_delete_org(uuid, text);
--   DROP TRIGGER access_code_lifecycle_sync ON access_code; DROP FUNCTION public.access_code_lifecycle_sync();
--   DROP TRIGGER access_code_lifecycle_audit ON access_code; DROP FUNCTION public.access_code_lifecycle_audit();
--   ALTER TABLE access_code DROP COLUMN closed_at, DROP COLUMN closed_by, DROP COLUMN close_reason;
-- APPLY BEFORE THE APP RELEASE that ships the admin lifecycle actions and the
-- staff invitation list: the app reads these columns and this table.
SET LOCAL lock_timeout = '5s';

-- org_audit is FORCE RLS with no INSERT policy, so the audit triggers' owner
-- and the definer functions' owner must bypass RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '100 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

-- ---------------------------------------------------- 1. access_code lifecycle --

ALTER TABLE access_code ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE access_code ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE access_code ADD COLUMN IF NOT EXISTS close_reason TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_code_close_reason_len') THEN
    ALTER TABLE access_code ADD CONSTRAINT access_code_close_reason_len
      CHECK (close_reason IS NULL OR char_length(close_reason) <= 500);
  END IF;
END $$;

-- Organizations closed before this migration have no closed_at. They stay
-- that way (we do not know when they closed); the screen says "closed" and
-- shows a date only when one was recorded.

-- BEFORE UPDATE: keep the stamps true to is_active on every write path.
CREATE OR REPLACE FUNCTION public.access_code_lifecycle_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF NEW.is_active AND NOT OLD.is_active THEN
    -- Reopened: the closed stamps describe a state that no longer holds.
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
    NEW.close_reason := NULL;
  ELSIF NOT NEW.is_active AND OLD.is_active THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.closed_by := COALESCE(NEW.closed_by, v_actor);
  ELSIF NEW.is_active THEN
    -- An open organization carries no close stamps.
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
    NEW.close_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.access_code_lifecycle_sync() FROM PUBLIC;

DROP TRIGGER IF EXISTS access_code_lifecycle_sync ON access_code;
CREATE TRIGGER access_code_lifecycle_sync
  BEFORE UPDATE ON access_code
  FOR EACH ROW EXECUTE FUNCTION public.access_code_lifecycle_sync();

-- AFTER UPDATE: rename and close details. The 097 trigger already records
-- is_active_to; this one adds the name change and whether a reason was given.
-- A separate function so 097's stays as it is.
CREATE OR REPLACE FUNCTION public.access_code_lifecycle_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor text := NULLIF(current_setting('app.user_id', true), '');
  v_diff  jsonb := '{}'::jsonb;
BEGIN
  IF NEW.partner_name IS DISTINCT FROM OLD.partner_name THEN
    v_diff := v_diff || jsonb_build_object('name_from', OLD.partner_name, 'name_to', NEW.partner_name);
  END IF;
  IF NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.close_reason IS DISTINCT FROM OLD.close_reason THEN
    v_diff := v_diff || jsonb_build_object('closed', NEW.closed_at IS NOT NULL,
                                           'reason_given', NEW.close_reason IS NOT NULL AND NEW.close_reason <> '');
  END IF;
  IF v_diff <> '{}'::jsonb THEN
    INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
    VALUES ('access_code', 'UPDATE', NEW.id, NULL, v_actor, session_user, v_diff);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_code_lifecycle_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS access_code_lifecycle_audit ON access_code;
CREATE TRIGGER access_code_lifecycle_audit
  AFTER UPDATE ON access_code
  FOR EACH ROW EXECUTE FUNCTION public.access_code_lifecycle_audit();

-- ------------------------------------------------------- 2. org_staff_invite --

CREATE TABLE IF NOT EXISTS org_staff_invite (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id    UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email     TEXT NOT NULL CHECK (char_length(invited_email) BETWEEN 3 AND 254),
  invited_name      TEXT CHECK (invited_name IS NULL OR char_length(invited_name) <= 200),
  role              TEXT NOT NULL CHECK (role IN ('org_admin', 'staff')),
  title             TEXT CHECK (title IS NULL OR char_length(title) <= 120),
  -- Capabilities this person starts WITHOUT (a preset such as volunteer).
  -- Only ever restrictions: an invitation cannot grant anything.
  capability_denies TEXT[] NOT NULL DEFAULT '{}',
  path              TEXT NOT NULL CHECK (path IN ('new_account', 'existing_account', 'admin_added')),
  invited_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Emails that actually went out. 0 = saved, never sent.
  send_count        INT NOT NULL DEFAULT 0 CHECK (send_count >= 0 AND send_count <= 1000),
  last_sent_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at       TIMESTAMPTZ,
  declined_at       TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  -- One ending at most.
  CONSTRAINT org_staff_invite_one_ending CHECK (
    (accepted_at IS NOT NULL)::int + (declined_at IS NOT NULL)::int + (revoked_at IS NOT NULL)::int <= 1)
);

-- One open invitation per person per organization.
CREATE UNIQUE INDEX IF NOT EXISTS org_staff_invite_open_one
  ON org_staff_invite (access_code_id, user_id)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_staff_invite_org ON org_staff_invite (access_code_id, invited_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_staff_invite_user ON org_staff_invite (user_id);

-- BEFORE guard. SECURITY INVOKER on purpose: it reads access_code,
-- platform_admin and smr_delegable_capabilities(), which the app role can.
CREATE OR REPLACE FUNCTION public.org_staff_invite_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_privileged boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'a staff invitation needs an actor' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.invited_by := v_actor;
    NEW.invited_at := now();
    NEW.accepted_at := CASE WHEN NEW.path = 'admin_added' THEN now() ELSE NULL END;
    NEW.declined_at := NULL;
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
    v_privileged := EXISTS (SELECT 1 FROM access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = v_actor)
                    OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = v_actor);
    IF NEW.role = 'org_admin' AND NOT v_privileged THEN
      RAISE EXCEPTION 'only the owner can invite an admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.path = 'admin_added' AND NOT EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = v_actor) THEN
      RAISE EXCEPTION 'only a platform admin adds an existing account directly' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (NEW.capability_denies <@ public.smr_delegable_capabilities()) THEN
      RAISE EXCEPTION 'an invitation can only hold delegable capabilities' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at > now() + interval '14 days' + interval '1 minute' THEN
      NEW.expires_at := now() + interval '14 days';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.accepted_at IS NOT NULL OR OLD.declined_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'that invitation is already closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
     OR NEW.invited_name IS DISTINCT FROM OLD.invited_name OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.capability_denies IS DISTINCT FROM OLD.capability_denies
     OR NEW.path IS DISTINCT FROM OLD.path OR NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
    RAISE EXCEPTION 'an invitation''s person, organization, role and origin cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Accepting and declining belong to the invitee, through
  -- smr_answer_staff_invite (SECURITY DEFINER, owned by a BYPASSRLS role).
  -- The app role holds no BYPASSRLS, so it can never write these itself.
  IF (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.declined_at IS DISTINCT FROM OLD.declined_at)
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'only the invited person answers an invitation' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A resend by someone else, when the original inviter can no longer
  -- invite, makes the resender the inviter of record: only ever to the actor,
  -- and an admin-role invitation only to the owner or a platform admin.
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    IF v_actor IS NULL OR NEW.invited_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'the inviter of record can only become the person acting' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.role = 'org_admin' AND NOT (
         EXISTS (SELECT 1 FROM access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = v_actor)
      OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = v_actor)) THEN
      RAISE EXCEPTION 'only the owner can send an admin invitation' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
    NEW.revoked_by := v_actor;
  ELSE
    NEW.revoked_by := NULL;
  END IF;
  -- A resend may renew the 14 days, never stretch past them.
  IF NEW.expires_at > now() + interval '14 days' + interval '1 minute' THEN
    NEW.expires_at := now() + interval '14 days';
  END IF;
  IF NEW.send_count < OLD.send_count THEN
    RAISE EXCEPTION 'the send count only goes up' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_staff_invite_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_staff_invite_guard ON org_staff_invite;
CREATE TRIGGER org_staff_invite_guard
  BEFORE INSERT OR UPDATE ON org_staff_invite
  FOR EACH ROW EXECUTE FUNCTION public.org_staff_invite_guard();

-- AFTER audit. Never the address or the typed name.
CREATE OR REPLACE FUNCTION public.org_staff_invite_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
  VALUES ('org_staff_invite', TG_OP, NEW.access_code_id, NEW.user_id,
          NULLIF(current_setting('app.user_id', true), ''), session_user,
          jsonb_strip_nulls(jsonb_build_object(
            'invite_id', NEW.id, 'role', NEW.role, 'path', NEW.path, 'send_count', NEW.send_count,
            'expires_at', NEW.expires_at,
            'accepted', CASE WHEN NEW.accepted_at IS NOT NULL THEN true END,
            'declined', CASE WHEN NEW.declined_at IS NOT NULL THEN true END,
            'revoked', CASE WHEN NEW.revoked_at IS NOT NULL THEN true END,
            'denies', CASE WHEN cardinality(NEW.capability_denies) > 0 THEN to_jsonb(NEW.capability_denies) END)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_staff_invite_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS org_staff_invite_audit ON org_staff_invite;
CREATE TRIGGER org_staff_invite_audit
  AFTER INSERT OR UPDATE ON org_staff_invite
  FOR EACH ROW EXECUTE FUNCTION public.org_staff_invite_audit();

ALTER TABLE org_staff_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_staff_invite FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_staff_invite_select ON org_staff_invite;
CREATE POLICY org_staff_invite_select ON org_staff_invite FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS org_staff_invite_insert ON org_staff_invite;
CREATE POLICY org_staff_invite_insert ON org_staff_invite FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS org_staff_invite_update ON org_staff_invite;
CREATE POLICY org_staff_invite_update ON org_staff_invite FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_staff_invite FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON org_staff_invite TO smr_app;
  END IF;
END $$;

-- --------------------------------------------- 3. accept or decline (invitee) --
-- The person answering is app.user_id, never a parameter. Returns one word:
-- ok, declined, not_found, revoked, expired, answered, closed, inviter_gone,
-- full, refused. On accept: the org_staff row and the invitation's restrictions
-- (capability_denies, as deny overrides) are written in ONE transaction, so a
-- volunteer never exists for a moment with the full staff bundle.
CREATE OR REPLACE FUNCTION public.smr_answer_staff_invite(p_invite uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  i public.org_staff_invite%ROWTYPE;
  v_org public.access_code%ROWTYPE;
  v_inviter_ok boolean;
  v_cap text;
BEGIN
  IF v_user IS NULL OR p_invite IS NULL OR p_accept IS NULL THEN RETURN 'refused'; END IF;
  SELECT * INTO i FROM public.org_staff_invite WHERE id = p_invite FOR UPDATE;
  IF NOT FOUND OR i.user_id <> v_user THEN RETURN 'not_found'; END IF;
  IF i.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  IF i.accepted_at IS NOT NULL OR i.declined_at IS NOT NULL THEN RETURN 'answered'; END IF;
  IF i.expires_at <= now() THEN RETURN 'expired'; END IF;

  IF NOT p_accept THEN
    UPDATE public.org_staff_invite SET declined_at = now() WHERE id = i.id;
    RETURN 'declined';
  END IF;

  -- The organization row is locked so a close or delete cannot pass this.
  SELECT * INTO v_org FROM public.access_code WHERE id = i.access_code_id FOR UPDATE;
  IF NOT FOUND OR NOT v_org.is_active THEN RETURN 'closed'; END IF;

  -- Whoever invited must still be able to: the owner, an org admin of this
  -- organization, or a platform admin; for an admin role, the owner or a
  -- platform admin only.
  v_inviter_ok := i.invited_by IS NOT NULL AND (
       v_org.partner_user_id = i.invited_by
    OR EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = i.invited_by)
    OR (i.role <> 'org_admin' AND EXISTS (SELECT 1 FROM public.org_staff s
                                            WHERE s.access_code_id = i.access_code_id
                                              AND s.user_id = i.invited_by AND s.role = 'org_admin')));
  IF NOT v_inviter_ok THEN RETURN 'inviter_gone'; END IF;

  IF EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = i.access_code_id AND s.user_id = v_user) THEN
    -- Already on staff: the invitation is spent, nothing about their role changes.
    UPDATE public.org_staff_invite SET accepted_at = now() WHERE id = i.id;
    RETURN 'ok';
  END IF;
  IF v_org.partner_user_id = v_user THEN
    UPDATE public.org_staff_invite SET accepted_at = now() WHERE id = i.id;
    RETURN 'ok';
  END IF;
  IF (SELECT COUNT(*) FROM public.org_staff s WHERE s.access_code_id = i.access_code_id) >= v_org.max_staff THEN
    RETURN 'full';
  END IF;

  INSERT INTO public.org_staff (access_code_id, user_id, role, title, created_by, invited_at, invited_email)
  VALUES (i.access_code_id, v_user, i.role, i.title, i.invited_by, i.invited_at, i.invited_email);

  FOREACH v_cap IN ARRAY i.capability_denies LOOP
    IF v_cap = ANY (public.smr_delegable_capabilities()) THEN
      INSERT INTO public.org_capability_override (org_id, user_id, capability, effect, set_by)
      VALUES (i.access_code_id, v_user, v_cap, 'deny', i.invited_by::text)
      ON CONFLICT (org_id, user_id, capability) DO UPDATE SET effect = 'deny', set_by = EXCLUDED.set_by, set_at = now();
      INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
      VALUES ('org_capability_override', 'DENY', i.access_code_id, v_user, i.invited_by::text, session_user,
              jsonb_build_object('capability', v_cap, 'from_invite', i.id));
    END IF;
  END LOOP;

  UPDATE public.org_staff_invite SET accepted_at = now() WHERE id = i.id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.smr_answer_staff_invite(uuid, boolean) FROM PUBLIC;

-- ------------------------------------------ 4. history and delete (platform) --
-- SECOND FACTOR. The database cannot see whether a session entered a two-step
-- code. Every caller of the platform-admin branches below (and of the
-- platform-admin branches in the invitation guard: admin_added, an admin-role
-- invitation, re-stamping an admin invitation) is /api/admin/orgs, which
-- requires requirePlatformAdmin (platform_admin row AND a second-factor
-- session). The organization's own routes never rely on platform_admin: the
-- app passes platformAdmin=false there (staffInvites.ts revokeStaffInvite),
-- so an admin without two-step acting in their own org is only its owner or
-- org admin.
-- What would make an organization's delete erase history: a count per table
-- for every row that points at it (every foreign key to access_code, found in
-- the catalog so a table added by a later migration is counted without
-- editing this), plus audited changes other than its own setup rows.
-- org_brand is settings, not history, and goes with the organization.
-- Platform admins only (app.user_id is read from platform_admin); anyone else
-- gets NULL.
CREATE OR REPLACE FUNCTION public.smr_admin_org_history(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_out jsonb := '{}'::jsonb;
  r record;
  n bigint;
  v_not_self text := '';
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = v_actor) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.access_code WHERE id = p_org) THEN RETURN NULL; END IF;
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.access_code'::regclass
       AND cardinality(c.conkey) = 1
       AND c.conrelid <> 'public.org_brand'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col) INTO n USING p_org;
    IF n > 0 THEN
      v_out := v_out || jsonb_build_object(r.tbl::text, COALESCE((v_out ->> (r.tbl::text))::bigint, 0) + n);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.org_audit
   WHERE org_id = p_org AND table_name NOT IN ('access_code', 'org_brand');
  IF n > 0 THEN v_out := v_out || jsonb_build_object('audited_changes', n); END IF;
  -- Usage recorded against the code itself (020; keyed by the code string,
  -- no foreign key).
  IF to_regclass('public.partner_usage_event') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.partner_usage_event e
               WHERE e.code = (SELECT ac.code FROM public.access_code ac WHERE ac.id = $1)'
      INTO n USING p_org;
    IF n > 0 THEN v_out := v_out || jsonb_build_object('partner_usage_event', n); END IF;
  END IF;
  -- The organization activity log (102, lane L3b) has no foreign keys; count
  -- it when it exists, by whichever organization column it carries.
  -- Rows about the organization itself (entity 'org': opened, closed, renamed)
  -- are not history about anyone; an organization whose only activity is its
  -- own lifecycle can still be deleted (the delete is recorded in org_audit).
  IF to_regclass('public.org_activity') IS NOT NULL THEN
    v_not_self := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                        AND table_name = 'org_activity' AND column_name = 'entity')
                       THEN ' AND entity IS DISTINCT FROM ''org''' ELSE '' END;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'org_activity' AND column_name = 'access_code_id') THEN
      EXECUTE 'SELECT count(*) FROM public.org_activity WHERE access_code_id = $1' || v_not_self INTO n USING p_org;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'org_activity' AND column_name = 'org_id') THEN
      EXECUTE 'SELECT count(*) FROM public.org_activity WHERE org_id = $1' || v_not_self INTO n USING p_org;
    ELSE
      n := 0;
    END IF;
    IF n > 0 THEN v_out := v_out || jsonb_build_object('org_activity', COALESCE((v_out ->> 'org_activity')::bigint, 0) + n); END IF;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_admin_org_history(uuid) FROM PUBLIC;

-- Delete an organization that has no history, after the admin typed its name.
-- Returns ok, refused, not_found, name_mismatch or has_history. The row is
-- locked first, so a join or invite racing the delete either lands before the
-- count (and refuses it) or waits and then fails its foreign key.
CREATE OR REPLACE FUNCTION public.smr_admin_delete_org(p_org uuid, p_confirm_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org public.access_code%ROWTYPE;
  v_hist jsonb;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = v_actor) THEN
    RETURN 'refused';
  END IF;
  SELECT * INTO v_org FROM public.access_code WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p_confirm_name IS NULL OR btrim(p_confirm_name) <> btrim(v_org.partner_name) THEN RETURN 'name_mismatch'; END IF;
  v_hist := public.smr_admin_org_history(p_org);
  IF v_hist IS NULL OR v_hist <> '{}'::jsonb THEN RETURN 'has_history'; END IF;
  INSERT INTO public.org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
  VALUES ('access_code', 'DELETE', v_org.id, v_org.partner_user_id, v_actor::text, session_user,
          jsonb_build_object('name', v_org.partner_name, 'deleted_empty_org', true));
  DELETE FROM public.org_brand WHERE access_code_id = p_org;
  DELETE FROM public.access_code WHERE id = p_org;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.smr_admin_delete_org(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_answer_staff_invite(uuid, boolean) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_admin_org_history(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_admin_delete_org(uuid, text) TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------- after-guards --
-- Only what this migration creates.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'access_code' AND column_name = 'close_reason') THEN
    RAISE EXCEPTION '100: access_code.close_reason missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.org_staff_invite'::regclass
                  AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '100: org_staff_invite must have RLS enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_staff_invite') <> 3 THEN
    RAISE EXCEPTION '100: org_staff_invite must have exactly its three policies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.org_staff_invite', 'DELETE') THEN
      RAISE EXCEPTION '100: smr_app must not delete staff invitations';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app' AND (rolbypassrls OR rolsuper)) THEN
      RAISE EXCEPTION '100: smr_app must not bypass RLS (the invitation guard relies on it)';
    END IF;
  END IF;
END $$;
