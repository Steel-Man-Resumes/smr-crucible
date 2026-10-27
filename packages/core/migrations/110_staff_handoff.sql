-- 110_staff_handoff.sql
--
-- Handoffs from a staff member to one participant, and the three new kinds of
-- suggestion they carry (staff pass lane S5, 2026-10-27).
--
-- WHY. Staff can see the employer and help directories and can often spot a
-- connection the person missed. Until now the only thing they could hand over
-- was one job at a time (057). A handoff is a short note plus up to ten items
-- (an employer with the hiring mark, a place for help, a next step, or a job),
-- sent from one staff member to one person. The person answers each item:
-- take it or pass. What they take lands in THEIR OWN existing places:
--   job, employer  -> their saved jobs (job_application, saved with their
--                     own session through /api/applications, as before)
--   resource       -> their saved help (refinery_artifact resource_list,
--                     saved with their own session through saveResourceList)
--   next step      -> their "From your case manager" list (a staff_task shared
--                     with them, the list they already tick), made by
--                     smr_accept_handoff_step() below at the moment they take it.
-- No new store holds a person's choices.
--
-- WHAT THIS ADDS
--   staff_handoff                 the packet: org, person, author, note,
--                                 status sent / seen / withdrawn.
--   staff_suggestion              kinds 'employer', 'resource', 'next_step';
--                                 columns handoff_id, employer_ref,
--                                 resource_ref, ref_name, step_title, due_on,
--                                 position.
--                                 'saved' reads as taken, 'dismissed' as passed
--                                 (057's words are kept so nothing else moves).
--   smr_accept_handoff_step()     the person takes a next step (definer).
--   org_activity entities         'suggestion' and 'handoff', with triggers.
--
-- THE RULES, AS DATABASE FACTS
--   * Staff write only inside their organization scope, as themselves, about a
--     member they REACH (restrictive reach policy, the 102 shape).
--   * A handoff's items are written in the same transaction as the handoff, by
--     its author, about its person (item guard). Nothing is added later.
--   * The person reads their own handoffs only with no organization scope, and
--     never a withdrawn one. Their only change to a handoff is sent -> seen;
--     their only change to an item is the answer (057 guard, extended here to
--     the new columns).
--   * An organization can only withdraw. Nothing is deleted (no DELETE grant).
--   * Activity rows are built from fixed words only: never a note, a reason,
--     an employer, a place or a step.
--
-- CONSENT. Nothing here reads anything the person made. Matching staff do
-- for a handoff ("connections the client missed") reads only shared scopes
-- through orgClientView, which logs every open for the person to see.
--
-- APPLY ORDER: this file, then the app release that reads it. The old app
-- never reads the new columns, and reads only kinds 'job' and 'comment'
-- (filtered in the new code too), so applying early breaks nothing.
--
-- ROLLBACK (as the owner role, in one transaction):
--   DROP TRIGGER org_activity_suggestion ON staff_suggestion;
--   DROP TRIGGER staff_suggestion_item_guard ON staff_suggestion;
--   DROP TRIGGER org_activity_handoff ON staff_handoff; DROP TRIGGER staff_handoff_guard ON staff_handoff;
--   UPDATE staff_suggestion SET status = 'withdrawn' WHERE kind IN ('employer', 'resource', 'next_step') AND status = 'open';
--   (keep the table and columns: history stays readable). Remove the
--   _migrations row only if the columns and table are dropped too.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '110 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.org_activity_write(uuid, uuid, uuid, text, text, text, text)') IS NULL
     OR to_regprocedure('public.smr_org_role(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '110 needs migration 102 (smr_staff_reach, org_activity_write, smr_org_role)';
  END IF;
  IF to_regclass('public.staff_suggestion') IS NULL OR to_regclass('public.staff_task') IS NULL OR to_regclass('public.org_activity') IS NULL THEN
    RAISE EXCEPTION '110 needs staff_suggestion (057), staff_task (055) and org_activity (102)';
  END IF;
END $$;

-- Widen a list CHECK on one column, keeping every value already allowed
-- (another lane may have added some), the 098 helper.
CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check(tbl regclass, col text, cname text, want text[])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
  have text[] := '{}';
  allv text[];
  n int := 0;
  pat text := '\(' || col || ' = ANY|' || col || ' IN';
BEGIN
  FOR c IN SELECT oid FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    have := have || ARRAY(SELECT replace(m[1], '''''', '''') FROM regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')*)''', 'g') m);
    n := n + 1;
  END LOOP;
  allv := ARRAY(SELECT DISTINCT v FROM unnest(have || want) v ORDER BY v);
  IF n = 1 AND have @> want THEN
    RETURN;
  END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I IN (%s))', tbl, cname, col,
                 (SELECT string_agg(quote_literal(v), ', ') FROM unnest(allv) v));
