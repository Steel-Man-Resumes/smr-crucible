-- Participant-controlled sharing, by scope, per organization.
--
-- BEFORE THIS there was one boolean per PERSON (`consumer_consent` layer
-- 'sharing'): on, and the org that gave you a code sees your stage, counts and
-- last-active; off, and they see only that you exist. Staff never saw content.
--
-- THIS ADDS scoped grants FROM one person TO one organization. It does not
-- replace the boolean yet: the existing cohort view still reads it, untouched,
-- so nothing changes for an org that does not have `crm_v2` turned on. Old
-- 'sharing' grants are deliberately NOT converted into anything here. They were
-- given under words that promised staff would never see a resume; they cannot
-- be read as agreement to anything wider, and they were per person, so they do
-- not even say WHICH organization was meant. (Codex review, finding 11.)
--
-- THE ONE RULE THE WHOLE MODEL RESTS ON: only the participant creates a grant.
-- There is no code path from an organization, a staff member or an org setting
-- to a grant row. An org can ASK (sharing_request). A person answers.
--
-- All three tables are row-level protected from birth, never retrofitted.

ALTER TABLE access_code ADD COLUMN IF NOT EXISTS crm_v2 BOOLEAN NOT NULL DEFAULT false;
-- Demo orgs only. A real organization is switched on deliberately, by a human.
UPDATE access_code SET crm_v2 = true WHERE partner_name LIKE '%(Demo)' AND crm_v2 = false;

-- Per-person capability exceptions. resolveOrgActor has read this table since
-- it was written -- and treated "table missing" as "no exceptions" -- but no
-- migration ever created it, so deny-wins was a rule with nowhere to be
-- recorded. The application READS it and cannot write it: a grant of power is
-- made by a human with the owner credential, like platform_admin.
CREATE TABLE IF NOT EXISTS org_capability_override (
  org_id     UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  effect     TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  set_by     TEXT NOT NULL DEFAULT session_user,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, capability)
);

-- ------------------------------------------------------------------ grants --
CREATE TABLE IF NOT EXISTS sharing_grant (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- Allowlisted in TypeScript (sharingScopes.ts), like capabilities: a scope
  -- string that is not in the code does not exist, whatever a row says.
  scope          TEXT NOT NULL,
  -- Only for per-item scopes (a single vault document). NULL = the whole scope.
  resource_id    UUID,
  -- 'participant_choice' is consent. 'program_requirement' is NOT consent and
  -- is never described as consent anywhere; it is a condition the program set,
  -- which the person acknowledged. Same row shape, different truth.
  basis          TEXT NOT NULL DEFAULT 'participant_choice'
                 CHECK (basis IN ('participant_choice', 'program_requirement')),
  -- The exact wording the person saw when they turned this on.
  text_version   TEXT NOT NULL,
  request_id     UUID,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT
);
-- One ACTIVE grant per person, org, scope and item. History is kept: a revoke
-- closes the row, turning it on again makes a new one with its own wording.
CREATE UNIQUE INDEX IF NOT EXISTS sharing_grant_active
  ON sharing_grant (user_id, access_code_id, scope, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sharing_grant_org ON sharing_grant (access_code_id, user_id) WHERE revoked_at IS NULL;

-- A grant row is written once and closed once. Nothing else about it changes:
-- not the person, not the org, not the scope, and a closed grant never reopens.
CREATE OR REPLACE FUNCTION public.sharing_grant_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked sharing grant cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.basis IS DISTINCT FROM OLD.basis
     OR NEW.text_version IS DISTINCT FROM OLD.text_version
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
    RAISE EXCEPTION 'a sharing grant can only be revoked, not edited' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'the only permitted change to a sharing grant is revoking it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sharing_grant_guard ON sharing_grant;
CREATE TRIGGER sharing_grant_guard BEFORE UPDATE ON sharing_grant
  FOR EACH ROW EXECUTE FUNCTION public.sharing_grant_guard();

ALTER TABLE sharing_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_grant FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sharing_grant_select ON sharing_grant;
CREATE POLICY sharing_grant_select ON sharing_grant FOR SELECT USING (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- INSERT: yourself, to an organization you actually belong to. The EXISTS reads
-- access_code_redemption under the same session, where you can see your own
-- memberships, so it cannot be satisfied for an org you have not joined.
-- NOTE the absence of any org clause. That absence is the model.
DROP POLICY IF EXISTS sharing_grant_insert ON sharing_grant;
CREATE POLICY sharing_grant_insert ON sharing_grant FOR INSERT WITH CHECK (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND NULLIF(current_setting('app.org_id', true), '') IS NULL
  AND EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = sharing_grant.user_id
                 AND r.access_code_id = sharing_grant.access_code_id));

-- UPDATE (= revoke): yourself only. The trigger above limits what may change.
DROP POLICY IF EXISTS sharing_grant_update ON sharing_grant;
CREATE POLICY sharing_grant_update ON sharing_grant FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND NULLIF(current_setting('app.org_id', true), '') IS NULL)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- No DELETE policy: history is not erasable by the app. Account deletion
-- removes it by cascade, which row-level security does not intercept.

