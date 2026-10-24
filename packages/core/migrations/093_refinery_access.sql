-- Refinery seats (R4 gate design, Option A; B7 build lane, 2026-10-23).
--
-- WHAT THIS CHANGES BY ITSELF: nothing a person can see. The one policy row is
-- inserted with public_signup_open = true, which is today's behavior: every
-- signed-in account reaches the Refinery. The gate turns on only when a
-- platform admin uses the "close" action, which snapshots every existing
-- account into refinery_seat_legacy in the same transaction (app code,
-- lib/refinery-access-server.ts). Apply BEFORE the app release that reads it:
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
    RAISE EXCEPTION '093 needs an owner with BYPASSRLS; % has none', current_user;
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
-- Filled only by the close action, for every account that exists at that
-- moment. Never written on a person's behalf.
CREATE TABLE refinery_seat_legacy (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
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
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
-- One open offer per person per organization.
CREATE UNIQUE INDEX org_seat_offer_one_open ON org_seat_offer(access_code_id, user_id) WHERE status = 'pending';
CREATE INDEX org_seat_offer_user ON org_seat_offer(user_id, status);

-- ----------------------------------------------------- seat request kind --
-- A person without a seat asks Troy for one through his existing review queue.
ALTER TABLE progression_request DROP CONSTRAINT progression_request_kind_check;
ALTER TABLE progression_request ADD CONSTRAINT progression_request_kind_check
  CHECK (kind IN ('unlock','ai_bonus','feedback','bug','seat'));

-- ------------------------------------------------------------------- RLS --
ALTER TABLE refinery_access_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE refinery_access_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON refinery_access_policy FROM PUBLIC;
-- Any signed-in reader may see the switch (the seat page says whether it is on).
CREATE POLICY refinery_access_policy_read ON refinery_access_policy FOR SELECT
  USING (NULLIF(current_setting('app.user_id', true), '') IS NOT NULL);
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
    GRANT SELECT, UPDATE ON refinery_access_policy TO smr_app;
    GRANT SELECT, INSERT ON refinery_seat_legacy TO smr_app;
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
-- ok | already_member | not_found | inactive | expired | full.
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
  v_out := public.smr_redeem_code(p_user, v_code);
  IF v_out = 'ok' OR v_out = 'already_member' THEN
    UPDATE public.org_seat_offer SET status = 'accepted', decided_at = now() WHERE id = p_offer;
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
  RETURN 'ok';
END;
$$;

-- Leave ONE organization (Settings, "Leave this organization"). Before this
-- the only way out was delete-my-data (smr_leave_all_orgs). Same shape: the
-- membership and that organization's staff assignment go; the seat is NOT
-- handed back (durable seats, Troy 2026-06-10). Returns rows removed (0 or 1).
CREATE OR REPLACE FUNCTION public.smr_leave_org(p_user uuid, p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user IS NULL OR p_org IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.client_staff_assignment WHERE client_user_id = p_user AND access_code_id = p_org;
  DELETE FROM public.access_code_redemption WHERE user_id = p_user AND access_code_id = p_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.smr_refinery_signup_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_has_refinery_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_accept_seat_offer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_decline_seat_offer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_leave_org(uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_refinery_signup_open() TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_has_refinery_seat(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_accept_seat_offer(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_decline_seat_offer(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_leave_org(uuid, uuid) TO smr_app;
  END IF;
END $$;
