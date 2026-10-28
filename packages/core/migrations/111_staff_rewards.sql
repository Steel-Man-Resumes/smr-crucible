-- 111_staff_rewards.sql
-- Staff rewards: good catches between colleagues, private milestones, a
-- personal on/off switch, and recognition notes a staff member agrees to
-- (staff side build lane S6, 2026-10-27).
--
-- RULES THIS FILE MAKES INTO DATABASE FACTS
--   * Off by default. staff_rewards_setting.rewards_on starts false and only
--     the staff member writes their own row. An organization cannot turn it on
--     for anyone (Troy 2026-10-27: "give them the option to toggle that on in
--     their own setting"; research: games help when people agree to them).
--   * Never a score on client outcomes, records, notes written or contacts
--     made, and never a reward for a participant's decision or consent.
--     Milestones come from the staff member's own acts (closing a referral
--     loop with the reason written, an ask sent with a clear reason, a first
--     saved view, using a t.ROY draft, giving a good catch, an approved
--     directory contribution), each counted once.
--   * Nothing is recorded while the switch is off; turning it on derives the
--     milestones again from the facts.
--   * The only team board shows recognition GIVEN (a "received" board lowered
--     helping in the study we follow). staff_kudos_giver_board() lists only
--     givers who turned rewards on and left "show me on the board" on.
--   * A good catch never reaches a colleague who cannot see the person the
--     work was about: when the linked work is about a participant, sender and
--     receiver must both reach them (smr_staff_reach), and the RESTRICTIVE
--     reach policy hides the row from a reader who no longer does.
--   * A recognition note goes into a funder report only with the staff
--     member's yes (status 'approved', set only by them).
--
-- WHAT THIS ADDS
--   staff_rewards_setting   one row per staff member per organization: rewards_on
--                           (default false), board_ok (default true). Owner-only.
--   staff_rewards_org       per organization: team board on/off, recognition
--                           notes on/off, and the program's own words for any
--                           reward with cash value (that is the program's call,
--                           never Steel Man's). Managers write, staff read.
--   staff_kudos             a "good catch" from one colleague to another about a
--                           piece of work (optional link to a task, note,
--                           referral or listing). Sender and receiver read it.
--   staff_milestone         private milestones, written only by definer
--                           functions (never by the app), read by their owner.
--   staff_recognition_note  a manager's note about a staff member's work for a
--                           funder report; the staff member approves, declines
--                           or later withdraws it.
--   functions               staff_rewards_member, staff_rewards_refresh (the
--                           caller's own milestones from facts), the giver board,
--                           staff_milestone_grant / _revoke (definer-only, never
--                           the app: lane S5's handoff trigger and 112 call them),
--                           guards for every table.
--
-- NOTHING HERE is shown to a participant or written to the activity log (no
-- participant record changes). Time saved is not stored: the app computes it
-- from the staff member's own accepted ai_skill_run rows (106).
--
-- APPLY AFTER 102 (smr_staff_reach), 104 (smr_org_manager) and 106
-- (ai_skill_run). APPLY BEFORE the app release that ships the Wins page (the
-- RLS health check lists these tables).
--
-- ROLLBACK, in this order:
--   1. Revert the S6 app code and deploy that.
--   2. As the owner role, in one transaction:
--        DROP TABLE IF EXISTS staff_recognition_note, staff_milestone, staff_kudos,
--          staff_rewards_org, staff_rewards_setting CASCADE;
--        DROP FUNCTION IF EXISTS public.staff_rewards_refresh(), public.staff_kudos_giver_board(int),
--          public.staff_milestone_grant(uuid, uuid, text, uuid), public.staff_milestone_revoke(uuid, uuid, uuid),
--          public.staff_rewards_member(uuid, uuid), public.staff_kudos_guard(),
--          public.staff_rewards_setting_guard(), public.staff_rewards_org_guard(),
--          public.staff_recognition_note_guard(), public.staff_milestone_guard(),
--          public.staff_text_participant_names(text);
--        DELETE FROM _migrations WHERE filename = '111_staff_rewards.sql';
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '111 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '111 needs migration 102 (smr_staff_reach) first';
  END IF;
  IF to_regprocedure('public.smr_org_manager(uuid)') IS NULL OR to_regprocedure('public.smr_org_staff_session(uuid)') IS NULL THEN
    RAISE EXCEPTION '111 needs migration 104 (smr_org_manager) first';
  END IF;
  IF to_regclass('public.ai_skill_run') IS NULL THEN
    RAISE EXCEPTION '111 needs migration 106 (ai_skill_run) first';
  END IF;
END $$;

-- --------------------------------------------------------------- helpers --
-- Owner of the organization or anyone on its staff. Definer: org_staff is RLS-forced.
CREATE OR REPLACE FUNCTION public.staff_rewards_member(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p_org IS NOT NULL AND p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user));
$$;
REVOKE ALL ON FUNCTION public.staff_rewards_member(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------- tables --
CREATE TABLE IF NOT EXISTS staff_rewards_setting (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  rewards_on     BOOLEAN NOT NULL DEFAULT false,
  board_ok       BOOLEAN NOT NULL DEFAULT true,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, access_code_id)
);

CREATE TABLE IF NOT EXISTS staff_rewards_org (
  access_code_id       UUID PRIMARY KEY REFERENCES access_code(id) ON DELETE CASCADE,
  team_board_on        BOOLEAN NOT NULL DEFAULT true,
  recognition_notes_on BOOLEAN NOT NULL DEFAULT true,
  -- The program's own words for anything with cash value (a gift card, a day
  -- off). Shown on Wins as the program's offer; Steel Man never sets it.
  program_rewards      TEXT CHECK (program_rewards IS NULL OR length(btrim(program_rewards)) BETWEEN 1 AND 500),
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_kudos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  from_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body                TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 3 AND 280),
  work_kind           TEXT CHECK (work_kind IN ('task', 'note', 'referral', 'listing', 'other')),
  work_id             UUID,
  -- Set by the guard from the linked work, never taken from the app.
  participant_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at        TIMESTAMPTZ,
  CONSTRAINT staff_kudos_not_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT staff_kudos_work_named CHECK (work_id IS NULL OR work_kind IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS staff_kudos_to ON staff_kudos (access_code_id, to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_kudos_from ON staff_kudos (access_code_id, from_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_milestone (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- The catalog lives in code (staffRewardsShared.ts); the shape is fixed here.
  key            TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  -- What earned it, when one row did (an approved directory contribution).
  source_ref     UUID,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When its owner saw the celebration. The only column the app may change.
  seen_at        TIMESTAMPTZ,
  UNIQUE (user_id, access_code_id, key)
);

CREATE TABLE IF NOT EXISTS staff_recognition_note (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  about_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  written_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 500),
  period_label   TEXT CHECK (period_label IS NULL OR length(btrim(period_label)) BETWEEN 1 AND 60),
  status         TEXT NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'approved', 'declined', 'withdrawn')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ,
  CONSTRAINT staff_recognition_decided CHECK ((status = 'asked') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS staff_recognition_note_about ON staff_recognition_note (access_code_id, about_user_id, created_at DESC);

-- ---------------------------------------------------------------- guards --
CREATE OR REPLACE FUNCTION public.staff_rewards_setting_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF v_me IS NULL OR NEW.user_id IS DISTINCT FROM v_me OR NEW.access_code_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'only you set your own rewards, in your own organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.access_code_id <> OLD.access_code_id) THEN
    RAISE EXCEPTION 'a rewards setting stays with its person' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.staff_rewards_member(v_org, v_me) THEN
    RAISE EXCEPTION 'rewards are for staff of this organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_rewards_setting_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_rewards_setting_guard ON staff_rewards_setting;
CREATE TRIGGER staff_rewards_setting_guard BEFORE INSERT OR UPDATE ON staff_rewards_setting
  FOR EACH ROW EXECUTE FUNCTION public.staff_rewards_setting_guard();

CREATE OR REPLACE FUNCTION public.staff_rewards_org_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.access_code_id <> OLD.access_code_id THEN
    RAISE EXCEPTION 'program reward settings stay with their organization' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := v_me;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_rewards_org_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_rewards_org_guard ON staff_rewards_org;
CREATE TRIGGER staff_rewards_org_guard BEFORE INSERT OR UPDATE ON staff_rewards_org
  FOR EACH ROW EXECUTE FUNCTION public.staff_rewards_org_guard();

-- A good catch: who may send what, and about whom.
CREATE OR REPLACE FUNCTION public.staff_kudos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_participant uuid;
  v_found boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only the sender, only to withdraw, only once.
    IF (to_jsonb(NEW) - 'withdrawn_at') IS DISTINCT FROM (to_jsonb(OLD) - 'withdrawn_at') THEN
      RAISE EXCEPTION 'a good catch is not edited; withdraw it and send a new one' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL THEN
      RAISE EXCEPTION 'a good catch is withdrawn once' USING ERRCODE = 'check_violation';
    END IF;
    IF v_me IS NULL OR OLD.from_user_id <> v_me THEN
      RAISE EXCEPTION 'only the person who sent it withdraws a good catch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.withdrawn_at := now();
    RETURN NEW;
  END IF;

  IF v_me IS NULL OR v_org IS NULL OR NEW.from_user_id IS DISTINCT FROM v_me OR NEW.access_code_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'a good catch is sent by you, in your own organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.staff_rewards_member(v_org, v_me) OR NOT public.staff_rewards_member(v_org, NEW.to_user_id) THEN
    RAISE EXCEPTION 'good catches go between colleagues in the same organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a good catch starts sent' USING ERRCODE = 'check_violation';
  END IF;
  -- Kindness, not volume: twenty a day is more than anyone needs.
  IF (SELECT count(*) FROM public.staff_kudos k
       WHERE k.access_code_id = v_org AND k.from_user_id = v_me AND k.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'that is a lot of good catches for one day; try again tomorrow' USING ERRCODE = 'check_violation';
  END IF;

  -- The participant comes from the linked work, never from the request.
  NEW.participant_user_id := NULL;
  IF NEW.work_id IS NOT NULL THEN
    IF NEW.work_kind = 'task' THEN
      SELECT t.client_user_id, true INTO v_participant, v_found FROM public.staff_task t WHERE t.id = NEW.work_id AND t.access_code_id = v_org;
    ELSIF NEW.work_kind = 'note' THEN
      SELECT n.client_user_id, true INTO v_participant, v_found FROM public.case_note n WHERE n.id = NEW.work_id AND n.access_code_id = v_org;
    ELSIF NEW.work_kind = 'referral' AND to_regclass('public.referral') IS NOT NULL THEN
      EXECUTE 'SELECT participant_user_id, true FROM public.referral WHERE id = $1 AND access_code_id = $2'
        INTO v_participant, v_found USING NEW.work_id, v_org;
    ELSIF NEW.work_kind = 'listing' THEN
      -- A directory listing names no participant; it must be a real listing.
      IF to_regclass('public.employer_org') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.employer_org WHERE id = $1)' INTO v_found USING NEW.work_id;
      END IF;
      IF NOT COALESCE(v_found, false) AND to_regclass('public.resource_service') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.resource_service WHERE id = $1)' INTO v_found USING NEW.work_id;
      END IF;
    ELSIF NEW.work_kind = 'other' THEN
      RAISE EXCEPTION 'other work is not linked; leave the link out' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT COALESCE(v_found, false) THEN
      RAISE EXCEPTION 'that piece of work is not in your organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_participant IS NOT NULL THEN
      IF NOT public.smr_staff_reach(v_org, v_me, v_participant) OR NOT public.smr_staff_reach(v_org, NEW.to_user_id, v_participant) THEN
        RAISE EXCEPTION 'you can only point to work about someone you both can see' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.participant_user_id := v_participant;
    END IF;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_kudos_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_kudos_guard ON staff_kudos;
CREATE TRIGGER staff_kudos_guard BEFORE INSERT OR UPDATE ON staff_kudos
  FOR EACH ROW EXECUTE FUNCTION public.staff_kudos_guard();

-- Milestones: the app may only mark one seen.
CREATE OR REPLACE FUNCTION public.staff_milestone_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - 'seen_at') IS DISTINCT FROM (to_jsonb(OLD) - 'seen_at') THEN
    RAISE EXCEPTION 'a milestone is earned, not edited' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.seen_at IS NOT NULL THEN
    NEW.seen_at := OLD.seen_at;
  ELSIF NEW.seen_at IS NOT NULL THEN
    NEW.seen_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_milestone_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_milestone_guard ON staff_milestone;
CREATE TRIGGER staff_milestone_guard BEFORE UPDATE ON staff_milestone
  FOR EACH ROW EXECUTE FUNCTION public.staff_milestone_guard();

-- Recognition notes: a manager writes; only the person it is about says yes.
CREATE OR REPLACE FUNCTION public.staff_recognition_note_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NULL OR NEW.access_code_id IS DISTINCT FROM v_org OR NEW.written_by IS DISTINCT FROM v_me THEN
      RAISE EXCEPTION 'a recognition note is written by you, in your own organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = v_org AND a.partner_user_id = v_me)
       AND NOT EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = v_org AND s.user_id = v_me AND s.role = 'org_admin') THEN
      RAISE EXCEPTION 'only the owner or an org admin writes a recognition note' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.staff_rewards_member(v_org, NEW.about_user_id) OR NEW.about_user_id = v_me THEN
      RAISE EXCEPTION 'a recognition note is about a colleague on your staff' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_rewards_org o WHERE o.access_code_id = v_org AND NOT o.recognition_notes_on) THEN
      RAISE EXCEPTION 'recognition notes are turned off for this organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'asked' OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'a recognition note starts as a question to the person' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.access_code_id <> OLD.access_code_id OR NEW.about_user_id <> OLD.about_user_id
     OR NEW.written_by IS DISTINCT FROM OLD.written_by OR NEW.created_at <> OLD.created_at THEN
    -- A deleted writer's account nulls written_by (ON DELETE SET NULL): allow only that.
    IF NOT (NEW.written_by IS NULL AND OLD.written_by IS NOT NULL AND (to_jsonb(NEW) - 'written_by') = (to_jsonb(OLD) - 'written_by')) THEN
      RAISE EXCEPTION 'a recognition note keeps who wrote it and who it is about' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.period_label IS DISTINCT FROM OLD.period_label THEN
    IF v_me IS NULL OR OLD.written_by IS DISTINCT FROM v_me OR OLD.status <> 'asked' OR NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'only the writer edits a note, and only before it is answered' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_me IS NULL OR OLD.about_user_id <> v_me THEN
      RAISE EXCEPTION 'only the person a note is about answers it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT ((OLD.status = 'asked' AND NEW.status IN ('approved', 'declined'))
            OR (OLD.status = 'approved' AND NEW.status = 'withdrawn')
            OR (OLD.status = 'declined' AND NEW.status = 'approved')) THEN
      RAISE EXCEPTION 'that change to a recognition note is not allowed' USING ERRCODE = 'check_violation';
    END IF;
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_recognition_note_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_recognition_note_guard ON staff_recognition_note;
CREATE TRIGGER staff_recognition_note_guard BEFORE INSERT OR UPDATE ON staff_recognition_note
  FOR EACH ROW EXECUTE FUNCTION public.staff_recognition_note_guard();