END
$fn$;

-- ============================================================ staff_handoff ==
CREATE TABLE IF NOT EXISTS staff_handoff (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id       UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Shown to the person verbatim, under the author's name.
  note                 TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000),
  -- t.ROY drafted it and a staff member reviewed it and pressed Send.
  drafted_by_assistant BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'seen', 'withdrawn')),
  seen_at              TIMESTAMPTZ,
  withdrawn_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_handoff_status_stamps CHECK (
    (status = 'sent' AND seen_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'seen' AND seen_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_handoff_participant ON staff_handoff (participant_user_id, status);
CREATE INDEX IF NOT EXISTS staff_handoff_org_person ON staff_handoff (access_code_id, participant_user_id, created_at DESC);

-- Who may move a handoff where. Not a definer: it reads only NEW, OLD and the
-- session settings.
CREATE OR REPLACE FUNCTION public.staff_handoff_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_org text := NULLIF(current_setting('app.org_id', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'sent' OR NEW.seen_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'a handoff starts as sent' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  -- The author's account was deleted: the reference is cleared, nothing else.
  IF OLD.author_user_id IS NOT NULL AND NEW.author_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.author_user_id)
     AND (to_jsonb(NEW) - 'author_user_id') = (to_jsonb(OLD) - 'author_user_id') THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.access_code_id, NEW.participant_user_id, NEW.author_user_id, NEW.note, NEW.drafted_by_assistant, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.access_code_id, OLD.participant_user_id, OLD.author_user_id, OLD.note, OLD.drafted_by_assistant, OLD.created_at) THEN
    RAISE EXCEPTION 'only the status of a handoff can change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'a withdrawn handoff cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    NEW.seen_at := OLD.seen_at;
    NEW.withdrawn_at := OLD.withdrawn_at;
    RETURN NEW;
  END IF;
  IF v_org IS NOT NULL THEN
    -- Inside an organization's scope the only move is to withdraw it.
    IF NEW.status <> 'withdrawn' THEN
      RAISE EXCEPTION 'an organization can withdraw a handoff, not answer it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.seen_at := OLD.seen_at;
    NEW.withdrawn_at := now();
  ELSE
    -- The person: sent -> seen, nothing else.
    IF NOT (OLD.status = 'sent' AND NEW.status = 'seen') THEN
      RAISE EXCEPTION 'the person can only open a handoff' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.seen_at := now();
    NEW.withdrawn_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staff_handoff_guard ON staff_handoff;
CREATE TRIGGER staff_handoff_guard BEFORE INSERT OR UPDATE ON staff_handoff FOR EACH ROW EXECUTE FUNCTION public.staff_handoff_guard();
REVOKE ALL ON FUNCTION public.staff_handoff_guard() FROM PUBLIC;

ALTER TABLE staff_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_handoff FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_handoff_select ON staff_handoff;
CREATE POLICY staff_handoff_select ON staff_handoff FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR (NULLIF(current_setting('app.org_id', true), '') IS NULL AND status <> 'withdrawn'
      AND participant_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS staff_handoff_insert ON staff_handoff;
CREATE POLICY staff_handoff_insert ON staff_handoff FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND status = 'sent'
  AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = staff_handoff.participant_user_id AND r.access_code_id = staff_handoff.access_code_id));
DROP POLICY IF EXISTS staff_handoff_update ON staff_handoff;
CREATE POLICY staff_handoff_update ON staff_handoff FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         OR (participant_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND NULLIF(current_setting('app.org_id', true), '') IS NULL))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         OR (participant_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND NULLIF(current_setting('app.org_id', true), '') IS NULL));
-- The 102 shape: no org scope or another org's row is not this clause's
-- business; a row of the scoped org needs reach.
DROP POLICY IF EXISTS staff_handoff_reach ON staff_handoff;
CREATE POLICY staff_handoff_reach ON staff_handoff AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- ======================================================= staff_suggestion ==
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS handoff_id UUID REFERENCES staff_handoff(id) ON DELETE CASCADE;
-- Published directory ids (employer_band_publication_v.id, resource service_id).
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS employer_ref UUID;
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS resource_ref UUID;
-- The place's name as staff saw it when they sent it (the live listing is re-read for the person).
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS ref_name TEXT CHECK (ref_name IS NULL OR length(btrim(ref_name)) BETWEEN 1 AND 200);
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS step_title TEXT CHECK (step_title IS NULL OR length(btrim(step_title)) BETWEEN 2 AND 200);
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS due_on DATE;
-- The order staff put the items in (all items of a handoff share one created_at).
ALTER TABLE staff_suggestion ADD COLUMN IF NOT EXISTS position SMALLINT CHECK (position IS NULL OR position BETWEEN 1 AND 10);
CREATE INDEX IF NOT EXISTS staff_suggestion_handoff ON staff_suggestion (handoff_id) WHERE handoff_id IS NOT NULL;

