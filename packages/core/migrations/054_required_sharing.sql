-- Required sharing: some programs make sharing a condition of taking part.
--
-- WHY A PROGRAM REQUIRES IT (so the design serves the real reasons): a contract
-- or grant obliges the organization to verify job-search activity; a court or
-- supervision condition requires documented effort; a funder reimburses on
-- outcomes the organization must be able to evidence. None of that is the
-- participant's free choice, so NONE OF IT IS CALLED CONSENT, anywhere.
--
-- THE RULES
--  1. A policy is a VERSION and versions are immutable. Editing makes a new one.
--  2. A policy opens nothing. Only a person's own acknowledgement of a specific
--     version does -- so turning a requirement on exposes nobody retroactively.
--     Until someone acknowledges, staff see "awaiting acknowledgement".
--  3. A new version never widens what an earlier acknowledgement opened.
--  4. The person is never locked out of their own work for not acknowledging,
--     and can stop sharing a required item; the product tells them plainly that
--     their program requires it and tells staff that it was stopped. Software
--     records the program's rule. It does not enforce it on the program's behalf.
--  5. Disclosure plans, interview practice and vault files can never be required.
--  6. Whether existing material is covered, or only material from the day of
--     acknowledgement on, is part of the version and is shown to the person.
--  7. Real organizations cannot use this until the wording has had legal review:
--     access_code.required_sharing_enabled is set by a human with the owner
--     credential, and is on for demo orgs only.

ALTER TABLE access_code ADD COLUMN IF NOT EXISTS required_sharing_enabled BOOLEAN NOT NULL DEFAULT false;
UPDATE access_code SET required_sharing_enabled = true WHERE partner_name LIKE '%(Demo)' AND NOT required_sharing_enabled;