-- ---------------------------------------------------- milestone writers --
-- Definer-only (the app role never executes these): 112's decision function
-- and lane S5's handoff trigger call them as the owner.
CREATE OR REPLACE FUNCTION public.staff_milestone_grant(p_user uuid, p_org uuid, p_key text, p_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF p_user IS NULL OR p_org IS NULL OR p_key IS NULL OR NOT public.staff_rewards_member(p_org, p_user) THEN
    RETURN false;
  END IF;
  -- Nothing is recorded while the person's Wins switch is off (review round 1,
  -- nit 12). Turning it on runs staff_rewards_refresh, which derives every
  -- milestone again from the facts, including approved directory work.
  IF NOT EXISTS (SELECT 1 FROM public.staff_rewards_setting s WHERE s.user_id = p_user AND s.access_code_id = p_org AND s.rewards_on) THEN
    RETURN false;
  END IF;
  INSERT INTO public.staff_milestone (user_id, access_code_id, key, source_ref)
  VALUES (p_user, p_org, p_key, p_ref)
  ON CONFLICT (user_id, access_code_id, key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_milestone_grant(uuid, uuid, text, uuid) FROM PUBLIC;

-- Credit comes back off when an approval is reverted (112): every milestone that row earned.
CREATE OR REPLACE FUNCTION public.staff_milestone_revoke(p_user uuid, p_org uuid, p_ref uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.staff_milestone m WHERE m.user_id = p_user AND m.access_code_id = p_org AND m.source_ref = p_ref;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_milestone_revoke(uuid, uuid, uuid) FROM PUBLIC;

-- Which participants does a piece of staff-written text name? Case-insensitive
-- whole words: any full, first or last name (two letters or more) of ANY
-- participant of the organization in scope, not only the ones the writer
-- reaches. Returns the ids the caller reaches, and only a yes/no for anyone
-- else (so it never tells a staff member who else is in the program).
-- Used before a good catch, a recognition note or a directory draft is saved.
CREATE OR REPLACE FUNCTION public.staff_text_participant_names(p_text text) RETURNS TABLE (reached uuid[], other boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_words text[];
BEGIN
  IF v_me IS NULL OR v_org IS NULL OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RAISE EXCEPTION 'only staff of this organization check their words here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_words := ARRAY(SELECT w FROM unnest(regexp_split_to_array(lower(COALESCE(p_text, '')), '[^[:alpha:]'']+')) AS w WHERE length(w) >= 2);
  RETURN QUERY
    WITH named AS (
      SELECT r.user_id
        FROM public.access_code_redemption r JOIN public.users u ON u.id = r.user_id
       WHERE r.access_code_id = v_org
         AND ARRAY(SELECT t FROM unnest(regexp_split_to_array(lower(COALESCE(u.name, '')), '[^[:alpha:]'']+')) AS t WHERE length(t) >= 2) && v_words
    )
    SELECT COALESCE(array_agg(n.user_id) FILTER (WHERE public.smr_staff_reach(v_org, v_me, n.user_id)), '{}'::uuid[]),
           COALESCE(bool_or(NOT public.smr_staff_reach(v_org, v_me, n.user_id)), false)
      FROM named n;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_text_participant_names(text) FROM PUBLIC;

-- The caller's own craft and learning milestones, from facts. Each is earned
-- once; nothing here counts notes, contacts, messages or any client outcome.
-- Returns how many new milestones were earned.
CREATE OR REPLACE FUNCTION public.staff_rewards_refresh() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  n int := 0;
  k text;
  ref uuid;
  closed boolean;
  learned int;
BEGIN
  IF v_me IS NULL OR v_org IS NULL OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_rewards_setting s WHERE s.user_id = v_me AND s.access_code_id = v_org AND s.rewards_on) THEN
    RETURN 0;  -- Wins off: nothing recorded
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_kudos k WHERE k.access_code_id = v_org AND k.from_user_id = v_me AND k.withdrawn_at IS NULL) THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'first_kudos_given', NULL)::int;
  END IF;
  IF (SELECT count(DISTINCT date_trunc('week', k.created_at)) FROM public.staff_kudos k
       WHERE k.access_code_id = v_org AND k.from_user_id = v_me AND k.withdrawn_at IS NULL) >= 4 THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'kudos_four_weeks', NULL)::int;
  END IF;
  IF to_regclass('public.saved_view') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.saved_view v WHERE v.access_code_id = v_org AND v.owner_user_id = v_me) THEN
      n := n + public.staff_milestone_grant(v_me, v_org, 'first_saved_view', NULL)::int;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_skill_run r WHERE r.access_code_id = v_org AND r.actor_user_id = v_me AND r.accepted_by = v_me) THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'first_draft_accepted', NULL)::int;
  END IF;
  -- Learning badges: a t.ROY tool tried AND its draft used (accepted), once per tool.
  FOR k IN SELECT DISTINCT r.skill FROM public.ai_skill_run r
            WHERE r.access_code_id = v_org AND r.actor_user_id = v_me AND r.accepted_by = v_me
              AND r.skill IN ('staff-note-from-bullets', 'staff-prep-me', 'staff-find-help', 'staff-funder-narrative',
                              'staff-timeline-summary', 'staff-outreach-draft', 'staff-caseload-digest', 'staff-triage-today')
  LOOP
    n := n + public.staff_milestone_grant(v_me, v_org, 'learn_' || replace(substr(k, 7), '-', '_'), NULL)::int;
  END LOOP;
  SELECT count(DISTINCT r.skill) INTO learned FROM public.ai_skill_run r
   WHERE r.access_code_id = v_org AND r.actor_user_id = v_me AND r.accepted_by = v_me AND r.skill <> 'staff-general';
  IF learned >= 3 THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'learn_three_tools', NULL)::int;
  END IF;
  -- Closing a referral loop is the staff member's own act: the referral reached
  -- an end (any end: delivered, declined, unable to reach, closed) AND they
  -- wrote the reason down. What happened for the person never counts.
  IF to_regclass('public.referral') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM public.referral f WHERE f.access_code_id = $1 AND f.owner_staff_id = $2
               AND f.status IN ('service_delivered', 'declined', 'unable_to_contact', 'closed')
               AND length(btrim(COALESCE(f.status_reason, ''))) > 0)$q$
      INTO STRICT closed USING v_org, v_me;
    IF closed THEN
      n := n + public.staff_milestone_grant(v_me, v_org, 'first_referral_loop_closed', NULL)::int;
    END IF;
  END IF;
  -- An ask sent with a clear reason (20 characters or more), whatever the
  -- person answers: never a reward for anyone's consent (review round 1).
  IF EXISTS (SELECT 1 FROM public.sharing_request s WHERE s.access_code_id = v_org AND s.requested_by = v_me
               AND length(btrim(s.reason)) >= 20) THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'first_clear_ask', NULL)::int;
  END IF;
  -- A week with nothing past due: on staff a week or more, finished at least
  -- one task this week, nothing open is past due, and nothing finished this
  -- week was late. Things the staff member controls; never a count.
  IF EXISTS (SELECT 1 FROM public.staff_task t WHERE t.access_code_id = v_org AND t.owner_user_id = v_me
               AND t.done_at > now() - interval '7 days')
     AND NOT EXISTS (SELECT 1 FROM public.staff_task t WHERE t.access_code_id = v_org AND t.owner_user_id = v_me
               AND t.done_at IS NULL AND t.cancelled_at IS NULL AND t.due_on < current_date)
     AND NOT EXISTS (SELECT 1 FROM public.staff_task t WHERE t.access_code_id = v_org AND t.owner_user_id = v_me
               AND t.done_at > now() - interval '7 days' AND t.due_on IS NOT NULL AND t.done_at::date > t.due_on)
     AND (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = v_org AND s.user_id = v_me AND s.created_at < now() - interval '7 days')
          OR EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = v_org AND a.partner_user_id = v_me AND a.created_at < now() - interval '7 days')) THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'clear_week', NULL)::int;
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_recognition_note r WHERE r.access_code_id = v_org AND r.about_user_id = v_me AND r.status = 'approved') THEN
    n := n + public.staff_milestone_grant(v_me, v_org, 'recognized_by_program', NULL)::int;
  END IF;
  -- Approved directory work (112), derived again here so turning Wins on
  -- later loses nothing. Each milestone points at the contribution that
  -- earned it, so a revert takes it back. Credit: a call or a warm
  -- introduction 3, a correction 2, a new row 1; thresholds 3, 10, 25
  -- (staffRewardsShared.ts RESEARCH_THRESHOLDS).
  IF to_regclass('public.directory_contribution') IS NOT NULL THEN
    FOR k, ref IN EXECUTE $q$
      WITH mine AS (
        SELECT c.id, c.outcome, c.decided_at,
               sum(CASE c.outcome WHEN 'verified_call' THEN 3 WHEN 'warm_intro' THEN 3 WHEN 'correction' THEN 2 WHEN 'new_row' THEN 1 ELSE 0 END)
                 OVER (ORDER BY c.decided_at, c.id) AS running
          FROM public.directory_contribution c
         WHERE c.access_code_id = $1 AND c.submitted_by = $2 AND c.status = 'approved')
      SELECT DISTINCT ON (key) key, id FROM (
        SELECT CASE outcome WHEN 'verified_call' THEN 'first_verified_listing' WHEN 'warm_intro' THEN 'first_warm_intro'
                            WHEN 'correction' THEN 'first_correction' ELSE 'first_new_place' END AS key, id, decided_at FROM mine
        UNION ALL SELECT 'research_helper', id, decided_at FROM mine WHERE running >= 3
        UNION ALL SELECT 'research_partner', id, decided_at FROM mine WHERE running >= 10
        UNION ALL SELECT 'directory_anchor', id, decided_at FROM mine WHERE running >= 25) x
      ORDER BY key, decided_at, id $q$ USING v_org, v_me
    LOOP
      n := n + public.staff_milestone_grant(v_me, v_org, k, ref)::int;
    END LOOP;
  END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_rewards_refresh() FROM PUBLIC;