SELECT pg_temp.smr_widen_list_check('staff_suggestion', 'kind', 'staff_suggestion_kind_check',
  ARRAY['job', 'comment', 'employer', 'resource', 'next_step']);

-- The shape per kind. Replaces 057's two-kind table CHECK (found by its text,
-- whatever its generated name) with one named constraint.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.staff_suggestion'::regclass AND contype = 'c'
              AND conname <> 'staff_suggestion_shape'
              AND pg_get_constraintdef(oid) ~ 'job_title IS NOT NULL' AND pg_get_constraintdef(oid) ~ 'artifact_id IS' LOOP
    EXECUTE format('ALTER TABLE staff_suggestion DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.staff_suggestion'::regclass AND conname = 'staff_suggestion_shape') THEN
    ALTER TABLE staff_suggestion ADD CONSTRAINT staff_suggestion_shape CHECK (
      (kind = 'job' AND job_title IS NOT NULL AND company IS NOT NULL AND artifact_id IS NULL
         AND employer_ref IS NULL AND resource_ref IS NULL AND step_title IS NULL AND due_on IS NULL)
      OR (kind = 'comment' AND artifact_id IS NOT NULL AND job_title IS NULL AND handoff_id IS NULL
         AND employer_ref IS NULL AND resource_ref IS NULL AND step_title IS NULL AND due_on IS NULL)
      -- An employer: the role to look at there goes to their saved jobs as the title.
      OR (kind = 'employer' AND handoff_id IS NOT NULL AND employer_ref IS NOT NULL AND company IS NOT NULL AND job_title IS NOT NULL
         AND artifact_id IS NULL AND resource_ref IS NULL AND step_title IS NULL AND due_on IS NULL)
      OR (kind = 'resource' AND handoff_id IS NOT NULL AND resource_ref IS NOT NULL AND ref_name IS NOT NULL
         AND job_title IS NULL AND company IS NULL AND apply_url IS NULL AND artifact_id IS NULL AND employer_ref IS NULL AND step_title IS NULL AND due_on IS NULL)
      OR (kind = 'next_step' AND handoff_id IS NOT NULL AND step_title IS NOT NULL
         AND job_title IS NULL AND company IS NULL AND apply_url IS NULL AND artifact_id IS NULL AND employer_ref IS NULL AND resource_ref IS NULL));
  END IF;
END $$;

-- Items belong to their handoff: same org, same person, same author, written
-- in the transaction that made it (now() is the transaction's start), at most
-- ten. SECURITY DEFINER so the check never depends on what the writer's own
-- policies let it see.
CREATE OR REPLACE FUNCTION public.staff_suggestion_item_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  h public.staff_handoff%ROWTYPE;
BEGIN
  IF NEW.handoff_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO h FROM public.staff_handoff WHERE id = NEW.handoff_id;
  IF NOT FOUND OR h.access_code_id IS DISTINCT FROM NEW.access_code_id OR h.participant_user_id IS DISTINCT FROM NEW.client_user_id
     OR h.author_user_id IS DISTINCT FROM NEW.author_user_id OR h.status <> 'sent' OR h.created_at <> now() THEN
    RAISE EXCEPTION 'an item can only be added to a handoff while it is being sent, by its author, for its person' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.staff_suggestion s WHERE s.handoff_id = NEW.handoff_id) >= 10 THEN
    RAISE EXCEPTION 'a handoff holds at most ten items' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'open' THEN
    RAISE EXCEPTION 'an item starts open' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staff_suggestion_item_guard ON staff_suggestion;