-- ---------------------------------------------------------------- requests --
CREATE TABLE IF NOT EXISTS sharing_request (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope          TEXT NOT NULL,
  requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Shown to the participant verbatim, under the staff member's name.
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at    TIMESTAMPTZ
);
-- One open ask per person, org and scope: staff cannot stack requests.
CREATE UNIQUE INDEX IF NOT EXISTS sharing_request_open
  ON sharing_request (access_code_id, user_id, scope) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.sharing_request_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'an answered sharing request cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.scope IS DISTINCT FROM OLD.scope OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the status of a sharing request can change' USING ERRCODE = 'check_violation';
  END IF;
  -- WHO may move it WHERE. The participant answers; the org may only withdraw.
  IF NULLIF(current_setting('app.org_id', true), '') IS NOT NULL AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'an organization can withdraw its request, not answer it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.answered_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sharing_request_guard ON sharing_request;
CREATE TRIGGER sharing_request_guard BEFORE UPDATE ON sharing_request
  FOR EACH ROW EXECUTE FUNCTION public.sharing_request_guard();

ALTER TABLE sharing_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_request FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sharing_request_select ON sharing_request;
CREATE POLICY sharing_request_select ON sharing_request FOR SELECT USING (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- INSERT: an organization, about one of ITS members, signed by the actor.
DROP POLICY IF EXISTS sharing_request_insert ON sharing_request;
CREATE POLICY sharing_request_insert ON sharing_request FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND requested_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = sharing_request.user_id
                 AND r.access_code_id = sharing_request.access_code_id));

DROP POLICY IF EXISTS sharing_request_update ON sharing_request;
CREATE POLICY sharing_request_update ON sharing_request FOR UPDATE
  USING (
    (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
       AND NULLIF(current_setting('app.org_id', true), '') IS NULL)
    OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- ------------------------------------------------------------------- notes --
-- A case manager's own record. It is ABOUT a participant and belongs to the
-- ORGANIZATION: the participant does not control it, and the product says so
-- to them in plain words rather than letting them assume otherwise.
CREATE TABLE IF NOT EXISTS case_note (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id         UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  client_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  kind                   TEXT NOT NULL DEFAULT 'note'
                         CHECK (kind IN ('note', 'call', 'meeting', 'text', 'email', 'referral')),
  body                   TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  visible_to_participant BOOLEAN NOT NULL DEFAULT false,
  -- Where the words came from. A note drafted by the assistant says so.
  drafted_by_assistant   BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS case_note_client ON case_note (access_code_id, client_user_id, occurred_at DESC);

-- Every earlier wording of a note, kept. A case file that can be silently
-- rewritten is not a record.
CREATE TABLE IF NOT EXISTS case_note_version (
  id             BIGSERIAL PRIMARY KEY,
  note_id        UUID NOT NULL REFERENCES case_note(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL,
  body           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  replaced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_by    TEXT
);
CREATE OR REPLACE FUNCTION public.case_note_keep_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
     OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
    RAISE EXCEPTION 'a case note cannot be moved to another person, author or organization' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    INSERT INTO public.case_note_version (note_id, access_code_id, body, kind, replaced_by)
    VALUES (OLD.id, OLD.access_code_id, OLD.body, OLD.kind, NULLIF(current_setting('app.user_id', true), ''));
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS case_note_keep_version ON case_note;
CREATE TRIGGER case_note_keep_version BEFORE UPDATE ON case_note
  FOR EACH ROW EXECUTE FUNCTION public.case_note_keep_version();

ALTER TABLE case_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_note FORCE ROW LEVEL SECURITY;
ALTER TABLE case_note_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_note_version FORCE ROW LEVEL SECURITY;

-- Staff see their organization's notes. The participant sees only the notes
-- a staff member chose to show them -- and only through their own identity.
DROP POLICY IF EXISTS case_note_select ON case_note;
CREATE POLICY case_note_select ON case_note FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR (visible_to_participant
      AND client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS case_note_insert ON case_note;
CREATE POLICY case_note_insert ON case_note FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = case_note.client_user_id
                 AND r.access_code_id = case_note.access_code_id));
-- Only the author amends their own note. No DELETE policy at all.
DROP POLICY IF EXISTS case_note_update ON case_note;
CREATE POLICY case_note_update ON case_note FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS case_note_version_select ON case_note_version;
CREATE POLICY case_note_version_select ON case_note_version FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Leaving an organization ends what that organization may see, in the same
-- transaction as the membership. The app cannot revoke on a person's behalf
-- (the policy above requires their own identity and no org scope); this runs
-- as the function owner, which is the one place a system revocation is made.
CREATE OR REPLACE FUNCTION public.smr_leave_all_orgs(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL THEN RETURN 0; END IF;
  UPDATE public.sharing_grant SET revoked_at = now(), revoked_reason = 'left_organization'
   WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE public.sharing_request SET status = 'cancelled'
   WHERE user_id = p_user AND status = 'pending';
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_leave_all_orgs(uuid) FROM PUBLIC;

-- "Who is my case manager?" -- the one fact about client_staff_assignment a
-- participant is entitled to, and cannot read: that table is visible only
-- inside an organization's scope. Takes NO argument. It answers for whoever
-- app.user_id says is asking, so it cannot be pointed at somebody else.
CREATE OR REPLACE FUNCTION public.smr_my_case_managers()
RETURNS TABLE (access_code_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.access_code_id, u.name
    FROM public.client_staff_assignment a
    JOIN public.users u ON u.id = a.staff_user_id
   WHERE a.client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION public.smr_my_case_managers() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_leave_all_orgs(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_my_case_managers() TO smr_app;
    REVOKE ALL ON sharing_grant, sharing_request, case_note, case_note_version FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON sharing_grant, sharing_request, case_note TO smr_app;
    GRANT SELECT ON case_note_version TO smr_app;
    REVOKE ALL ON org_capability_override FROM smr_app;
    GRANT SELECT ON org_capability_override TO smr_app;
  END IF;
END $$;