CREATE TABLE IF NOT EXISTS org_sharing_policy_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id  UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  version_no      INTEGER NOT NULL,
  scopes          TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['applications','resume','documents']::text[]),
  -- Who at the organization may open what is required.
  audience        TEXT NOT NULL CHECK (audience IN ('assigned_staff', 'assigned_staff_and_admins')),
  -- The ORGANIZATION'S stated reason, shown to the participant word for word under the org's name.
  purpose         TEXT NOT NULL CHECK (length(btrim(purpose)) BETWEEN 10 AND 600),
  covers_existing BOOLEAN NOT NULL,
  -- The version of OUR wording wrapped around it (sharingScopes.ts).
  text_version    TEXT NOT NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  effective_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ,
  UNIQUE (access_code_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_sharing_policy_active ON org_sharing_policy_version (access_code_id) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS sharing_ack (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version_id UUID NOT NULL REFERENCES org_sharing_policy_version(id) ON DELETE CASCADE,
  access_code_id    UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  acknowledged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when the person leaves the org: rejoining means acknowledging again.
  ended_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS sharing_ack_active ON sharing_ack (user_id, policy_version_id) WHERE ended_at IS NULL;

ALTER TABLE sharing_grant ADD COLUMN IF NOT EXISTS policy_version_id UUID REFERENCES org_sharing_policy_version(id) ON DELETE SET NULL;
-- NULL = everything. A date = only material created on or after it (rule 6).
ALTER TABLE sharing_grant ADD COLUMN IF NOT EXISTS covers_from TIMESTAMPTZ;

ALTER TABLE org_sharing_policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_sharing_policy_version FORCE ROW LEVEL SECURITY;
ALTER TABLE sharing_ack ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_ack FORCE ROW LEVEL SECURITY;

-- A policy is readable inside its org, and by that org's own members.
DROP POLICY IF EXISTS policy_version_select ON org_sharing_policy_version;
CREATE POLICY policy_version_select ON org_sharing_policy_version FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR EXISTS (SELECT 1 FROM access_code_redemption r
              WHERE r.access_code_id = org_sharing_policy_version.access_code_id
                AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
-- Acknowledgements: yours, or your organization's members'.
DROP POLICY IF EXISTS sharing_ack_select ON sharing_ack;
CREATE POLICY sharing_ack_select ON sharing_ack FOR SELECT USING (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
-- No INSERT/UPDATE/DELETE policy on either table: both are written only by the functions below.

-- ---------------------------------------------------------- set the policy --
-- p_scopes NULL or empty = stop requiring anything (retires the active version).
CREATE OR REPLACE FUNCTION public.smr_set_sharing_policy(p_scopes text[], p_audience text, p_purpose text, p_covers_existing boolean, p_text_version text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_code  public.access_code%ROWTYPE;
  v_next  integer;
BEGIN
  IF v_org IS NULL OR v_actor IS NULL THEN RETURN 'refused'; END IF;
  SELECT * INTO v_code FROM public.access_code WHERE id = v_org FOR UPDATE;
  -- The OWNER, looked up here. Not an admin, and not whoever the app says.
  IF NOT FOUND OR v_code.partner_user_id IS DISTINCT FROM v_actor THEN RETURN 'owner_only'; END IF;
  IF NOT v_code.required_sharing_enabled THEN RETURN 'not_enabled'; END IF;

  UPDATE public.org_sharing_policy_version SET retired_at = now() WHERE access_code_id = v_org AND retired_at IS NULL;
  IF p_scopes IS NULL OR cardinality(p_scopes) = 0 THEN
    INSERT INTO public.org_audit (table_name, action, org_id, actor, db_role, row_summary)
    VALUES ('org_sharing_policy_version', 'RETIRE', v_org, v_actor::text, session_user, '{}'::jsonb);
    RETURN 'ok';
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next FROM public.org_sharing_policy_version WHERE access_code_id = v_org;
  INSERT INTO public.org_sharing_policy_version (access_code_id, version_no, scopes, audience, purpose, covers_existing, text_version, created_by)
  VALUES (v_org, v_next, p_scopes, p_audience, btrim(p_purpose), p_covers_existing, p_text_version, v_actor);
  INSERT INTO public.org_audit (table_name, action, org_id, actor, db_role, row_summary)
  VALUES ('org_sharing_policy_version', 'INSERT', v_org, v_actor::text, session_user,
          jsonb_build_object('version', v_next, 'scopes', p_scopes, 'audience', p_audience, 'covers_existing', p_covers_existing));
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN 'invalid';
END;
$$;

-- -------------------------------------------------------------- acknowledge --
-- Takes NO user argument: it acts for whoever app.user_id says is asking, and
-- refuses inside an organization's scope, so staff cannot acknowledge for anyone.
CREATE OR REPLACE FUNCTION public.smr_acknowledge_policy(p_version uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_pol  public.org_sharing_policy_version%ROWTYPE;
  v_scope text;
BEGIN
  IF v_user IS NULL OR NULLIF(current_setting('app.org_id', true), '') IS NOT NULL THEN RETURN 'refused'; END IF;
  SELECT * INTO v_pol FROM public.org_sharing_policy_version WHERE id = p_version;
  IF NOT FOUND OR v_pol.retired_at IS NOT NULL THEN RETURN 'not_current'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.user_id = v_user AND r.access_code_id = v_pol.access_code_id) THEN
    RETURN 'not_a_member';
  END IF;

  INSERT INTO public.sharing_ack (user_id, policy_version_id, access_code_id) VALUES (v_user, v_pol.id, v_pol.access_code_id)
  ON CONFLICT DO NOTHING;
  FOREACH v_scope IN ARRAY v_pol.scopes LOOP
    -- An existing grant for the scope (their own earlier choice) already opens it; leave it as it is.
    INSERT INTO public.sharing_grant (user_id, access_code_id, scope, basis, text_version, policy_version_id, covers_from)
    VALUES (v_user, v_pol.access_code_id, v_scope, 'program_requirement', v_pol.text_version, v_pol.id,
            CASE WHEN v_pol.covers_existing THEN NULL ELSE now() END)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN 'ok';
END;
$$;

-- Leaving ends acknowledgements too, so rejoining starts clean (rule 2 again).
CREATE OR REPLACE FUNCTION public.smr_leave_all_orgs(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL THEN RETURN 0; END IF;
  UPDATE public.sharing_grant SET revoked_at = now(), revoked_reason = 'left_organization' WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE public.sharing_request SET status = 'cancelled' WHERE user_id = p_user AND status = 'pending';
  UPDATE public.sharing_ack SET ended_at = now() WHERE user_id = p_user AND ended_at IS NULL;
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- What a program requires, for someone holding its code but not yet a member.
-- One row or none. It discloses the policy of the org whose code you typed.
CREATE OR REPLACE FUNCTION public.smr_policy_for_code(p_code text)
RETURNS TABLE (id uuid, org_name text, scopes text[], audience text, purpose text, covers_existing boolean, text_version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT v.id, ac.partner_name, v.scopes, v.audience, v.purpose, v.covers_existing, v.text_version
    FROM public.access_code ac JOIN public.org_sharing_policy_version v ON v.access_code_id = ac.id AND v.retired_at IS NULL
   WHERE ac.code = p_code AND ac.is_active
$$;

REVOKE ALL ON FUNCTION public.smr_set_sharing_policy(text[], text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_acknowledge_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_policy_for_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_leave_all_orgs(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_set_sharing_policy(text[], text, text, boolean, text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_acknowledge_policy(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_policy_for_code(text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_leave_all_orgs(uuid) TO smr_app;
    REVOKE ALL ON org_sharing_policy_version, sharing_ack FROM smr_app;
    GRANT SELECT ON org_sharing_policy_version, sharing_ack TO smr_app;
  END IF;
END $$;
