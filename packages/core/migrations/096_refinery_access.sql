-- Refinery seats (R4 gate design, Option A; B7 build lane, 2026-10-23).
--
-- WHAT THIS CHANGES BY ITSELF: nothing a person can see. The one policy row is
-- inserted with public_signup_open = true, which is today's behavior: every
-- signed-in account reaches the Refinery. The gate turns on only when a
-- platform admin uses the "close" action. The FIRST close snapshots every
-- account that exists at that moment into refinery_seat_legacy and stamps
-- legacy_cutoff, in one transaction; later closes never snapshot again
-- (security review 1, BL-2; app code lib/refinery-access-server.ts). Apply BEFORE the app release that reads it:
-- the AI admission check refuses with 503 when these functions are missing.
--
-- A SEAT is one rule, in one place: smr_has_refinery_seat below. Platform
-- admin; owner or staff of an active organization; a membership in an active,
-- unexpired organization code; or a grandfathered account. (The app adds one
-- more: an address on the PARTNER_PRE_AUTH list, which only the deployment
-- environment knows.) users.tier, progression grants, premium grants and any
-- browser setting are never read: each of those can be set by the person or
-- means something else.
--
-- ROLLBACK, no deploy needed: UPDATE refinery_access_policy SET
-- public_signup_open = true (the admin "open" action does exactly this). The
-- tables and functions can stay; nothing reads them while the policy is open
-- except the functions themselves.
SET LOCAL lock_timeout = '5s';

-- Definer functions below read row-protected tables (FORCE RLS). Their owner
-- must bypass RLS or they would see nothing and lock out real seat holders.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '096 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

-- ------------------------------------------------------------- policy row --
CREATE TABLE refinery_access_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_signup_open boolean NOT NULL DEFAULT true,
  -- Troy's own organization (an access_code row is an organization). Seat
  -- requests are approved into it. Null until a platform admin sets it.
  house_code_id uuid REFERENCES access_code(id) ON DELETE SET NULL,
  closed_at timestamptz,
  -- When the grandfather snapshot was taken (the first close). Set once,
  -- never moved: reopening and closing again does not seat anyone new.
  legacy_cutoff timestamptz,
  -- RESERVED for a later lane (Troy 2026-10-23: "some locks require my yes").
  -- Shape to be decided there, for example
  --   {"steps": {"tailor": "troy", "apply": "auto"}, "seat": {"auto_within": {...}}}
  -- = per-step "needs Troy" flags and an "auto-approve within policy" rule.
  -- Nothing reads it yet; it exists so that lane needs no new table.
  review_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(review_rules) = 'object'),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  change_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO refinery_access_policy (id) VALUES (true);

-- ------------------------------------------------------- grandfather list --
-- Filled only by the FIRST close action, for every account that exists at
-- that moment. Never written on a person's behalf. A platform admin may
-- remove a row (admin panel), never add one by hand from the app.
CREATE TABLE refinery_seat_legacy (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ departures --
-- Who left which organization (smr_leave_org, smr_leave_all_orgs). Seats are
-- durable, so a person who left and comes back to the same organization takes
-- back the seat they already used instead of spending a new one: without
-- this, leave and re-join drains a pool one seat per click (review 1, SF-5).
CREATE TABLE access_code_departure (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id uuid NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  left_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, access_code_id)
);

-- ------------------------------------------------------------ seat offers --
-- An organization asking an EXISTING account to join. Before this, adding an
-- existing account's email in "Add participants" spent a seat and attached the
-- person on the spot, without asking them (R3 S5). Now the organization makes
-- an offer; the seat is spent only when the person accepts
-- (smr_accept_seat_offer). A never-signed-in invitee is unchanged: there is no
-- one to ask yet, and their first sign-in is the yes.
CREATE TABLE org_seat_offer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id uuid NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
-- One open offer per person per organization.
CREATE UNIQUE INDEX org_seat_offer_one_open ON org_seat_offer(access_code_id, user_id) WHERE status = 'pending';
CREATE INDEX org_seat_offer_user ON org_seat_offer(user_id, status);