CREATE TRIGGER staff_suggestion_item_guard BEFORE INSERT ON staff_suggestion FOR EACH ROW EXECUTE FUNCTION public.staff_suggestion_item_guard();
REVOKE ALL ON FUNCTION public.staff_suggestion_item_guard() FROM PUBLIC;

-- 057 + 102 staff_suggestion_guard, with the new columns held fixed too.
CREATE OR REPLACE FUNCTION public.staff_suggestion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.author_user_id IS NOT NULL AND NEW.author_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.author_user_id)
     AND (to_jsonb(NEW) - 'author_user_id') = (to_jsonb(OLD) - 'author_user_id') THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'an answered suggestion cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'responded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'responded_at') THEN
    RAISE EXCEPTION 'only the status of a suggestion can change' USING ERRCODE = 'check_violation';
  END IF;
  -- Inside an organization's scope the only move is to withdraw it.
  IF NULLIF(current_setting('app.org_id', true), '') IS NOT NULL AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'an organization can withdraw a suggestion, not answer it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The person answers, never withdraws (the org's word).
  IF NULLIF(current_setting('app.org_id', true), '') IS NULL AND NEW.status NOT IN ('saved', 'dismissed') THEN
    RAISE EXCEPTION 'the person can take or pass on a suggestion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.responded_at := now();
  RETURN NEW;
END;
$$;

-- The person takes a next step: it becomes a task shared with them (the
-- "From your case manager" list they already tick), owned by the staff member
-- who sent it while they are still on staff, and the item is marked taken, in
-- one statement each, one transaction. Acts only for app.user_id, only with
-- no organization scope, only on their own open item in a live handoff of an
-- organization they still belong to. Returns the task id, or NULL.
CREATE OR REPLACE FUNCTION public.smr_accept_handoff_step(p_item uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  r record;
  v_owner uuid;
  v_task uuid;
BEGIN
  IF v_user IS NULL OR NULLIF(current_setting('app.org_id', true), '') IS NOT NULL OR p_item IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.id, s.access_code_id, s.author_user_id, s.step_title, s.due_on, s.handoff_id INTO r
    FROM public.staff_suggestion s JOIN public.staff_handoff h ON h.id = s.handoff_id
   WHERE s.id = p_item AND s.client_user_id = v_user AND s.kind = 'next_step' AND s.status = 'open'
     AND h.status <> 'withdrawn'
     AND EXISTS (SELECT 1 FROM public.access_code_redemption m WHERE m.user_id = v_user AND m.access_code_id = s.access_code_id)
   FOR UPDATE OF s;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_owner := CASE WHEN r.author_user_id IS NOT NULL AND public.smr_org_role(r.access_code_id, r.author_user_id) IS NOT NULL
                  THEN r.author_user_id END;
  INSERT INTO public.staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, due_on, shared_with_participant)
  VALUES (r.access_code_id, v_user, v_owner, r.author_user_id, r.step_title, r.due_on, true)
  RETURNING id INTO v_task;
  UPDATE public.staff_suggestion SET status = 'saved' WHERE id = r.id;
  UPDATE public.staff_handoff SET status = 'seen' WHERE id = r.handoff_id AND status = 'sent';
  RETURN v_task;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_accept_handoff_step(uuid) FROM PUBLIC;

-- ================================================================ activity ==
SELECT pg_temp.smr_widen_list_check('org_activity', 'entity', 'org_activity_entity_check', ARRAY[
  'note', 'task', 'outcome', 'retention', 'enrollment', 'unit', 'staff', 'invite', 'referral', 'custom_field',
  'view', 'sharing', 'org', 'assignment', 'suggestion', 'handoff']);