-- The team board: recognition GIVEN, never received. Only givers who turned
-- rewards on and left "show me on the board" on; only when the organization
-- keeps the board on. First names only, in name order: no counts, no ranking
-- (review round 1: nothing that grows with volume).
CREATE OR REPLACE FUNCTION public.staff_kudos_giver_board(p_days int) RETURNS TABLE (giver_id uuid, giver_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me   uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org  uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_days int  := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
BEGIN
  IF v_me IS NULL OR v_org IS NULL OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_rewards_org o WHERE o.access_code_id = v_org AND NOT o.team_board_on) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT k.from_user_id, COALESCE(NULLIF(split_part(btrim(u.name), ' ', 1), ''), 'A colleague')::text
      FROM public.staff_kudos k
      JOIN public.staff_rewards_setting s ON s.user_id = k.from_user_id AND s.access_code_id = v_org AND s.rewards_on AND s.board_ok
      JOIN public.users u ON u.id = k.from_user_id
     WHERE k.access_code_id = v_org AND k.withdrawn_at IS NULL AND k.created_at > now() - make_interval(days => v_days)
       AND public.staff_rewards_member(v_org, k.from_user_id)
     GROUP BY k.from_user_id, u.name
     ORDER BY 2, 1;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_kudos_giver_board(int) FROM PUBLIC;

