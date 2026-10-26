-- 101_roles_and_codes.sql
-- Roles and codes (house build lane L2, 2026-10-26).
--
-- WHAT WAS TRUE. smr_redeem_code (048, redefined in 096) checked that a code
-- exists, is open, has not run out of time or seats, and that the person is
-- not already a member. It never asked WHO was joining. So a platform admin
-- who signed in through a ?code= link, or typed a code in Settings, became a
-- participant of that organization, silently, and an organization's own
-- owner or staff could join it as a participant of themselves. Both happened.
--
-- WHAT IS TRUE NOW. Two refusals, each with its own word so the app can say
-- it plainly instead of the generic "that code did not work":
--   platform_admin  the person holds a platform_admin row. Checked BEFORE the
--                   code is looked up, so the answer is the same for every
--                   code, real or not, and says nothing about any code.
--   org_staff       the person owns this organization (partner_user_id) or
--                   holds an org_staff row in it. Checked after the code is
--                   found and open, before the membership rules.
-- Every other rule, word and its order is 096's, unchanged: not_found,
-- inactive, expired, already_member, the returning-member seat re-use, full,
-- the row lock, and the seat counter.
--
-- Callers, all unchanged in SQL: smr_accept_seat_offer (096) passes the word
-- through, so an offer to an admin or to the org's own staff stays pending
-- and is answered with the new words; redeemAccessCode (core accessCode.ts)
-- maps them to plain messages; the pre-authorized partner path in auth.ts
-- ignores the result (it never blocks sign-in).
--
-- NO DATA CHANGES. Existing memberships of admins or staff stay as they are;
-- the re-tier and any cleanup are owner steps after merge (L2 report).
--
-- Rollback: re-run the smr_redeem_code definition from
-- 096_refinery_access.sql (CREATE OR REPLACE; grants are kept).
SET LOCAL lock_timeout = '5s';

-- org_staff and access_code_redemption are FORCE RLS. This definer function
-- reads both with no app.org_id set, so its owner must bypass RLS; otherwise
-- the staff check would see no rows and quietly let staff join (fail open).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '101 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regclass('public.platform_admin') IS NULL OR to_regclass('public.org_staff') IS NULL THEN
    RAISE EXCEPTION '101 needs platform_admin (047) and org_staff (043)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.smr_redeem_code(p_user uuid, p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_code public.access_code%ROWTYPE;
BEGIN
  IF p_user IS NULL OR p_code IS NULL OR p_code = '' THEN
    RETURN 'not_found';
  END IF;
  -- 101: a platform admin never becomes a participant through a code. Asked
  -- before the code is read, so the answer does not depend on the code.
  IF EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = p_user) THEN
    RETURN 'platform_admin';
  END IF;
  SELECT * INTO v_code FROM public.access_code ac WHERE ac.code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT v_code.is_active THEN RETURN 'inactive'; END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at <= now() THEN RETURN 'expired'; END IF;
  -- 101: the organization's owner and staff never join it as a participant.
  IF v_code.partner_user_id = p_user
     OR EXISTS (SELECT 1 FROM public.org_staff os
                 WHERE os.user_id = p_user AND os.access_code_id = v_code.id) THEN
    RETURN 'org_staff';
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_code_redemption r
              WHERE r.user_id = p_user AND r.access_code_id = v_code.id) THEN
    RETURN 'already_member';
  END IF;
  -- Coming back (096): the seat was spent the first time. Re-use it.
  IF EXISTS (SELECT 1 FROM public.access_code_departure d
              WHERE d.user_id = p_user AND d.access_code_id = v_code.id) THEN
    INSERT INTO public.access_code_redemption (user_id, access_code_id) VALUES (p_user, v_code.id);
    DELETE FROM public.access_code_departure WHERE user_id = p_user AND access_code_id = v_code.id;
    RETURN 'ok';
  END IF;
  IF v_code.max_redemptions IS NOT NULL AND v_code.times_redeemed >= v_code.max_redemptions THEN
    RETURN 'full';
  END IF;
  INSERT INTO public.access_code_redemption (user_id, access_code_id) VALUES (p_user, v_code.id);
  UPDATE public.access_code SET times_redeemed = times_redeemed + 1, updated_at = now()
   WHERE id = v_code.id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.smr_redeem_code(uuid, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON FUNCTION public.smr_redeem_code(uuid, text) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_redeem_code(uuid, text) TO smr_app;
  END IF;
END $$;

-- After-guard: only what this migration made. The live body carries both
-- refusals, stays SECURITY DEFINER with a pinned search_path, and PUBLIC
-- cannot call it.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.smr_redeem_code(uuid, text)'::regprocedure);
BEGIN
  IF position('RETURN ''platform_admin''' IN v_def) = 0 OR position('RETURN ''org_staff''' IN v_def) = 0 THEN
    RAISE EXCEPTION '101 after-guard: smr_redeem_code is missing a refusal';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.smr_redeem_code(uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION '101 after-guard: smr_redeem_code must be SECURITY DEFINER';
  END IF;
  -- The definer runs as the function's OWNER, and CREATE OR REPLACE keeps an
  -- existing owner, which need not be current_user. The owner is the role that
  -- must bypass RLS, or the staff check sees no org_staff rows (fails open).
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                  WHERE p.oid = 'public.smr_redeem_code(uuid, text)'::regprocedure
                    AND (r.rolbypassrls OR r.rolsuper)) THEN
    RAISE EXCEPTION '101 after-guard: the owner of smr_redeem_code must have BYPASSRLS';
  END IF;
  IF has_function_privilege('public', 'public.smr_redeem_code(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '101 after-guard: PUBLIC can execute smr_redeem_code';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app')
     AND NOT has_function_privilege('smr_app', 'public.smr_redeem_code(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '101 after-guard: smr_app lost EXECUTE on smr_redeem_code';
  END IF;
END $$;
