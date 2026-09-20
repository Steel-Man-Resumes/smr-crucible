-- Membership changes become database functions. RLS on access_code_redemption
-- is NOT enabled here -- that is 049, applied only after the code that calls
-- these has been live and verified. This file changes what the application is
-- ABLE to call; 049 changes what it is ALLOWED to do.
--
-- WHY FUNCTIONS AND NOT AN INSERT POLICY. The first draft of this work gave the
-- app an INSERT policy of "user_id is you, or the org is the one you are scoped
-- to" and called a self-inserted redemption harmless. It is not: a redemption
-- is what cohort membership, tier and rate limits are derived from, and a row
-- policy can only check WHOSE row it is -- not that the code was known, was
-- active, had not expired, or had a seat left. Those are the rules that make a
-- redemption legitimate, so they live next to the write, in one place, where
-- no caller can forget one of them. (Codex review, 2026-09-20, finding 1.)
--
-- Four near-copies of "claim a seat, insert a row" existed: accessCode.ts,
-- auth.ts (fire-and-forget, on a different driver), hub-unlock (no capacity or
-- active check at all), and the invite path. Two claimed the seat and inserted
-- the row in separate statements with a hand-written refund between them. They
-- all call this now.
--
-- SECURITY DEFINER, so read the rules: every object is schema-qualified,
-- search_path is pinned, PUBLIC's default EXECUTE is revoked in this same
-- transaction, and only the app role is granted it. The functions take no
-- identity from session settings, so there is nothing to misattribute; the
-- AUDIT trigger records who acted, from app.user_id, as it does elsewhere.

-- ------------------------------------------------------------------ redeem --
-- Returns one word. Anything other than 'ok' wrote nothing.
CREATE OR REPLACE FUNCTION public.smr_redeem_code(p_user uuid, p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_code public.access_code%ROWTYPE;
BEGIN
  IF p_user IS NULL OR p_code IS NULL OR p_code = '' THEN
    RETURN 'not_found';
  END IF;

  -- The row lock is the whole concurrency story. Every redemption of this code
  -- queues here, so the capacity check below cannot be raced, and the same
  -- person double-clicking finds their first click's row on the second pass.
  SELECT * INTO v_code FROM public.access_code ac WHERE ac.code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT v_code.is_active THEN RETURN 'inactive'; END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at <= now() THEN RETURN 'expired'; END IF;

  IF EXISTS (SELECT 1 FROM public.access_code_redemption r
              WHERE r.user_id = p_user AND r.access_code_id = v_code.id) THEN
    RETURN 'already_member';
  END IF;

  IF v_code.max_redemptions IS NOT NULL AND v_code.times_redeemed >= v_code.max_redemptions THEN
    RETURN 'full';
  END IF;

  INSERT INTO public.access_code_redemption (user_id, access_code_id) VALUES (p_user, v_code.id);
  -- times_redeemed counts SEATS CLAIMED, not people currently enrolled. A seat
  -- is durable (Troy, 2026-06-10): leaving or deleting your data does not hand
  -- it back. Only a never-activated invite is refunded, in revokeOrgInvite.
  UPDATE public.access_code SET times_redeemed = times_redeemed + 1, updated_at = now()
   WHERE id = v_code.id;
  RETURN 'ok';
END;
$$;

-- ------------------------------------------------------------------- leave --
-- A person removing themselves from every organization (delete-my-data).
-- Also removes their staff assignments: before this, the redemption was
-- deleted and the assignment rows stayed, so a case manager's caseload count
-- went on including someone who had left. Returns how many memberships ended.
CREATE OR REPLACE FUNCTION public.smr_leave_all_orgs(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------- binding --
-- "Is this person already attached to an organization?" -- asked while an org
-- invites an email address. It is a question about OTHER organizations' rows,
-- so no row policy can answer it without letting org A read org B's members.
--
-- Returns one word: none | this_org | other_org. Never which org. That is
-- exactly what the invite form already tells the admin in its error message,
-- and no more. It only answers inside an organization's scope, so it cannot be
-- used as a general "is this account enrolled anywhere" oracle from a
-- participant route.
--
-- People MAY belong to two organizations (Troy, 2026-09-20). Invites still
-- refuse someone bound elsewhere for now, because sharing consent is still one
-- flag per PERSON, not per organization: attaching an existing account would
-- hand the new org whatever that person agreed to show their first one. When
-- sharing is per organization this check can relax.
CREATE OR REPLACE FUNCTION public.smr_invite_binding(p_user uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'smr_invite_binding requires an organization scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_code_redemption r
              WHERE r.user_id = p_user AND r.access_code_id = v_org) THEN
    RETURN 'this_org';
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.user_id = p_user) THEN
    RETURN 'other_org';
  END IF;
  RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.smr_redeem_code(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_leave_all_orgs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_invite_binding(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_redeem_code(uuid, text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_leave_all_orgs(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_invite_binding(uuid) TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------------- audit --
-- Joining and leaving an organization IS the organization boundary, and until
-- now it left no trace. Same trigger as org_staff: it reads access_code_id and
-- user_id off the row generically.
DROP TRIGGER IF EXISTS acr_audit ON access_code_redemption;
CREATE TRIGGER acr_audit
  AFTER INSERT OR UPDATE OR DELETE ON access_code_redemption
  FOR EACH ROW EXECUTE FUNCTION org_audit_write();

-- No assignment without membership, as a database fact rather than a habit.
-- The delete side: when a membership ends, that org's assignment goes with it.
CREATE OR REPLACE FUNCTION public.acr_release_assignment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.client_staff_assignment a
   WHERE a.client_user_id = OLD.user_id AND a.access_code_id = OLD.access_code_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS acr_release_assignment ON access_code_redemption;
CREATE TRIGGER acr_release_assignment
  AFTER DELETE ON access_code_redemption
  FOR EACH ROW EXECUTE FUNCTION public.acr_release_assignment();