-- The organization's own record of whom it asked (CRM cross-lane SF8): an
-- offer also writes an org_invite row with the name and email the
-- organization typed, so once the person says yes they appear in the
-- organization's invited lists like any invitee. NULL = an ordinary invite.
ALTER TABLE org_invite ADD COLUMN IF NOT EXISTS offer_status text
  CHECK (offer_status IS NULL OR offer_status IN ('offered','joined','declined','withdrawn'));

-- ----------------------------------------------------- seat request kind --
-- A person without a seat asks Troy for one through his existing review queue.
ALTER TABLE progression_request DROP CONSTRAINT IF EXISTS progression_request_kind_check;
ALTER TABLE progression_request ADD CONSTRAINT progression_request_kind_check
  CHECK (kind IN ('unlock','ai_bonus','feedback','bug','seat'));

-- ------------------------------------------------------------------- RLS --
ALTER TABLE refinery_access_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE refinery_access_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON refinery_access_policy FROM PUBLIC;
-- Platform admins read the row (it names the house organization and holds
-- the change history). Everyone else asks smr_refinery_signup_open().
CREATE POLICY refinery_access_policy_read ON refinery_access_policy FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
-- Only a platform admin changes it. No INSERT or DELETE policy: the one row
-- was written above and cannot be removed or duplicated from the app.
CREATE POLICY refinery_access_policy_admin ON refinery_access_policy FOR UPDATE
  USING (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

ALTER TABLE refinery_seat_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE refinery_seat_legacy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON refinery_seat_legacy FROM PUBLIC;
CREATE POLICY refinery_seat_legacy_owner ON refinery_seat_legacy FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY refinery_seat_legacy_admin ON refinery_seat_legacy FOR ALL
  USING (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

ALTER TABLE access_code_departure ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_code_departure FORCE ROW LEVEL SECURITY;
REVOKE ALL ON access_code_departure FROM PUBLIC;
-- Written only by the definer functions below. A person may read their own.
CREATE POLICY access_code_departure_owner ON access_code_departure FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE org_seat_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_seat_offer FORCE ROW LEVEL SECURITY;
REVOKE ALL ON org_seat_offer FROM PUBLIC;
-- The person sees offers made to them. Accepting and declining go through the
-- definer functions below, so there is no owner UPDATE policy to misuse.
CREATE POLICY org_seat_offer_owner ON org_seat_offer FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- An organization sees and makes ITS OWN offers (scoped by runScoped).
CREATE POLICY org_seat_offer_org_read ON org_seat_offer FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY org_seat_offer_org_insert ON org_seat_offer FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND status = 'pending');
CREATE POLICY org_seat_offer_admin ON org_seat_offer FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admin WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    -- Revoke first: production's default privileges hand new tables to the
    -- app role, which would otherwise keep DELETE on the policy row and
    -- UPDATE on offers and departures (review 2, found writing the pglite
    -- test). Same lists as scripts/lib/restricted-grants.mjs.
    REVOKE ALL ON refinery_access_policy, refinery_seat_legacy, org_seat_offer, access_code_departure FROM smr_app;
    GRANT SELECT, UPDATE ON refinery_access_policy TO smr_app;
    GRANT SELECT, INSERT, DELETE ON refinery_seat_legacy TO smr_app;
    GRANT SELECT ON access_code_departure TO smr_app;
    GRANT SELECT, INSERT ON org_seat_offer TO smr_app;
  END IF;
END $$;

-- -------------------------------------------------------------- functions --
-- SECURITY DEFINER, written to 048's rules: every object schema-qualified,
-- search_path pinned, PUBLIC's EXECUTE revoked below, granted to smr_app only.
-- They take no identity from session settings.

-- Is the Refinery open to every signed-in account? Missing row reads as open,
-- which is the state this migration starts in (the row cannot be deleted from
-- the app: no DELETE policy, no DELETE grant).
CREATE OR REPLACE FUNCTION public.smr_refinery_signup_open()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT p.public_signup_open FROM public.refinery_access_policy p WHERE p.id), true);
$$;