-- Fixed words only. A handoff's items are not logged one by one when sent
-- (the handoff row says it); every answer is.
CREATE OR REPLACE FUNCTION public.org_activity_suggestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.handoff_id IS NULL THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'suggestion', NEW.id::text, 'created',
        CASE NEW.kind WHEN 'comment' THEN 'commented on a document they shared' ELSE 'suggested a job' END);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'withdrawn' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'suggestion', NEW.id::text, 'revoked', 'withdrew a suggestion');
    ELSIF NEW.status = 'saved' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'suggestion', NEW.id::text, 'status_changed',
        CASE NEW.kind WHEN 'job' THEN 'they saved a suggested job'
                      WHEN 'employer' THEN 'they saved a suggested employer to their jobs'
                      WHEN 'resource' THEN 'they saved a suggested place for help'
                      WHEN 'next_step' THEN 'they took on a suggested next step'
                      ELSE 'they read a comment' END);
    ELSIF NEW.status = 'dismissed' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'suggestion', NEW.id::text, 'status_changed', 'they passed on a suggestion');
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_suggestion ON staff_suggestion;
CREATE TRIGGER org_activity_suggestion AFTER INSERT OR UPDATE ON staff_suggestion
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_suggestion();
REVOKE ALL ON FUNCTION public.org_activity_suggestion() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.org_activity_handoff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NULL, 'handoff', NEW.id::text, 'created',
      'sent them a handoff' || CASE WHEN NEW.drafted_by_assistant THEN ' drafted with t.ROY' ELSE '' END);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'withdrawn' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NULL, 'handoff', NEW.id::text, 'revoked', 'withdrew a handoff');
    ELSIF NEW.status = 'seen' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NULL, 'handoff', NEW.id::text, 'status_changed', 'they opened a handoff');
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_handoff ON staff_handoff;
CREATE TRIGGER org_activity_handoff AFTER INSERT OR UPDATE ON staff_handoff
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_handoff();
REVOKE ALL ON FUNCTION public.org_activity_handoff() FROM PUBLIC;

-- ------------------------------------------------------------------ grants --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON staff_handoff FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON staff_handoff TO smr_app;
    REVOKE ALL ON staff_suggestion FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON staff_suggestion TO smr_app;
    REVOKE ALL ON FUNCTION public.smr_accept_handoff_step(uuid) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_accept_handoff_step(uuid) TO smr_app;
    REVOKE ALL ON FUNCTION public.org_activity_suggestion() FROM smr_app;
    REVOKE ALL ON FUNCTION public.org_activity_handoff() FROM smr_app;
    REVOKE ALL ON FUNCTION public.staff_suggestion_item_guard() FROM smr_app;
  END IF;
END $$;

DROP FUNCTION IF EXISTS pg_temp.smr_widen_list_check(regclass, text, text, text[]);

-- ------------------------------------------------------------ after-guards --
-- Only what this file creates or changes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'staff_handoff'
                  AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '110 after-guard: staff_handoff is not row-level protected and forced';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_handoff'
                  AND policyname = 'staff_handoff_reach' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '110 after-guard: restrictive reach policy on staff_handoff is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_suggestion'
                  AND policyname = 'staff_suggestion_reach' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '110 after-guard: 102''s restrictive reach policy on staff_suggestion is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.staff_suggestion'::regclass AND conname = 'staff_suggestion_shape') THEN
    RAISE EXCEPTION '110 after-guard: staff_suggestion_shape is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.org_activity'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) ~ '''handoff''' AND pg_get_constraintdef(oid) ~ '''suggestion''') THEN
    RAISE EXCEPTION '110 after-guard: org_activity does not accept the suggestion and handoff entities';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.staff_suggestion'::regclass AND tgname = 'staff_suggestion_item_guard')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.staff_handoff'::regclass AND tgname = 'staff_handoff_guard') THEN
    RAISE EXCEPTION '110 after-guard: a guard trigger is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.staff_handoff', 'DELETE') OR has_table_privilege('smr_app', 'public.staff_suggestion', 'DELETE') THEN
      RAISE EXCEPTION '110 after-guard: the app role can delete a handoff or a suggestion';
    END IF;
    IF NOT has_function_privilege('smr_app', 'public.smr_accept_handoff_step(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '110 after-guard: the app role cannot take a next step';
    END IF;
    IF has_function_privilege('smr_app', 'public.org_activity_write(uuid, uuid, uuid, text, text, text, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '110 after-guard: the app role can call org_activity_write';
    END IF;
  END IF;
END $$;