-- ------------------------------------------------------------------- RLS --
ALTER TABLE staff_rewards_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_rewards_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_rewards_org ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_rewards_org FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_kudos FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_milestone FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_recognition_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_recognition_note FORCE ROW LEVEL SECURITY;

-- Your own setting, in the organization in scope. Nobody else reads it.
DROP POLICY IF EXISTS staff_rewards_setting_own ON staff_rewards_setting;
CREATE POLICY staff_rewards_setting_own ON staff_rewards_setting FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS staff_rewards_org_read ON staff_rewards_org;
CREATE POLICY staff_rewards_org_read ON staff_rewards_org FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_staff_session(access_code_id));
DROP POLICY IF EXISTS staff_rewards_org_insert ON staff_rewards_org;
CREATE POLICY staff_rewards_org_insert ON staff_rewards_org FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS staff_rewards_org_update ON staff_rewards_org;
CREATE POLICY staff_rewards_org_update ON staff_rewards_org FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));

-- A good catch: the sender and the receiver read it; the sender sends and withdraws.
DROP POLICY IF EXISTS staff_kudos_select ON staff_kudos;
CREATE POLICY staff_kudos_select ON staff_kudos FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (from_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              OR to_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS staff_kudos_insert ON staff_kudos;
CREATE POLICY staff_kudos_insert ON staff_kudos FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND from_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS staff_kudos_update ON staff_kudos;
CREATE POLICY staff_kudos_update ON staff_kudos FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND from_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND from_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- Reach (SPEC rule 3): work about a person shows only while the reader reaches them.
DROP POLICY IF EXISTS staff_kudos_reach ON staff_kudos;
CREATE POLICY staff_kudos_reach ON staff_kudos AS RESTRICTIVE FOR ALL
  USING (participant_user_id IS NULL
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (participant_user_id IS NULL
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- Milestones: only their owner reads them, and may only mark one seen.
DROP POLICY IF EXISTS staff_milestone_own ON staff_milestone;
CREATE POLICY staff_milestone_own ON staff_milestone FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS staff_milestone_seen ON staff_milestone;
CREATE POLICY staff_milestone_seen ON staff_milestone FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Recognition notes: the person it is about and the organization's managers.
DROP POLICY IF EXISTS staff_recognition_note_select ON staff_recognition_note;
CREATE POLICY staff_recognition_note_select ON staff_recognition_note FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (about_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR public.smr_org_manager(access_code_id)));
DROP POLICY IF EXISTS staff_recognition_note_insert ON staff_recognition_note;
CREATE POLICY staff_recognition_note_insert ON staff_recognition_note FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND written_by = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS staff_recognition_note_update ON staff_recognition_note;
CREATE POLICY staff_recognition_note_update ON staff_recognition_note FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (about_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              OR written_by = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- ---------------------------------------------------------------- grants --
REVOKE ALL ON staff_rewards_setting, staff_rewards_org, staff_kudos, staff_milestone, staff_recognition_note FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON staff_rewards_setting, staff_rewards_org, staff_kudos, staff_milestone, staff_recognition_note FROM smr_app;
    GRANT SELECT, INSERT ON staff_rewards_setting TO smr_app;
    GRANT UPDATE (rewards_on, board_ok) ON staff_rewards_setting TO smr_app;
    GRANT SELECT, INSERT ON staff_rewards_org TO smr_app;
    GRANT UPDATE (team_board_on, recognition_notes_on, program_rewards) ON staff_rewards_org TO smr_app;
    GRANT SELECT, INSERT ON staff_kudos TO smr_app;
    GRANT UPDATE (withdrawn_at) ON staff_kudos TO smr_app;
    GRANT SELECT ON staff_milestone TO smr_app;
    GRANT UPDATE (seen_at) ON staff_milestone TO smr_app;
    GRANT SELECT, INSERT ON staff_recognition_note TO smr_app;
    GRANT UPDATE (body, period_label, status) ON staff_recognition_note TO smr_app;
    -- staff_rewards_member answers "is this person staff there" for ANY org:
    -- definer code only (review round 1), never the app.
    REVOKE ALL ON FUNCTION public.staff_rewards_member(uuid, uuid) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.staff_text_participant_names(text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.staff_rewards_refresh() TO smr_app;
    GRANT EXECUTE ON FUNCTION public.staff_kudos_giver_board(int) TO smr_app;
    REVOKE ALL ON FUNCTION public.staff_milestone_grant(uuid, uuid, text, uuid) FROM smr_app;
    REVOKE ALL ON FUNCTION public.staff_milestone_revoke(uuid, uuid, uuid) FROM smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------ after-guards --
-- Only what this migration created.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_rewards_setting', 'staff_rewards_org', 'staff_kudos', 'staff_milestone', 'staff_recognition_note'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '111: % must have row-level security enabled and forced', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_kudos'
                   AND policyname = 'staff_kudos_reach' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '111: the staff_kudos reach policy must be RESTRICTIVE';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('staff_rewards_setting_guard', 'staff_rewards_org_guard', 'staff_kudos_guard', 'staff_milestone_guard', 'staff_recognition_note_guard')) <> 5 THEN
    RAISE EXCEPTION '111: a guard trigger is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.staff_milestone', 'INSERT')
       OR has_table_privilege('smr_app', 'public.staff_milestone', 'DELETE')
       OR has_column_privilege('smr_app', 'public.staff_milestone', 'key', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.staff_kudos', 'DELETE')
       OR has_column_privilege('smr_app', 'public.staff_kudos', 'body', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.staff_recognition_note', 'DELETE')
       OR has_column_privilege('smr_app', 'public.staff_recognition_note', 'about_user_id', 'UPDATE') THEN
      RAISE EXCEPTION '111: smr_app holds more than it may on the rewards tables';
    END IF;
    IF has_function_privilege('smr_app', 'public.staff_rewards_member(uuid, uuid)', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.staff_milestone_grant(uuid, uuid, text, uuid)', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.staff_milestone_revoke(uuid, uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '111: smr_app must never award or take back a milestone directly';
    END IF;
  END IF;
END $$;
