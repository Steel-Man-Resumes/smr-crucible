-- 109_team_talk.sql
-- Team talk inside the Refinery (staff side build, lane S4, 2026-10-27):
-- comments with mentions, a personal inbox, tasks handed to a colleague,
-- change requests from staff to the people who run the organization, and an
-- optional supervisor review of case notes.
--
-- WHAT THIS ADDS
--   team_comment            a comment by a staff member, about one participant
--                           (reach-restricted) or about nobody (a team thread).
--                           Never deleted; a correction keeps the earlier
--                           wording in team_comment_version, like case notes.
--                           @mentions are stored as user ids. A mention of a
--                           colleague who cannot reach that participant is
--                           refused by the database.
--   staff_inbox_item        one person's inbox: mentions, replies, tasks given
--                           to them, change requests and their answers, notes
--                           to review (and, later, kudos and handoff answers).
--                           Owner-only. Written ONLY by the definer triggers
--                           below (smr_inbox_write); the app reads it and
--                           marks items read. Short fixed words, never a body.
--   staff_task              may be owned by a colleague: given at creation or
--                           handed on later, only to someone on this
--                           organization's staff who reaches the participant.
--   org_change_request      staff ask the owner and org admins for a change
--   org_change_reply        (fields, layouts, views, structure, words, what
--                           staff may change). Status open, accepted,
--                           declined, done; managers answer; both sides reply.
--   note_review             optional, per organization (org_profile.modules
--   note_review_event       note_review, default off): a note is sent for
--                           review, then approved (locked) or sent back with a
--                           required comment. Read-only while pending.
--   org_activity            entities 'comment' and 'change_request' join the
--                           CHECK; summaries are fixed words, never bodies.
--
-- WHO MAY DO WHAT, AS DATABASE FACTS
--   comments    read: staff of the org (owner or org_staff) inside its scope;
--               about a participant only while the reader reaches them.
--               write: as yourself, about someone you reach (or nobody);
--               correct: only your own; never delete. Never a participant.
--   inbox       read and mark read: only your own items, in the org in scope;
--               an item about a participant only while you still reach them.
--   tasks       hand a task to: a team member who reaches the person. Who may
--               hand it on: its creator, its current owner, or someone who
--               assigns work (owner, org admin, or an org.client.assign grant,
--               a deny wins). A task about nobody can be handed on only by
--               someone who sees everyone (102's staff_task_reach, unchanged).
--   changes     ask: any staff member, as themselves. Read: your own; the
--               owner and org admins read all. Answer: the owner and org admins
--               (status and answer only). Reply: the asker and the managers.
--   note review send: the note's author; decide: the owner or an org admin who
--               is not the author; both only while they reach the person.
--
-- MODULE KEY. 103's org_profile_guard allows a fixed list of module keys. This
-- file adds 'note_review' to that list by rewriting the stored function body
-- (pg_get_functiondef + replace), so it works whatever 107 or 108 did to the
-- rest of that function. The after-guard checks the key is accepted.
--
-- ACTIVITY CHECK. The entity list is rebuilt from the constraint as it stands
-- plus this file's two values, so the order of 107 to 112 does not matter.
--
-- Additive: new tables, functions and triggers; two existing functions are
-- replaced: org_activity_task (102; only the owner-change and give-on-create
-- branches change) and org_profile_guard (103; one more allowed module key).
-- No existing policy is changed or widened.
-- APPLY BEFORE THE APP RELEASE that ships the Inbox, comments and change
-- requests (the RLS health check lists the new tables).
--
-- ROLLBACK, in this order:
--   1. Revert the S4 app code and deploy that.
--   2. As the owner role, in one transaction:
--        DROP TABLE IF EXISTS note_review_event, note_review, org_change_reply, org_change_request,
--          staff_inbox_item, team_comment_version, team_comment CASCADE;
--        DROP TRIGGER IF EXISTS staff_task_assign_guard ON staff_task;
--        DROP TRIGGER IF EXISTS staff_task_assigned ON staff_task;
--        DROP TRIGGER IF EXISTS case_note_review_lock ON case_note;
--        DROP TRIGGER IF EXISTS staff_inbox_on_staff_removed ON org_staff;
--        (org_activity_task: re-run its body from 102; org_profile_guard: from 103;
--         the activity CHECK may keep the two extra values.)
--        DELETE FROM _migrations WHERE filename = '109_team_talk.sql';
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  -- Definer triggers write the inbox and the activity log, which the app role
  -- cannot write, and read RLS-forced membership tables.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '109 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.org_activity_write(uuid,uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '109 needs migration 102 (smr_staff_reach, org_activity_write) applied first';
  END IF;
  IF to_regclass('public.org_profile') IS NULL OR to_regprocedure('public.org_profile_guard()') IS NULL THEN
    RAISE EXCEPTION '109 needs migration 103 (org_profile) applied first';
  END IF;
  IF to_regprocedure('public.smr_org_manager(uuid)') IS NULL OR to_regprocedure('public.smr_only_gone_refs_cleared(jsonb,jsonb,text[],text[])') IS NULL THEN
    RAISE EXCEPTION '109 needs migrations 104 (smr_org_manager) and 105 (smr_only_gone_refs_cleared) applied first';
  END IF;
END $$;

-- ===================================================== activity entities ==
-- Rebuilt from what the constraint holds now, plus this file's values.
DO $$
DECLARE
  v_def text;
  v_vals text[];
  v_new text[] := ARRAY['comment', 'change_request'];
  v_all text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.org_activity'::regclass AND c.conname = 'org_activity_entity_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '109: org_activity_entity_check is missing';
  END IF;
  -- Quote-safe: a value is everything between quotes, with '' read as one quote (the S5 pattern).
  SELECT array_agg(replace(m[1], '''''', '''')) INTO v_vals FROM regexp_matches(v_def, '''((?:[^'']|'''''')*)''', 'g') AS m;
  IF NOT (COALESCE(v_vals, '{}') @> v_new) THEN
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_all FROM unnest(COALESCE(v_vals, '{}') || v_new) AS x;
    ALTER TABLE org_activity DROP CONSTRAINT org_activity_entity_check;
    EXECUTE format('ALTER TABLE org_activity ADD CONSTRAINT org_activity_entity_check CHECK (entity IN (%s))',
                   (SELECT string_agg(quote_literal(x), ', ') FROM unnest(v_all) AS x));
  END IF;
END $$;

-- ============================================================ module key ==
DO $$
DECLARE
  v text;
BEGIN
  SELECT pg_get_functiondef('public.org_profile_guard()'::regprocedure) INTO v;
  IF position('''note_review''' IN v) = 0 THEN
    IF position('''ai_assist''' IN v) = 0 THEN
      RAISE EXCEPTION '109: org_profile_guard has no module list to extend';
    END IF;
    EXECUTE replace(v, '''ai_assist''', '''ai_assist'', ''note_review''');
  END IF;
END $$;

-- Review round 2 (boss): the organization's AI switch (modules.ai_assist,
-- "t.ROY for staff") is the OWNER's call. Org admins keep every other module,
-- the words, the type and the name. Missing key = on (the default). SECURITY
-- INVOKER on purpose: an owner-credential maintenance script (BYPASSRLS, no
-- app.user_id) is allowed; every app session must be the owner
-- (access_code.partner_user_id = app.user_id). S3 enforces the same in the app.
CREATE OR REPLACE FUNCTION public.org_profile_ai_owner_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_new boolean := COALESCE((NEW.modules ->> 'ai_assist')::boolean, true);
  v_old boolean := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE((OLD.modules ->> 'ai_assist')::boolean, true) ELSE true END;
BEGIN
  IF v_new = v_old THEN RETURN NEW; END IF;
  IF v_actor IS NULL AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.rolbypassrls OR r.rolsuper)) THEN
    RETURN NEW;
  END IF;
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = v_actor) THEN
    RAISE EXCEPTION 'ai_assist_owner_only: only the owner turns t.ROY on or off for the organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_profile_ai_owner_only() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_profile_ai_owner_only ON org_profile;
CREATE TRIGGER org_profile_ai_owner_only BEFORE INSERT OR UPDATE OF modules ON org_profile
  FOR EACH ROW EXECUTE FUNCTION public.org_profile_ai_owner_only();

-- =============================================================== helpers ==

-- Is the SESSION user on this organization's staff (owner or any org_staff
-- row)? SECURITY INVOKER: reads access_code (not row-protected) and the
-- caller's own org_staff row. Unlike smr_org_staff_session (104) a platform
-- admin is NOT staff here: team talk is for the team.
CREATE OR REPLACE FUNCTION public.smr_team_session(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT p_org IS NOT NULL AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.access_code a
             WHERE a.id = p_org AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.org_staff s
                WHERE s.access_code_id = p_org AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
$$;
REVOKE ALL ON FUNCTION public.smr_team_session(uuid) FROM PUBLIC;

-- Is this user on this organization's staff? Answers only inside the caller's
-- own org scope (like smr_staff_reach), so it is never an oracle about another
-- organization; inside the scope the staff list is already readable.
CREATE OR REPLACE FUNCTION public.smr_team_member(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_org IS NOT NULL AND p_user IS NOT NULL
    AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
         OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user)),
    false)
$$;
REVOKE ALL ON FUNCTION public.smr_team_member(uuid, uuid) FROM PUBLIC;

-- May this user hand work to colleagues? org.client.assign: the owner and org
-- admins by role, or a 'grant' exception; a 'deny' exception always wins
-- (computeOrgCapabilities). Only inside the caller's own org scope.
CREATE OR REPLACE FUNCTION public.smr_task_assigner(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_org IS NOT NULL AND p_user IS NOT NULL
    AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
         OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user AND s.role = 'org_admin')
         OR (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user)
             AND EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_user
                           AND o.capability = 'org.client.assign' AND o.effect = 'grant')))
    -- A deny wins for EVERY role, as in computeOrgCapabilities (review N2).
    AND NOT EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_user
                      AND o.capability = 'org.client.assign' AND o.effect = 'deny'),
    false)
$$;
REVOKE ALL ON FUNCTION public.smr_task_assigner(uuid, uuid) FROM PUBLIC;

-- Is supervisor review of case notes switched on for this organization?
-- Only inside the caller's own org scope.
CREATE OR REPLACE FUNCTION public.smr_note_review_on(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    (SELECT p.modules ->> 'note_review' = 'true' FROM public.org_profile p
      WHERE p.access_code_id = p_org AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid),
    false)
$$;
REVOKE ALL ON FUNCTION public.smr_note_review_on(uuid) FROM PUBLIC;

-- The owner and the org admins of an organization (who answer change requests
-- and review notes). Definer-only: it answers for the org being written to.
CREATE OR REPLACE FUNCTION public.smr_org_managers(p_org uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.partner_user_id FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id IS NOT NULL
  UNION
  SELECT s.user_id FROM public.org_staff s WHERE s.access_code_id = p_org AND s.role = 'org_admin'
$$;
REVOKE ALL ON FUNCTION public.smr_org_managers(uuid) FROM PUBLIC;

-- ================================================================= inbox ==
CREATE TABLE IF NOT EXISTS staff_inbox_item (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  recipient_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('mention', 'reply', 'task_assigned', 'change_request', 'change_answered',
                                                    'note_review', 'kudos', 'handoff')),
  -- Who caused it (NULL: the system, or a deleted account).
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Who it is about. Restrictive policy: shown only while the recipient reaches them.
  participant_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ref_table           TEXT NOT NULL CHECK (ref_table IN ('team_comment', 'staff_task', 'org_change_request', 'case_note',
                                                         'staff_kudos', 'staff_handoff')),
  ref_id              UUID NOT NULL,
  -- Fixed words written by the triggers ("mentioned you in a comment about them").
  summary             TEXT NOT NULL CHECK (length(summary) BETWEEN 3 AND 200),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS staff_inbox_item_mine ON staff_inbox_item (access_code_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_inbox_item_unread ON staff_inbox_item (access_code_id, recipient_user_id) WHERE read_at IS NULL;
-- One unread item per thing per person: a second mention or answer refreshes it.
CREATE UNIQUE INDEX IF NOT EXISTS staff_inbox_item_once ON staff_inbox_item (recipient_user_id, kind, ref_id) WHERE read_at IS NULL;

ALTER TABLE staff_inbox_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_inbox_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_inbox_item_select ON staff_inbox_item;
CREATE POLICY staff_inbox_item_select ON staff_inbox_item FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND recipient_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS staff_inbox_item_update ON staff_inbox_item;
CREATE POLICY staff_inbox_item_update ON staff_inbox_item FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND recipient_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND recipient_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS staff_inbox_item_reach ON staff_inbox_item;
CREATE POLICY staff_inbox_item_reach ON staff_inbox_item AS RESTRICTIVE FOR ALL
  USING (participant_user_id IS NULL
         OR NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (participant_user_id IS NULL
         OR NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- The one writer. Not executable by the app. Skips: no recipient, the actor
-- themselves, someone not on this organization's staff, and (for an item about
-- a participant) anyone who does not reach them. Reach is asked only inside
-- the org scope the write runs in (smr_staff_reach answers only there).
CREATE OR REPLACE FUNCTION public.smr_inbox_write(
  p_org uuid, p_recipient uuid, p_kind text, p_participant uuid, p_ref_table text, p_ref_id uuid, p_summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF p_org IS NULL OR p_recipient IS NULL OR p_recipient = v_actor THEN RETURN; END IF;
  IF p_org IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid THEN RETURN; END IF;
  IF NOT public.smr_team_member(p_org, p_recipient) THEN RETURN; END IF;
  IF p_participant IS NOT NULL AND NOT public.smr_staff_reach(p_org, p_recipient, p_participant) THEN RETURN; END IF;
  INSERT INTO public.staff_inbox_item (access_code_id, recipient_user_id, kind, actor_user_id, participant_user_id, ref_table, ref_id, summary)
  VALUES (p_org, p_recipient, p_kind, (SELECT u.id FROM public.users u WHERE u.id = v_actor), p_participant, p_ref_table, p_ref_id, left(p_summary, 200))
  ON CONFLICT (recipient_user_id, kind, ref_id) WHERE read_at IS NULL
  DO UPDATE SET summary = EXCLUDED.summary, actor_user_id = EXCLUDED.actor_user_id, created_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.smr_inbox_write(uuid, uuid, text, uuid, text, uuid, text) FROM PUBLIC;

-- Leaving the staff ends that person's inbox in that organization.
CREATE OR REPLACE FUNCTION public.staff_inbox_on_staff_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.staff_inbox_item WHERE access_code_id = OLD.access_code_id AND recipient_user_id = OLD.user_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_inbox_on_staff_removed() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_inbox_on_staff_removed ON org_staff;
CREATE TRIGGER staff_inbox_on_staff_removed AFTER DELETE ON org_staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_inbox_on_staff_removed();

-- ============================================================== comments ==
CREATE TABLE IF NOT EXISTS team_comment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- NULL = a team thread about nobody in particular.
  participant_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- A reply sits under a top-level comment (one level deep).
  parent_id           UUID REFERENCES team_comment(id) ON DELETE CASCADE,
  author_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  body                TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  mentions            UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 10 AND array_position(mentions, NULL) IS NULL),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS team_comment_person ON team_comment (access_code_id, participant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_comment_team ON team_comment (access_code_id, created_at DESC) WHERE participant_user_id IS NULL;
CREATE INDEX IF NOT EXISTS team_comment_parent ON team_comment (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_comment_version (
  id                  BIGSERIAL PRIMARY KEY,
  comment_id          UUID NOT NULL REFERENCES team_comment(id) ON DELETE CASCADE,
  access_code_id      UUID NOT NULL,
  body                TEXT NOT NULL,
  mentions            UUID[] NOT NULL DEFAULT '{}',
  replaced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_by         UUID
);
CREATE INDEX IF NOT EXISTS team_comment_version_comment ON team_comment_version (comment_id, replaced_at DESC);

-- Mentions are checked one by one: each must be on this organization's staff
-- and, on a comment about a participant, reach that participant. Returns the
-- cleaned list (no repeats, not the author). Definer-only.
CREATE OR REPLACE FUNCTION public.smr_comment_mentions(p_org uuid, p_author uuid, p_participant uuid, p_mentions uuid[], p_check uuid[])
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_out uuid[];
  m uuid;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_out
    FROM unnest(COALESCE(p_mentions, '{}')) AS x WHERE x IS NOT NULL AND x IS DISTINCT FROM p_author;
  FOREACH m IN ARRAY COALESCE(p_check, v_out) LOOP
    CONTINUE WHEN NOT (m = ANY (v_out));
    IF NOT public.smr_team_member(p_org, m) THEN
      RAISE EXCEPTION 'mention_not_team: you can only mention people on your team' USING ERRCODE = 'check_violation';
    END IF;
    IF p_participant IS NOT NULL AND NOT public.smr_staff_reach(p_org, m, p_participant) THEN
      RAISE EXCEPTION 'mention_out_of_reach: a team member you mentioned cannot see this person' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_comment_mentions(uuid, uuid, uuid, uuid[], uuid[]) FROM PUBLIC;

-- BEFORE guard: who writes what, the reply shape, the mentions, and the
-- earlier wording kept on a correction. SECURITY DEFINER: it reads the
-- membership tables and writes team_comment_version (no app grant).
CREATE OR REPLACE FUNCTION public.team_comment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  p       record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR v_org IS NULL OR NEW.author_user_id IS DISTINCT FROM v_actor OR NEW.access_code_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'a comment is written by the staff member, in their own organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.smr_team_member(v_org, v_actor) THEN
      RAISE EXCEPTION 'only staff of this organization comment here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.participant_user_id IS NOT NULL AND (
         NOT EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.user_id = NEW.participant_user_id AND r.access_code_id = v_org)
         OR NOT public.smr_staff_reach(v_org, v_actor, NEW.participant_user_id)) THEN
      RAISE EXCEPTION 'that person is not in your reach here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.access_code_id, c.participant_user_id, c.parent_id INTO p FROM public.team_comment c WHERE c.id = NEW.parent_id;
      IF NOT FOUND OR p.access_code_id IS DISTINCT FROM v_org OR p.participant_user_id IS DISTINCT FROM NEW.participant_user_id
         OR p.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'a reply goes under a comment in the same conversation' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.mentions := public.smr_comment_mentions(v_org, v_actor, NEW.participant_user_id, NEW.mentions, NULL);
    NEW.created_at := now();
    NEW.edited_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. A deleted account nulls author_user_id (ON DELETE SET NULL is an
  -- UPDATE): allow exactly that and nothing with it.
  IF public.smr_only_gone_refs_cleared(to_jsonb(NEW), to_jsonb(OLD), ARRAY['author_user_id'], ARRAY['users']) THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.access_code_id <> OLD.access_code_id
     OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a comment stays with its person, its thread and its author' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL OR OLD.author_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'only the person who wrote a comment can correct it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.participant_user_id IS NOT NULL AND NOT public.smr_staff_reach(OLD.access_code_id, v_actor, OLD.participant_user_id) THEN
    RAISE EXCEPTION 'that person is not in your reach here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only mentions ADDED now are checked (a colleague mentioned earlier may have moved on).
  NEW.mentions := public.smr_comment_mentions(OLD.access_code_id, v_actor, OLD.participant_user_id, NEW.mentions,
                    ARRAY(SELECT x FROM unnest(NEW.mentions) AS x WHERE NOT (x = ANY (OLD.mentions))));
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.mentions IS DISTINCT FROM OLD.mentions THEN
    INSERT INTO public.team_comment_version (comment_id, access_code_id, body, mentions, replaced_by)
    VALUES (OLD.id, OLD.access_code_id, OLD.body, OLD.mentions, v_actor);
    NEW.edited_at := now();
  ELSE
    NEW.edited_at := OLD.edited_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.team_comment_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS team_comment_guard ON team_comment;
CREATE TRIGGER team_comment_guard BEFORE INSERT OR UPDATE ON team_comment
  FOR EACH ROW EXECUTE FUNCTION public.team_comment_guard();

-- AFTER: the activity row (fixed words, never the body) and the inbox items.
CREATE OR REPLACE FUNCTION public.team_comment_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m uuid;
  v_parent_author uuid;
  v_about text := CASE WHEN NEW.participant_user_id IS NULL THEN '' ELSE ' about them' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NULL, 'comment', NEW.id::text, 'created',
      CASE WHEN NEW.parent_id IS NULL THEN 'left a team comment' ELSE 'replied to a team comment' END || v_about
      || CASE WHEN cardinality(NEW.mentions) = 1 THEN ' and mentioned a team member'
              WHEN cardinality(NEW.mentions) > 1 THEN ' and mentioned ' || cardinality(NEW.mentions) || ' team members' ELSE '' END);
    FOREACH m IN ARRAY NEW.mentions LOOP
      PERFORM public.smr_inbox_write(NEW.access_code_id, m, 'mention', NEW.participant_user_id, 'team_comment', NEW.id,
        CASE WHEN NEW.participant_user_id IS NULL THEN 'mentioned you in a team comment' ELSE 'mentioned you in a comment about them' END);
    END LOOP;
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.author_user_id INTO v_parent_author FROM public.team_comment c WHERE c.id = NEW.parent_id;
      IF v_parent_author IS NOT NULL AND NOT (v_parent_author = ANY (NEW.mentions)) THEN
        PERFORM public.smr_inbox_write(NEW.access_code_id, v_parent_author, 'reply', NEW.participant_user_id, 'team_comment', NEW.parent_id,
          'replied to your comment' || v_about);
      END IF;
    END IF;
  ELSIF NEW.body IS DISTINCT FROM OLD.body OR NEW.mentions IS DISTINCT FROM OLD.mentions THEN
    IF NEW.body IS DISTINCT FROM OLD.body THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NULL, 'comment', NEW.id::text, 'corrected',
        'corrected a team comment' || v_about || ' (the earlier wording is kept)');
    END IF;
    FOREACH m IN ARRAY NEW.mentions LOOP
      CONTINUE WHEN m = ANY (OLD.mentions);
      PERFORM public.smr_inbox_write(NEW.access_code_id, m, 'mention', NEW.participant_user_id, 'team_comment', NEW.id,
        CASE WHEN NEW.participant_user_id IS NULL THEN 'mentioned you in a team comment' ELSE 'mentioned you in a comment about them' END);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.team_comment_after() FROM PUBLIC;
DROP TRIGGER IF EXISTS team_comment_after ON team_comment;
CREATE TRIGGER team_comment_after AFTER INSERT OR UPDATE ON team_comment
  FOR EACH ROW EXECUTE FUNCTION public.team_comment_after();

ALTER TABLE team_comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_comment FORCE ROW LEVEL SECURITY;
ALTER TABLE team_comment_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_comment_version FORCE ROW LEVEL SECURITY;

-- Staff of the organization, inside its scope. Never a participant: there is
-- no clause for one, so a participant session reads nothing.
DROP POLICY IF EXISTS team_comment_select ON team_comment;
CREATE POLICY team_comment_select ON team_comment FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_team_session(access_code_id));
DROP POLICY IF EXISTS team_comment_insert ON team_comment;
CREATE POLICY team_comment_insert ON team_comment FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND public.smr_team_session(access_code_id));
-- Only the author corrects their own comment. No DELETE policy (and no grant).
DROP POLICY IF EXISTS team_comment_update ON team_comment;
CREATE POLICY team_comment_update ON team_comment FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- The reach rule (102's shape): a comment about a person only to staff who reach them.
DROP POLICY IF EXISTS team_comment_reach ON team_comment;
CREATE POLICY team_comment_reach ON team_comment AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR participant_user_id IS NULL
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR participant_user_id IS NULL
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));
-- Earlier wordings follow their comment (read under the comment's own policies).
DROP POLICY IF EXISTS team_comment_version_select ON team_comment_version;
CREATE POLICY team_comment_version_select ON team_comment_version FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.team_comment c WHERE c.id = team_comment_version.comment_id));

-- ================================================================= tasks ==
-- Handing a task to a colleague. SECURITY INVOKER on purpose: definer paths
-- (105's retention task maker, a deleted account's ON DELETE SET NULL, owner
-- scripts) run as a BYPASSRLS role and are not this guard's business; the app
-- role is. It calls the scoped definer helpers above, granted to the app.
CREATE OR REPLACE FUNCTION public.staff_task_assign_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.rolbypassrls OR r.rolsuper)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.owner_user_id IS NOT DISTINCT FROM NEW.created_by THEN RETURN NEW; END IF;
  ELSE
    IF NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN RETURN NEW; END IF;
    IF NOT (v_actor IS NOT NULL AND (v_actor = OLD.created_by OR v_actor = OLD.owner_user_id
                                     OR public.smr_task_assigner(NEW.access_code_id, v_actor))) THEN
      RAISE EXCEPTION 'task_assign_refused: only the person who made it, its owner, or someone who assigns work can hand a task on'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.done_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'task_assign_closed: a finished or cancelled task stays where it is' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'task_assign_nobody: a task needs someone to own it' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.smr_team_member(NEW.access_code_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'task_assign_not_team: a task can only go to someone on this team' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.client_user_id IS NOT NULL AND NOT public.smr_staff_reach(NEW.access_code_id, NEW.owner_user_id, NEW.client_user_id) THEN
    RAISE EXCEPTION 'task_assign_out_of_reach: that team member cannot see this person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_task_assign_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_task_assign_guard ON staff_task;
CREATE TRIGGER staff_task_assign_guard BEFORE INSERT OR UPDATE OF owner_user_id ON staff_task
  FOR EACH ROW EXECUTE FUNCTION public.staff_task_assign_guard();

-- The new owner's inbox item.
CREATE OR REPLACE FUNCTION public.staff_task_assigned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.owner_user_id IS NULL OR NEW.source_kind IS NOT NULL THEN RETURN NULL; END IF;
  IF (TG_OP = 'INSERT' AND NEW.owner_user_id IS DISTINCT FROM NEW.created_by)
     OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id) THEN
    PERFORM public.smr_inbox_write(NEW.access_code_id, NEW.owner_user_id, 'task_assigned', NEW.client_user_id, 'staff_task', NEW.id,
      CASE WHEN NEW.client_user_id IS NULL THEN 'gave you a task' ELSE 'gave you a task about them' END
      || CASE WHEN NEW.due_on IS NOT NULL THEN ', due ' || to_char(NEW.due_on, 'YYYY-MM-DD') ELSE '' END);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_task_assigned() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_task_assigned ON staff_task;
CREATE TRIGGER staff_task_assigned AFTER INSERT OR UPDATE OF owner_user_id ON staff_task
  FOR EACH ROW EXECUTE FUNCTION public.staff_task_assigned();

-- 102's task activity, with a handoff logged as 'assigned' (the new owner as
-- the staff member it was about). Every other branch is 102's, word for word.
CREATE OR REPLACE FUNCTION public.org_activity_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_kind IS NULL AND NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM NEW.created_by THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.owner_user_id, 'task', NEW.id::text, 'assigned',
        CASE WHEN NEW.client_user_id IS NULL THEN 'added a task' ELSE 'added a task about them' END || ' for a team member'
        || CASE WHEN NEW.shared_with_participant THEN ', shared with them' ELSE '' END
        || CASE WHEN NEW.due_on IS NOT NULL THEN ', due ' || to_char(NEW.due_on, 'YYYY-MM-DD') ELSE '' END);
    ELSE
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'created',
        'added a task' || CASE WHEN NEW.shared_with_participant THEN ' shared with them' ELSE '' END
                       || CASE WHEN NEW.due_on IS NOT NULL THEN ', due ' || to_char(NEW.due_on, 'YYYY-MM-DD') ELSE '' END);
    END IF;
  ELSIF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'closed', 'cancelled a task');
  ELSIF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'closed',
      CASE WHEN NEW.done_by IS NOT NULL AND NEW.done_by = NEW.client_user_id THEN 'ticked off a task shared with them' ELSE 'marked a task done' END);
  ELSIF NEW.done_at IS NULL AND OLD.done_at IS NOT NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'reopened', 'reopened a task');
  -- An owner going to NULL is their account being deleted, not a change to the task.
  ELSIF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL
        AND ROW(NEW.title, NEW.due_on, NEW.shared_with_participant) IS NOT DISTINCT FROM ROW(OLD.title, OLD.due_on, OLD.shared_with_participant) THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.owner_user_id, 'task', NEW.id::text, 'assigned',
      CASE WHEN NEW.client_user_id IS NULL THEN 'handed a task to a team member' ELSE 'handed a task about them to a team member' END);
  ELSIF ROW(NEW.title, NEW.due_on, NEW.shared_with_participant) IS DISTINCT FROM ROW(OLD.title, OLD.due_on, OLD.shared_with_participant)
        OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL) THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.owner_user_id, 'task', NEW.id::text, 'updated', 'changed a task');
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_activity_task() FROM PUBLIC;

-- ======================================================= change requests ==

-- Change-request activity rows are about nobody, so every staff session can
-- read them (102's org_activity_reach). A request is the asker's and the
-- managers' business only, so its rows carry NO actor and NO staff member
-- (review N5): the request itself keeps who asked and who answered, readable
-- by exactly those people. app.user_id is blanked for the one write and put
-- back (transaction-local, as runScoped sets it). Definer-only.
CREATE OR REPLACE FUNCTION public.smr_activity_without_actor(p_org uuid, p_entity text, p_entity_id text, p_action text, p_summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev text := current_setting('app.user_id', true);
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM public.org_activity_write(p_org, NULL, NULL, p_entity, p_entity_id, p_action, p_summary);
  PERFORM set_config('app.user_id', COALESCE(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.smr_activity_without_actor(uuid, text, text, text, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS org_change_request (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id   UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('field', 'layout', 'view', 'structure', 'terminology', 'policy', 'other')),
  title            TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 140),
  body             TEXT CHECK (body IS NULL OR length(body) <= 2000),
  -- Where it came from, as a page path ("/dashboard/today"), never free text.
  target           TEXT CHECK (target IS NULL OR target ~ '^/dashboard(/[a-z0-9-]+){0,4}$'),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'done')),
  answer           TEXT CHECK (answer IS NULL OR length(answer) <= 2000),
  answered_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  answered_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A "no" always says why.
  CONSTRAINT org_change_request_declined_why CHECK (status <> 'declined' OR length(btrim(COALESCE(answer, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS org_change_request_queue ON org_change_request (access_code_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS org_change_request_mine ON org_change_request (access_code_id, requested_by, created_at DESC);

CREATE TABLE IF NOT EXISTS org_change_reply (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES org_change_request(id) ON DELETE CASCADE,
  access_code_id   UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  author_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_change_reply_request ON org_change_reply (request_id, created_at);

CREATE OR REPLACE FUNCTION public.smr_change_kind_words(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_kind WHEN 'field' THEN 'the fields' WHEN 'layout' THEN 'a screen layout' WHEN 'view' THEN 'a shared view'
                     WHEN 'structure' THEN 'programs, sites or teams' WHEN 'terminology' THEN 'the words we use'
                     WHEN 'policy' THEN 'what staff can change' ELSE 'something else' END
$$;
REVOKE ALL ON FUNCTION public.smr_change_kind_words(text) FROM PUBLIC;

-- BEFORE guard. Definer: reads membership and stamps who answered.
CREATE OR REPLACE FUNCTION public.org_change_request_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR v_org IS NULL OR NEW.requested_by IS DISTINCT FROM v_actor OR NEW.access_code_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'a change request is made by the staff member, in their own organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.smr_team_member(v_org, v_actor) THEN
      RAISE EXCEPTION 'only staff of this organization ask for a change here' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'open' OR NEW.answer IS NOT NULL OR NEW.answered_by IS NOT NULL OR NEW.answered_at IS NOT NULL THEN
      RAISE EXCEPTION 'a change request starts open, with no answer' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF public.smr_only_gone_refs_cleared(to_jsonb(NEW), to_jsonb(OLD), ARRAY['requested_by', 'answered_by'], ARRAY['users', 'users']) THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.access_code_id <> OLD.access_code_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.kind <> OLD.kind OR NEW.title <> OLD.title OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.target IS DISTINCT FROM OLD.target OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'what was asked stays as it was asked' USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL OR v_org IS DISTINCT FROM OLD.access_code_id OR NOT public.smr_org_manager(OLD.access_code_id) THEN
    RAISE EXCEPTION 'only the owner or an org admin answers a change request' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('accepted', 'declined', 'done'))
       OR (OLD.status = 'accepted' AND NEW.status IN ('done', 'declined'))) THEN
    RAISE EXCEPTION 'change_request_move: that answer does not follow from where the request is' USING ERRCODE = 'check_violation';
  END IF;
  -- Saying no always says why, in words written for this no (review N4).
  IF NEW.status = 'declined' AND OLD.status <> 'declined'
     AND (btrim(COALESCE(NEW.answer, '')) = btrim(COALESCE(OLD.answer, '')) OR length(btrim(COALESCE(NEW.answer, ''))) < 3) THEN
    RAISE EXCEPTION 'change_request_needs_reason: say why, in a fresh answer' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status AND NEW.answer IS NOT DISTINCT FROM OLD.answer THEN
    NEW.answered_by := OLD.answered_by; NEW.answered_at := OLD.answered_at; NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  NEW.answered_by := v_actor;
  NEW.answered_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_change_request_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_change_request_guard ON org_change_request;
CREATE TRIGGER org_change_request_guard BEFORE INSERT OR UPDATE ON org_change_request
  FOR EACH ROW EXECUTE FUNCTION public.org_change_request_guard();

-- Who said yes, no or done, and what they wrote, kept for good (review round 2):
-- one row per answer, written only by the trigger below; read by the asker
-- and the managers (exactly who reads the request).
CREATE TABLE IF NOT EXISTS org_change_request_event (
  id               BIGSERIAL PRIMARY KEY,
  request_id       UUID NOT NULL REFERENCES org_change_request(id) ON DELETE CASCADE,
  access_code_id   UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  from_status      TEXT NOT NULL,
  to_status        TEXT NOT NULL,
  answer           TEXT,
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_change_request_event_request ON org_change_request_event (request_id, at);

CREATE OR REPLACE FUNCTION public.org_change_request_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m uuid;
  v_words text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.smr_activity_without_actor(NEW.access_code_id, 'change_request', NEW.id::text, 'created',
      'asked for a change to ' || public.smr_change_kind_words(NEW.kind));
    FOR m IN SELECT * FROM public.smr_org_managers(NEW.access_code_id) LOOP
      PERFORM public.smr_inbox_write(NEW.access_code_id, m, 'change_request', NULL, 'org_change_request', NEW.id,
        'asked for a change to ' || public.smr_change_kind_words(NEW.kind));
    END LOOP;
    RETURN NULL;
  END IF;
  IF NEW.answered_at IS NOT DISTINCT FROM OLD.answered_at THEN RETURN NULL; END IF;
  INSERT INTO public.org_change_request_event (request_id, access_code_id, from_status, to_status, answer, actor_user_id)
  VALUES (NEW.id, NEW.access_code_id, OLD.status, NEW.status, NEW.answer, NEW.answered_by);
  v_words := CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN
                    CASE NEW.status WHEN 'accepted' THEN 'said yes to' WHEN 'declined' THEN 'said no to' WHEN 'done' THEN 'finished' ELSE 'answered' END
                  ELSE 'changed the answer to' END;
  PERFORM public.smr_activity_without_actor(NEW.access_code_id, 'change_request', NEW.id::text,
    CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status_changed' ELSE 'updated' END,
    v_words || ' a change request about ' || public.smr_change_kind_words(NEW.kind));
  PERFORM public.smr_inbox_write(NEW.access_code_id, NEW.requested_by, 'change_answered', NULL, 'org_change_request', NEW.id,
    v_words || ' your change request about ' || public.smr_change_kind_words(NEW.kind));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_change_request_after() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_change_request_after ON org_change_request;
CREATE TRIGGER org_change_request_after AFTER INSERT OR UPDATE ON org_change_request
  FOR EACH ROW EXECUTE FUNCTION public.org_change_request_after();

-- Replies: the asker and the managers, on a request in this organization.
CREATE OR REPLACE FUNCTION public.org_change_reply_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  r       record;
BEGIN
  IF v_actor IS NULL OR v_org IS NULL OR NEW.author_user_id IS DISTINCT FROM v_actor OR NEW.access_code_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'a reply is written by the staff member, in their own organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT q.access_code_id, q.requested_by INTO r FROM public.org_change_request q WHERE q.id = NEW.request_id;
  IF NOT FOUND OR r.access_code_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'that change request is not here' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (r.requested_by = v_actor OR public.smr_org_manager(v_org)) THEN
    RAISE EXCEPTION 'only the person who asked, the owner or an org admin replies here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_change_reply_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_change_reply_guard ON org_change_reply;
CREATE TRIGGER org_change_reply_guard BEFORE INSERT ON org_change_reply
  FOR EACH ROW EXECUTE FUNCTION public.org_change_reply_guard();

CREATE OR REPLACE FUNCTION public.org_change_reply_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m uuid;
  r record;
BEGIN
  SELECT q.requested_by, q.kind INTO r FROM public.org_change_request q WHERE q.id = NEW.request_id;
  PERFORM public.smr_activity_without_actor(NEW.access_code_id, 'change_request', NEW.request_id::text, 'updated',
    'replied on a change request about ' || public.smr_change_kind_words(r.kind));
  IF NEW.author_user_id IS NOT DISTINCT FROM r.requested_by THEN
    FOR m IN SELECT * FROM public.smr_org_managers(NEW.access_code_id) LOOP
      PERFORM public.smr_inbox_write(NEW.access_code_id, m, 'change_request', NULL, 'org_change_request', NEW.request_id,
        'replied on their change request about ' || public.smr_change_kind_words(r.kind));
    END LOOP;
  ELSE
    PERFORM public.smr_inbox_write(NEW.access_code_id, r.requested_by, 'change_answered', NULL, 'org_change_request', NEW.request_id,
      'replied to your change request about ' || public.smr_change_kind_words(r.kind));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_change_reply_after() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_change_reply_after ON org_change_reply;
CREATE TRIGGER org_change_reply_after AFTER INSERT ON org_change_reply
  FOR EACH ROW EXECUTE FUNCTION public.org_change_reply_after();

ALTER TABLE org_change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_change_request FORCE ROW LEVEL SECURITY;
ALTER TABLE org_change_reply ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_change_reply FORCE ROW LEVEL SECURITY;
ALTER TABLE org_change_request_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_change_request_event FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_change_request_select ON org_change_request;
CREATE POLICY org_change_request_select ON org_change_request FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_team_session(access_code_id)
  AND (requested_by = NULLIF(current_setting('app.user_id', true), '')::uuid OR public.smr_org_manager(access_code_id)));
DROP POLICY IF EXISTS org_change_request_insert ON org_change_request;
CREATE POLICY org_change_request_insert ON org_change_request FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND requested_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND public.smr_team_session(access_code_id));
DROP POLICY IF EXISTS org_change_request_update ON org_change_request;
CREATE POLICY org_change_request_update ON org_change_request FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
-- A reply is visible exactly when its request is (read under the request's policies).
DROP POLICY IF EXISTS org_change_reply_select ON org_change_reply;
CREATE POLICY org_change_reply_select ON org_change_reply FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.org_change_request q WHERE q.id = org_change_reply.request_id));
-- Answer history: visible exactly when its request is (the asker and the managers).
DROP POLICY IF EXISTS org_change_request_event_select ON org_change_request_event;
CREATE POLICY org_change_request_event_select ON org_change_request_event FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.org_change_request q WHERE q.id = org_change_request_event.request_id));
DROP POLICY IF EXISTS org_change_reply_insert ON org_change_reply;
CREATE POLICY org_change_reply_insert ON org_change_reply FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.org_change_request q WHERE q.id = org_change_reply.request_id));

-- =========================================================== note review ==
CREATE TABLE IF NOT EXISTS note_review (
  note_id             UUID PRIMARY KEY REFERENCES case_note(id) ON DELETE CASCADE,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'sent_back', 'approved')),
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_review_queue ON note_review (access_code_id, status, updated_at);

CREATE TABLE IF NOT EXISTS note_review_event (
  id                  BIGSERIAL PRIMARY KEY,
  note_id             UUID NOT NULL REFERENCES case_note(id) ON DELETE CASCADE,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status         TEXT,
  to_status           TEXT NOT NULL CHECK (to_status IN ('pending', 'sent_back', 'approved')),
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The reviewer's words when a note is sent back (required then).
  comment             TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT note_review_event_sent_back_says_why CHECK (to_status <> 'sent_back' OR length(btrim(COALESCE(comment, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS note_review_event_note ON note_review_event (note_id, at);

-- Send a note for review: its author, while the module is on and they reach
-- the person. Returns 'ok' or a reason word the app turns into a sentence.
CREATE OR REPLACE FUNCTION public.smr_note_review_submit(p_note uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  n       record;
  v_from  text;
  m       uuid;
BEGIN
  IF v_actor IS NULL OR v_org IS NULL THEN RETURN 'refused'; END IF;
  IF NOT public.smr_note_review_on(v_org) THEN RETURN 'module_off'; END IF;
  SELECT c.id, c.access_code_id, c.client_user_id, c.author_user_id INTO n FROM public.case_note c WHERE c.id = p_note FOR UPDATE;
  IF NOT FOUND OR n.access_code_id IS DISTINCT FROM v_org OR NOT public.smr_staff_reach(v_org, v_actor, n.client_user_id) THEN
    RETURN 'not_found';
  END IF;
  IF n.author_user_id IS DISTINCT FROM v_actor THEN RETURN 'not_author'; END IF;
  SELECT r.status INTO v_from FROM public.note_review r WHERE r.note_id = p_note FOR UPDATE;
  IF v_from = 'pending' THEN RETURN 'already_pending'; END IF;
  IF v_from = 'approved' THEN RETURN 'approved'; END IF;
  INSERT INTO public.note_review (note_id, access_code_id, participant_user_id, status, updated_by, updated_at)
  VALUES (p_note, v_org, n.client_user_id, 'pending', v_actor, now())
  ON CONFLICT (note_id) DO UPDATE SET status = 'pending', updated_by = v_actor, updated_at = now();
  INSERT INTO public.note_review_event (note_id, access_code_id, participant_user_id, from_status, to_status, actor_user_id)
  VALUES (p_note, v_org, n.client_user_id, v_from, 'pending', v_actor);
  PERFORM public.org_activity_write(v_org, n.client_user_id, NULL, 'note', p_note::text, 'status_changed',
    CASE WHEN v_from = 'sent_back' THEN 'sent a corrected note back for review' ELSE 'sent a note for review' END);
  FOR m IN SELECT * FROM public.smr_org_managers(v_org) LOOP
    PERFORM public.smr_inbox_write(v_org, m, 'note_review', n.client_user_id, 'case_note', p_note, 'asked you to review a note about them');
  END LOOP;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.smr_note_review_submit(uuid) FROM PUBLIC;

-- Decide: the owner or an org admin, never the author, while the note waits.
-- 'approve' locks it; 'send_back' needs the reviewer's words (3 to 1000).
CREATE OR REPLACE FUNCTION public.smr_note_review_decide(p_note uuid, p_decision text, p_comment text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  n       record;
  v_from  text;
  v_to    text;
  v_say   text := NULLIF(btrim(COALESCE(p_comment, '')), '');
BEGIN
  IF v_actor IS NULL OR v_org IS NULL THEN RETURN 'refused'; END IF;
  IF p_decision NOT IN ('approve', 'send_back') THEN RETURN 'refused'; END IF;
  IF NOT public.smr_org_manager(v_org) THEN RETURN 'not_reviewer'; END IF;
  SELECT c.id, c.access_code_id, c.client_user_id, c.author_user_id INTO n FROM public.case_note c WHERE c.id = p_note;
  IF NOT FOUND OR n.access_code_id IS DISTINCT FROM v_org OR NOT public.smr_staff_reach(v_org, v_actor, n.client_user_id) THEN
    RETURN 'not_found';
  END IF;
  IF n.author_user_id = v_actor THEN RETURN 'own_note'; END IF;
  SELECT r.status INTO v_from FROM public.note_review r WHERE r.note_id = p_note FOR UPDATE;
  IF v_from IS DISTINCT FROM 'pending' THEN RETURN 'not_pending'; END IF;
  IF p_decision = 'send_back' AND (v_say IS NULL OR length(v_say) < 3 OR length(v_say) > 1000) THEN RETURN 'needs_comment'; END IF;
  IF p_decision = 'approve' AND v_say IS NOT NULL AND length(v_say) > 1000 THEN RETURN 'needs_comment'; END IF;
  v_to := CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'sent_back' END;
  UPDATE public.note_review SET status = v_to, updated_by = v_actor, updated_at = now() WHERE note_id = p_note;
  INSERT INTO public.note_review_event (note_id, access_code_id, participant_user_id, from_status, to_status, actor_user_id, comment)
  VALUES (p_note, v_org, n.client_user_id, v_from, v_to, v_actor, v_say);
  PERFORM public.org_activity_write(v_org, n.client_user_id, n.author_user_id, 'note', p_note::text, 'status_changed',
    CASE v_to WHEN 'approved' THEN 'approved a note (it is now locked)' ELSE 'sent a note back with a comment' END);
  PERFORM public.smr_inbox_write(v_org, n.author_user_id, 'note_review', n.client_user_id, 'case_note', p_note,
    CASE v_to WHEN 'approved' THEN 'approved your note about them' ELSE 'sent your note about them back with a comment' END);
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.smr_note_review_decide(uuid, text, text) FROM PUBLIC;

-- The lock: a note waiting for review (while the module is on) or approved
-- cannot be changed by anyone: not its wording or kind, not when it happened,
-- not whether t.ROY drafted it, and not whether the person may see it (review
-- round 1). So a pending note can never be shown to the participant before it
-- is approved, and an approved note's visibility never changes in place: to
-- change anything about an approved note, its author writes a NEW note that
-- says what changed (and, with review on, sends that one for review). An
-- account being deleted (author to NULL) changes none of these. Definer, so
-- it sees the review row whoever writes.
-- Review round 2: the WHOLE row is compared, so no column (created_at,
-- edited_at, or one a later migration adds) can change in place. The one key
-- left out is author_user_id: a deleted account's ON DELETE SET NULL is an
-- UPDATE that must succeed (102's case_note_keep_version allows exactly that,
-- and only when the account is gone). The version trigger (051/102) touches
-- edited_at only when the body or kind changes, which this lock refuses anyway.
CREATE OR REPLACE FUNCTION public.case_note_review_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_status text;
BEGIN
  IF (to_jsonb(NEW) - 'author_user_id') = (to_jsonb(OLD) - 'author_user_id') THEN
    RETURN NEW;
  END IF;
  SELECT r.status INTO v_status FROM public.note_review r WHERE r.note_id = OLD.id;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'note_locked: an approved note is locked' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status = 'pending' AND COALESCE((SELECT p.modules ->> 'note_review' = 'true' FROM public.org_profile p WHERE p.access_code_id = OLD.access_code_id), false) THEN
    RAISE EXCEPTION 'note_pending: a note waiting for review cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.case_note_review_lock() FROM PUBLIC;
DROP TRIGGER IF EXISTS case_note_review_lock ON case_note;
CREATE TRIGGER case_note_review_lock BEFORE UPDATE ON case_note
  FOR EACH ROW EXECUTE FUNCTION public.case_note_review_lock();

ALTER TABLE note_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_review FORCE ROW LEVEL SECURITY;
ALTER TABLE note_review_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_review_event FORCE ROW LEVEL SECURITY;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['note_review', 'note_review_event'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (
      access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_team_session(access_code_id))$p$, t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_reach', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL
      USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
             OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
             OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
      WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
             OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
             OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))$p$,
      t || '_reach', t);
  END LOOP;
END $$;

-- ================================================================ grants ==
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON team_comment, team_comment_version, staff_inbox_item, org_change_request, org_change_reply,
                  org_change_request_event, note_review, note_review_event FROM smr_app;
    GRANT SELECT ON org_change_request_event TO smr_app;
    GRANT SELECT, INSERT ON team_comment TO smr_app;
    GRANT UPDATE (body, mentions) ON team_comment TO smr_app;
    GRANT SELECT ON team_comment_version TO smr_app;
    GRANT SELECT ON staff_inbox_item TO smr_app;
    GRANT UPDATE (read_at) ON staff_inbox_item TO smr_app;
    GRANT SELECT, INSERT ON org_change_request TO smr_app;
    GRANT UPDATE (status, answer) ON org_change_request TO smr_app;
    GRANT SELECT, INSERT ON org_change_reply TO smr_app;
    GRANT SELECT ON note_review, note_review_event TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_team_session(uuid), public.smr_team_member(uuid, uuid), public.smr_task_assigner(uuid, uuid),
                              public.smr_note_review_on(uuid), public.smr_note_review_submit(uuid),
                              public.smr_note_review_decide(uuid, text, text) TO smr_app;
    REVOKE ALL ON FUNCTION public.smr_inbox_write(uuid, uuid, text, uuid, text, uuid, text), public.smr_org_managers(uuid),
                           public.smr_activity_without_actor(uuid, text, text, text, text),
                           public.smr_comment_mentions(uuid, uuid, uuid, uuid[], uuid[]) FROM smr_app;
  END IF;
END $$;

-- ========================================================== after-guards ==
DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_comment', 'team_comment_version', 'staff_inbox_item', 'org_change_request', 'org_change_reply',
                           'org_change_request_event', 'note_review', 'note_review_event'] LOOP
    SELECT relrowsecurity, relforcerowsecurity INTO c FROM pg_class WHERE oid = ('public.' || t)::regclass;
    IF NOT (c.relrowsecurity AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION '109: % must have row-level security enabled and forced', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['team_comment', 'staff_inbox_item', 'note_review', 'note_review_event'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_reach'
                     AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION '109: % needs its RESTRICTIVE reach policy', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_activity_entity_check' AND conrelid = 'public.org_activity'::regclass
                   AND pg_get_constraintdef(oid) LIKE '%''comment''%' AND pg_get_constraintdef(oid) LIKE '%''change_request''%') THEN
    RAISE EXCEPTION '109: the activity log must accept comment and change_request rows';
  END IF;
  IF position('''note_review''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.org_profile_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '109: org_profile_guard must accept the note_review module';
  END IF;
  FOREACH t IN ARRAY ARRAY['team_comment_guard', 'team_comment_after'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.team_comment'::regclass AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION '109: trigger % is missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.staff_task'::regclass AND tgname = 'staff_task_assign_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.case_note'::regclass AND tgname = 'case_note_review_lock' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.org_profile'::regclass AND tgname = 'org_profile_ai_owner_only' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '109: the task handoff guard and the note review lock must exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.staff_inbox_item', 'INSERT') OR has_table_privilege('smr_app', 'public.staff_inbox_item', 'DELETE')
       OR has_column_privilege('smr_app', 'public.staff_inbox_item', 'summary', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.team_comment', 'DELETE') OR has_table_privilege('smr_app', 'public.team_comment_version', 'INSERT')
       OR has_column_privilege('smr_app', 'public.team_comment', 'author_user_id', 'UPDATE')
       OR has_column_privilege('smr_app', 'public.team_comment', 'participant_user_id', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.org_change_request', 'DELETE')
       OR has_column_privilege('smr_app', 'public.org_change_request', 'body', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.note_review', 'INSERT') OR has_table_privilege('smr_app', 'public.note_review', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.note_review_event', 'INSERT') THEN
      RAISE EXCEPTION '109: smr_app holds a write it must not';
    END IF;
    IF has_function_privilege('smr_app', 'public.smr_inbox_write(uuid, uuid, text, uuid, text, uuid, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '109: the app must not write inbox items directly';
    END IF;
    IF has_function_privilege('smr_app', 'public.smr_activity_without_actor(uuid, text, text, text, text)', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.smr_org_managers(uuid)', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.smr_comment_mentions(uuid, uuid, uuid, uuid[], uuid[])', 'EXECUTE') THEN
      RAISE EXCEPTION '109: the actor-free activity writer, the managers list and the mention check are definer-only';
    END IF;
    IF has_table_privilege('smr_app', 'public.org_change_request_event', 'INSERT') OR has_table_privilege('smr_app', 'public.org_change_request_event', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.org_change_request_event', 'DELETE') THEN
      RAISE EXCEPTION '109: the answer history is written only by its trigger';
    END IF;
  END IF;
END $$;