-- THE seat rule. True when any one of these holds for p_user:
--  1. platform admin;
--  2. owner of an active organization, or staff of one;
--  3. a membership in an organization code that is active and not expired;
--  4. listed in the grandfather table.
-- (Rule 5, PARTNER_PRE_AUTH, is checked by the app; see the header.)
CREATE OR REPLACE FUNCTION public.smr_has_refinery_seat(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.access_code ac
                WHERE ac.partner_user_id = p_user AND ac.is_active)
    OR EXISTS (SELECT 1 FROM public.org_staff os
                 JOIN public.access_code ac ON ac.id = os.access_code_id
                WHERE os.user_id = p_user AND ac.is_active)
    OR EXISTS (SELECT 1 FROM public.access_code_redemption r
                 JOIN public.access_code ac ON ac.id = r.access_code_id
                WHERE r.user_id = p_user AND ac.is_active
                  AND (ac.expires_at IS NULL OR ac.expires_at > now()))
    OR EXISTS (SELECT 1 FROM public.refinery_seat_legacy l WHERE l.user_id = p_user)
  );
$$;

-- Accept an offer: the seat is spent HERE, through smr_redeem_code (the one
-- membership path, with its row lock and capacity check). Returns one word:
-- ok | already_member | other_org | not_found | inactive | expired | full.
-- The offer is marked accepted only when the membership exists afterwards.
CREATE OR REPLACE FUNCTION public.smr_accept_seat_offer(p_user uuid, p_offer uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_offer public.org_seat_offer%ROWTYPE;
  v_code text;
  v_out text;
BEGIN
  IF p_user IS NULL OR p_offer IS NULL THEN RETURN 'not_found'; END IF;
  SELECT * INTO v_offer FROM public.org_seat_offer o
   WHERE o.id = p_offer AND o.user_id = p_user AND o.status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT ac.code INTO v_code FROM public.access_code ac WHERE ac.id = v_offer.access_code_id;
  IF v_code IS NULL THEN RETURN 'not_found'; END IF;
  -- Already a member of this organization: the answer is already yes (review 2, N-12).
  IF EXISTS (SELECT 1 FROM public.access_code_redemption r
              WHERE r.user_id = p_user AND r.access_code_id = v_offer.access_code_id) THEN
    UPDATE public.org_seat_offer SET status = 'accepted', decided_at = now() WHERE id = p_offer;
    UPDATE public.org_invite SET offer_status = 'joined'
     WHERE access_code_id = v_offer.access_code_id AND user_id = p_user AND offer_status = 'offered';
    RETURN 'already_member';
  END IF;
  -- The invite rule, again at the moment of yes (review 1, N-4): sharing
  -- consent is still one switch per person, so someone who joined another
  -- organization after the offer is not attached to a second one this way.
  IF EXISTS (SELECT 1 FROM public.access_code_redemption r
              WHERE r.user_id = p_user AND r.access_code_id <> v_offer.access_code_id) THEN
    RETURN 'other_org';
  END IF;
  v_out := public.smr_redeem_code(p_user, v_code);
  IF v_out = 'ok' OR v_out = 'already_member' THEN
    UPDATE public.org_seat_offer SET status = 'accepted', decided_at = now() WHERE id = p_offer;
    UPDATE public.org_invite SET offer_status = 'joined'
     WHERE access_code_id = v_offer.access_code_id AND user_id = p_user AND offer_status = 'offered';
  END IF;
  RETURN v_out;
END;
$$;

-- Decline an offer: nothing is spent. Returns ok | not_found.
CREATE OR REPLACE FUNCTION public.smr_decline_seat_offer(p_user uuid, p_offer uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_user IS NULL OR p_offer IS NULL THEN RETURN 'not_found'; END IF;
  UPDATE public.org_seat_offer SET status = 'declined', decided_at = now()
   WHERE id = p_offer AND user_id = p_user AND status = 'pending';
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  UPDATE public.org_invite oi SET offer_status = 'declined'
    FROM public.org_seat_offer o
   WHERE o.id = p_offer AND oi.access_code_id = o.access_code_id AND oi.user_id = p_user AND oi.offer_status = 'offered';
  RETURN 'ok';
END;
$$;

-- An organization withdraws ITS OWN open offer (the Invited list's Remove;
-- B8 lists offers there). Scoped like smr_invite_binding: it answers only
-- inside an organization scope, and only for that organization's offer.
-- Nothing was spent, so nothing is refunded. Returns ok | not_found.
CREATE OR REPLACE FUNCTION public.smr_withdraw_seat_offer(p_user uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'smr_withdraw_seat_offer requires an organization scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user IS NULL THEN RETURN 'not_found'; END IF;
  UPDATE public.org_seat_offer SET status = 'withdrawn', decided_at = now()
   WHERE access_code_id = v_org AND user_id = p_user AND status = 'pending';
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  UPDATE public.org_invite SET offer_status = 'withdrawn'
   WHERE access_code_id = v_org AND user_id = p_user AND offer_status = 'offered';
  RETURN 'ok';
END;
$$;

-- Leave ONE organization (Settings, "Leave this organization"). Before this
-- the only way out was delete-my-data (smr_leave_all_orgs). Same shape as the
-- live smr_leave_all_orgs (054), scoped to this one organization: what was
-- shared with it is revoked, its pending requests are cancelled, its
-- acknowledgements end (so a rejoin asks again), and the membership and staff
-- assignment go. The seat is NOT handed back (durable seats, Troy
-- 2026-06-10). Returns rows removed (0 or 1).
CREATE OR REPLACE FUNCTION public.smr_leave_org(p_user uuid, p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL OR p_org IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.user_id = p_user AND r.access_code_id = p_org) THEN
    RETURN 0;
  END IF;
  UPDATE public.sharing_grant SET revoked_at = now(), revoked_reason = 'left_organization'
   WHERE user_id = p_user AND access_code_id = p_org AND revoked_at IS NULL;
  UPDATE public.sharing_request SET status = 'cancelled'
   WHERE user_id = p_user AND access_code_id = p_org AND status = 'pending';
  UPDATE public.sharing_ack SET ended_at = now()
   WHERE user_id = p_user AND access_code_id = p_org AND ended_at IS NULL;
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user AND access_code_id = p_org;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user AND access_code_id = p_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO public.access_code_departure (user_id, access_code_id) VALUES (p_user, p_org)
      ON CONFLICT (user_id, access_code_id) DO UPDATE SET left_at = now();
  END IF;
  RETURN v_n;
END;
$$;

-- smr_redeem_code (048), redefined with ONE change: a person coming back to
-- an organization they left takes back the seat they already used (no new
-- seat, and it works even when the pool is now full, because that seat was
-- counted when they first joined). Every other rule and word is 048's.
CREATE OR REPLACE FUNCTION public.smr_redeem_code(p_user uuid, p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_code public.access_code%ROWTYPE;
BEGIN
  IF p_user IS NULL OR p_code IS NULL OR p_code = '' THEN
    RETURN 'not_found';
  END IF;
  SELECT * INTO v_code FROM public.access_code ac WHERE ac.code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT v_code.is_active THEN RETURN 'inactive'; END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at <= now() THEN RETURN 'expired'; END IF;
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

-- smr_leave_all_orgs, redefined from the LIVE body (054_required_sharing.sql,
-- which already ends grants, requests and acknowledgements; 048 and 051 are
-- older) with ONE addition: each departure is recorded, so deleting your data
-- and joining again does not spend a second seat. Security review 2, BL-4:
-- an earlier draft started from 048 and dropped the sharing revocation.
CREATE OR REPLACE FUNCTION public.smr_leave_all_orgs(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.access_code_departure (user_id, access_code_id)
    SELECT r.user_id, r.access_code_id FROM public.access_code_redemption r WHERE r.user_id = p_user
    ON CONFLICT (user_id, access_code_id) DO UPDATE SET left_at = now();
  UPDATE public.sharing_grant SET revoked_at = now(), revoked_reason = 'left_organization' WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE public.sharing_request SET status = 'cancelled' WHERE user_id = p_user AND status = 'pending';
  UPDATE public.sharing_ack SET ended_at = now() WHERE user_id = p_user AND ended_at IS NULL;
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_redeem_code(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_leave_all_orgs(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.smr_refinery_signup_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_has_refinery_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_accept_seat_offer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_decline_seat_offer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_leave_org(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_withdraw_seat_offer(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_redeem_code(uuid, text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_leave_all_orgs(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_refinery_signup_open() TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_has_refinery_seat(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_accept_seat_offer(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_decline_seat_offer(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_leave_org(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_withdraw_seat_offer(uuid) TO smr_app;
  END IF;
END $$;
