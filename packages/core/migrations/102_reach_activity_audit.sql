-- 102_reach_activity_audit.sql
--
-- Reach in the database, an organization activity log, and an outcome audit
-- trail (house build lane L3b, 2026-10-26).
--
-- 1. REACH. Until now "a case manager sees only the people on their caseload"
--    lived in application SQL (orgClientView IN_REACH, staffTasks TASK_REACH,
--    the reach() helper in orgToday). The row policies on case notes, tasks,
--    outcomes, retention checks, suggestions and asks admitted EVERY row of the
--    organization to ANY staff session, so one route that forgot the app-level
--    check would show a volunteer everybody. This adds one function,
--    smr_staff_reach(org, staff, participant), and a RESTRICTIVE policy on each
--    per-participant org-record table: a staff session (app.org_id and
--    app.user_id set) sees only rows about people it reaches. The app-level
--    checks stay as the second wall.
--
--    WHO REACHES WHOM (pre-103):
--      owner (access_code.partner_user_id), org_admin, or anyone holding
--      org.client.view_all by role default or org_capability_override (deny
--      wins, exactly as computeOrgCapabilities applies it); or the staff
--      member assigned to the person (client_staff_assignment).
--    Migration 103 (org units) widens it through ONE hook:
--      smr_staff_unit_reach(org, staff, participant) returns false here.
--      103 replaces that function (CREATE OR REPLACE, same signature) with
--      "leads or is a member of a unit where the person has a referred,
--      enrolled, active or paused enrollment". Every policy below calls
--      smr_staff_reach, which calls the hook, so 103 changes no policy.
--
--    WHAT KEEPS WORKING, and why:
--      * the participant's own reads (their outcomes, shared tasks, asks and
--        suggestions) run with app.user_id and NO app.org_id, and every
--        restrictive clause starts with "no org scope: not my business";
--      * SECURITY DEFINER functions (smr_tick_my_task, smr_leave_org,
--        smr_leave_all_orgs, case_note_keep_version, the audit triggers) run
--        as an owner with BYPASSRLS (096, 097 and this file refuse to apply
--        otherwise), so no policy applies to them;
--      * owner-credential maintenance scripts bypass RLS the same way;
--      * owners and admins reach everyone, so Insights, exports and the team
--        table count the same rows as before. A staff member granted
--        org.insights.view WITHOUT view_all now gets numbers over the people
--        they reach, which is what they may see.
--    A platform admin acting on an organization they do not belong to is NOT
--    given reach: every content read already refuses that actor
--    (orgClientView "platform_admin_view", listOutcomes, listStaffTasks,
--    getOrgInsights), and support work runs as the owner credential.
--
-- 2. ACTIVITY. org_activity: who did what, to which record, about whom, when,
--    in a short plain sentence that never holds a note body, a task title, an
--    employer, a reason someone typed, or any record word. Written only by
--    SECURITY DEFINER triggers on the org-record tables; the application role
--    can read (reach-scoped) and can never insert, update or delete. Lanes
--    103 to 106 add their own triggers with public.org_activity_write().
--
-- 3. OUTCOME AUDIT.
--    retention_check: a correction is a NEW row. The old answer stays, marked
--      superseded_by the new one; the new one carries correction_reason.
--      Only the current answer per mark is unique. Made through
--      smr_correct_retention_check(), never by UPDATE from the app.
--    outcome_record: corrected IN PLACE with every earlier value kept in
--      outcome_correction, written by a trigger on any path. Chosen over a new
--      outcome row because retention checks hang off outcome_record.id and
--      Insights counts placements by row: a new row per correction would
--      orphan the checks or count one placement twice in every reader that
--      forgot a filter. A change to the facts (employer, title, start date,
--      wage, hours, how it is known, or an end already recorded) needs a
--      reason, given for the transaction in app.correction_reason; the
--      database refuses one without. Ending a placement needs no reason (it
--      is an event, not a correction) and is still kept.
--
-- APPLY ORDER (contract): apply this migration, then deploy the app release
-- that reads it. In the minutes between, the OLD app's "record a retention
-- check" fails with "That answer did not save" (its ON CONFLICT names the
-- unique constraint this file replaces). Nothing else in the old app breaks:
-- every other change here is additive or narrows what an out-of-reach staff
-- session sees, which the old app already filtered out itself.
--
-- ROLLBACK (security rollback; say so when you do it), as the owner role:
--   DROP POLICY case_note_reach ON case_note; (and _reach on case_note_version,
--   staff_task, outcome_record, retention_check, staff_suggestion,
--   sharing_request). The activity and outcome tables and triggers can stay.
SET LOCAL lock_timeout = '5s';

-- Definer functions below read row-protected tables (FORCE RLS) and write
-- org_activity, which has no INSERT policy. Their owner must bypass RLS, or
-- every reach check would see nothing and every audited write would abort.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '102 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
END $$;

-- ================================================================== reach ==

-- The org role of a user, from the tables (never from the app): 'owner',
-- 'org_admin', 'staff', or NULL. Same resolution as resolveOrgActor: owning
-- the code wins over a staff row; an unknown staff role reads as 'staff'.
CREATE OR REPLACE FUNCTION public.smr_org_role(p_org uuid, p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_org IS NULL OR p_user IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.access_code ac WHERE ac.id = p_org AND ac.partner_user_id = p_user) THEN 'owner'
    ELSE (SELECT CASE WHEN os.role = 'org_admin' THEN 'org_admin' ELSE 'staff' END
            FROM public.org_staff os WHERE os.access_code_id = p_org AND os.user_id = p_user)
  END
$$;

-- Does this staff member hold org.client.view_all? Role default (owner,
-- org_admin) or a 'grant' exception, and a 'deny' exception always wins.
-- Mirrors computeOrgCapabilities in packages/core/src/authz/capabilities.ts.
-- Like smr_staff_reach, it answers only inside the caller's own org scope, so
-- it cannot be used to learn who works for another organization.
CREATE OR REPLACE FUNCTION public.smr_staff_sees_all(p_org uuid, p_staff uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND public.smr_org_role(p_org, p_staff) IS NOT NULL
    AND (public.smr_org_role(p_org, p_staff) IN ('owner', 'org_admin')
         OR EXISTS (SELECT 1 FROM public.org_capability_override o
                     WHERE o.org_id = p_org AND o.user_id = p_staff
                       AND o.capability = 'org.client.view_all' AND o.effect = 'grant'))
    AND NOT EXISTS (SELECT 1 FROM public.org_capability_override o
                     WHERE o.org_id = p_org AND o.user_id = p_staff
                       AND o.capability = 'org.client.view_all' AND o.effect = 'deny'),
    false)
$$;

-- THE HOOK FOR 103. Org units do not exist yet, so nobody reaches anyone
-- through one. 103 replaces this body; the signature must stay, and so must
-- the rule that it answers only inside the caller's own org scope (policies
-- call it per row as the app role).
CREATE OR REPLACE FUNCTION public.smr_staff_unit_reach(p_org uuid, p_staff uuid, p_participant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT false
$$;

-- THE reach rule. Answers ONLY inside the caller's own organization scope
-- (p_org must equal app.org_id), so it is never an oracle about another
-- organization's caseloads, and inside the scope it reveals nothing the
-- session cannot already read (assignments and staff rows are org-readable).
CREATE OR REPLACE FUNCTION public.smr_staff_reach(p_org uuid, p_staff uuid, p_participant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_org IS NOT NULL AND p_staff IS NOT NULL AND p_participant IS NOT NULL
    AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND public.smr_org_role(p_org, p_staff) IS NOT NULL
    AND (public.smr_staff_sees_all(p_org, p_staff)
         OR EXISTS (SELECT 1 FROM public.client_staff_assignment a
                     WHERE a.access_code_id = p_org AND a.client_user_id = p_participant AND a.staff_user_id = p_staff)
         OR public.smr_staff_unit_reach(p_org, p_staff, p_participant)),
    false)
$$;

REVOKE ALL ON FUNCTION public.smr_org_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_staff_sees_all(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_staff_unit_reach(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smr_staff_reach(uuid, uuid, uuid) FROM PUBLIC;
-- Policies call smr_staff_sees_all and smr_staff_unit_reach AS THE QUERYING
-- ROLE (and smr_staff_reach is the scalar rule for functions in 103-106), so
-- the app role needs EXECUTE on those three, or every scoped read of a
-- protected table would fail with "permission denied for function" (also
-- granted by scripts/lib/restricted-grants.mjs for a fresh database).
-- smr_org_role is called only from inside definer functions and answers for
-- ANY org, so the app does not get it. 103's smr_staff_unit_reach MUST keep
-- answering only when p_org = app.org_id, like the other two.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON FUNCTION public.smr_org_role(uuid, uuid) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_staff_unit_reach(uuid, uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_staff_sees_all(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_staff_reach(uuid, uuid, uuid) TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------------ restrictive policies --
-- Shape of every one: no org scope (a participant, a definer path) passes;
-- a row of ANOTHER org passes this clause (the permissive policies already
-- decide those, and only ever admit the participant's own rows); a row of
-- the scoped org passes only when the acting user reaches its participant.
-- FOR ALL: USING narrows SELECT, UPDATE and DELETE; WITH CHECK narrows the
-- row an INSERT or UPDATE writes, so nobody can write a note, task, outcome,
-- check, suggestion or ask about a person they do not reach.
--
-- COST (review S2). The rule is smr_staff_reach, written out so the parts that
-- depend only on the acting user run ONCE per statement, not once per row:
-- "sees all" is an uncorrelated scalar subquery (an InitPlan), and "assigned"
-- is an uncorrelated IN list over the actor's own assignments (a hashed
-- SubPlan), counted only while the actor is still on this org's staff or owns
-- it, exactly as smr_staff_reach requires. Only the unit hook is per row (it
-- returns false until 103). The pglite test proves the written-out rule and
-- smr_staff_reach agree on every actor and person it builds.
CREATE OR REPLACE FUNCTION pg_temp.smr_reach_sql(col text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT format($r$(
    (SELECT public.smr_staff_sees_all(NULLIF(current_setting('app.org_id', true), '')::uuid, NULLIF(current_setting('app.user_id', true), '')::uuid))
    OR %1$s IN (SELECT a.client_user_id FROM public.client_staff_assignment a
                 WHERE a.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
                   AND a.staff_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                   AND (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = a.access_code_id AND s.user_id = a.staff_user_id)
                        OR EXISTS (SELECT 1 FROM public.access_code ac WHERE ac.id = a.access_code_id AND ac.partner_user_id = a.staff_user_id)))
    OR public.smr_staff_unit_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, %1$s))$r$, col)
$f$;
-- "Not my business": no org scope, or a row of another organization.
CREATE OR REPLACE FUNCTION pg_temp.smr_outside_sql() RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT $r$NULLIF(current_setting('app.org_id', true), '') IS NULL
    OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid$r$
$f$;

-- Notes, placements, suggestions and asks: the person is a column on the row.
DO $$
DECLARE
  t record;
  e text;
BEGIN
  FOR t IN SELECT * FROM (VALUES ('case_note', 'client_user_id'), ('outcome_record', 'client_user_id'),
                                 ('staff_suggestion', 'client_user_id'), ('sharing_request', 'user_id')) v(tbl, col) LOOP
    e := '(' || pg_temp.smr_outside_sql() || ' OR ' || pg_temp.smr_reach_sql(t.col) || ')';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t.tbl || '_reach', t.tbl);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL USING %s WITH CHECK %s', t.tbl || '_reach', t.tbl, e, e);
  END LOOP;
END $$;

-- Earlier wordings follow their note, and check-ins their placement: the
-- subquery reads the parent under the parent's own policies (including the
-- reach policy above), so a child is visible exactly when its parent is.
DROP POLICY IF EXISTS case_note_version_reach ON case_note_version;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY case_note_version_reach ON case_note_version AS RESTRICTIVE FOR ALL USING (%s OR EXISTS (SELECT 1 FROM public.case_note n WHERE n.id = case_note_version.note_id))',
                 pg_temp.smr_outside_sql());
END $$;
DROP POLICY IF EXISTS retention_check_reach ON retention_check;
DO $$
DECLARE
  e text := '(' || pg_temp.smr_outside_sql() || ' OR EXISTS (SELECT 1 FROM public.outcome_record o WHERE o.id = retention_check.outcome_id))';
BEGIN
  EXECUTE format('CREATE POLICY retention_check_reach ON retention_check AS RESTRICTIVE FOR ALL USING %s WITH CHECK %s', e, e);
END $$;

-- A task about a person follows the person. A task about nobody ("call Job
-- Service back") is its owner's, or visible to someone who sees everything:
-- the same rule as TASK_REACH in staffTasks.ts. Owning a task about a person
-- you no longer reach does NOT keep it visible: it goes with the person.
DROP POLICY IF EXISTS staff_task_reach ON staff_task;
DO $$
DECLARE
  e text := '(' || pg_temp.smr_outside_sql()
    || $r$ OR (client_user_id IS NULL AND (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              OR (SELECT public.smr_staff_sees_all(NULLIF(current_setting('app.org_id', true), '')::uuid, NULLIF(current_setting('app.user_id', true), '')::uuid))))$r$
    || ' OR (client_user_id IS NOT NULL AND ' || pg_temp.smr_reach_sql('client_user_id') || '))';
BEGIN
  EXECUTE format('CREATE POLICY staff_task_reach ON staff_task AS RESTRICTIVE FOR ALL USING %s WITH CHECK %s', e, e);
END $$;

-- =============================================================== activity ==

CREATE TABLE IF NOT EXISTS org_activity (
  id                  BIGSERIAL PRIMARY KEY,
  -- No foreign keys, on purpose (like org_audit). A row written while a
  -- person's account or an organization is being deleted must not abort that
  -- deletion, and history about a removed record is still history.
  access_code_id      UUID NOT NULL,
  actor_user_id       UUID,
  -- What the actor was to this organization when they acted: owner,
  -- org_admin, staff, participant, platform_admin, other. NULL actor = no
  -- user was set (a script or the system).
  actor_role          TEXT,
  participant_user_id UUID,
  -- The staff member an action was about (assignment target, team change).
  staff_user_id       UUID,
  entity              TEXT NOT NULL CHECK (entity IN ('note', 'task', 'outcome', 'retention', 'enrollment', 'unit', 'staff',
                                                      'invite', 'referral', 'custom_field', 'view', 'sharing', 'org', 'assignment')),
  entity_id           TEXT,
  action              TEXT NOT NULL CHECK (action IN ('created', 'updated', 'corrected', 'closed', 'reopened', 'deleted', 'assigned',
                                                      'unassigned', 'invited', 'revoked', 'status_changed')),
  -- A short plain phrase that starts with a verb ("added a call note").
  -- Built only from fixed words and allowlisted values in the triggers below,
  -- never from text a person typed.
  summary             TEXT NOT NULL CHECK (length(summary) BETWEEN 3 AND 200),
  db_role             TEXT,
  at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_activity_org_at ON org_activity (access_code_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS org_activity_participant ON org_activity (access_code_id, participant_user_id, at DESC) WHERE participant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_activity_actor ON org_activity (access_code_id, actor_user_id, at DESC);
-- The Audit screen pages by id, newest first (review S2).
CREATE INDEX IF NOT EXISTS org_activity_org_id ON org_activity (access_code_id, id DESC);

ALTER TABLE org_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_activity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_activity_select ON org_activity;
CREATE POLICY org_activity_select ON org_activity FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
-- Rows about a person follow the person, like the records they describe.
-- A row about nobody (the team, an invite, the org) shows only to someone who
-- is on this org's staff or owns it (review S5): a stale or forged org scope
-- sees nothing at all.
DROP POLICY IF EXISTS org_activity_reach ON org_activity;
DO $$
BEGIN
  EXECUTE format($p$CREATE POLICY org_activity_reach ON org_activity AS RESTRICTIVE FOR SELECT USING (
      (participant_user_id IS NULL AND (
         EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
                                                   AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
         OR EXISTS (SELECT 1 FROM public.access_code ac WHERE ac.id = NULLIF(current_setting('app.org_id', true), '')::uuid
                                                         AND ac.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)))
      OR (participant_user_id IS NOT NULL AND %s))$p$, pg_temp.smr_reach_sql('participant_user_id'));
END $$;
-- No INSERT, UPDATE or DELETE policy, and (below) no such grant: the app reads.

-- The one writer. Not executable by the app: only the definer triggers (which
-- run as the owner) call it, so the app cannot forge an actor, an org or a
-- time. Lanes 103-106 call it from their own SECURITY DEFINER triggers.
CREATE OR REPLACE FUNCTION public.org_activity_write(
  p_org uuid, p_participant uuid, p_staff uuid, p_entity text, p_entity_id text, p_action text, p_summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_role text;
BEGIN
  IF p_org IS NULL THEN RETURN; END IF;
  IF v_actor IS NOT NULL THEN
    v_role := public.smr_org_role(p_org, v_actor);
    IF v_role IS NULL THEN
      v_role := CASE
        WHEN EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.user_id = v_actor AND r.access_code_id = p_org)
          OR v_actor = p_participant THEN 'participant'
        WHEN EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = v_actor) THEN 'platform_admin'
        ELSE 'other' END;
    END IF;
  END IF;
  INSERT INTO public.org_activity (access_code_id, actor_user_id, actor_role, participant_user_id, staff_user_id,
                                   entity, entity_id, action, summary, db_role)
  VALUES (p_org, v_actor, v_role, p_participant, p_staff, p_entity, p_entity_id, p_action, left(p_summary, 200), session_user);
END;
$$;
REVOKE ALL ON FUNCTION public.org_activity_write(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;

-- Fixed labels. Every value passed through these comes from a CHECK-listed
-- column, so a summary can only ever hold words written here.
CREATE OR REPLACE FUNCTION public.org_activity_scope_label(p_scope text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_scope WHEN 'applications' THEN 'their job applications' WHEN 'resume' THEN 'their resumes'
                      WHEN 'documents' THEN 'their cover letters' ELSE 'something' END
$$;
CREATE OR REPLACE FUNCTION public.org_activity_retention_label(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_status WHEN 'employed' THEN 'still there' WHEN 'not_employed' THEN 'no longer there'
                       WHEN 'unknown' THEN 'could not reach them' ELSE 'answered' END
$$;
REVOKE ALL ON FUNCTION public.org_activity_scope_label(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_retention_label(text) FROM PUBLIC;

-- ---------------------------------------------------------------- triggers --
-- AFTER triggers, SECURITY DEFINER. Deletes of the content tables are not
-- logged: the app can delete none of them (no grant), so a delete is an
-- account or organization being removed, recorded elsewhere.

CREATE OR REPLACE FUNCTION public.org_activity_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := CASE NEW.kind WHEN 'call' THEN 'a call note' WHEN 'meeting' THEN 'a meeting note' WHEN 'text' THEN 'a text note'
                            WHEN 'email' THEN 'an email note' WHEN 'referral' THEN 'a referral note' WHEN 'draft' THEN 'a draft check-in'
                            ELSE 'a note' END;
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'note', NEW.id::text, 'created',
      'added ' || v_kind || CASE WHEN NEW.drafted_by_assistant THEN ' drafted with t.ROY' ELSE '' END);
  ELSIF NEW.body IS DISTINCT FROM OLD.body OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'note', NEW.id::text, 'corrected',
      CASE WHEN OLD.kind = 'draft' AND NEW.kind <> 'draft' AND NEW.body IS NOT DISTINCT FROM OLD.body
           THEN 'marked a draft check-in as sent'
           ELSE 'corrected a note (the earlier wording is kept)' END);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_note ON case_note;
CREATE TRIGGER org_activity_note AFTER INSERT OR UPDATE ON case_note
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_note();

CREATE OR REPLACE FUNCTION public.org_activity_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'created',
      'added a task' || CASE WHEN NEW.shared_with_participant THEN ' shared with them' ELSE '' END
                     || CASE WHEN NEW.due_on IS NOT NULL THEN ', due ' || to_char(NEW.due_on, 'YYYY-MM-DD') ELSE '' END);
  ELSIF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'closed', 'cancelled a task');
  ELSIF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'closed',
      CASE WHEN NEW.done_by IS NOT NULL AND NEW.done_by = NEW.client_user_id THEN 'ticked off a task shared with them' ELSE 'marked a task done' END);
  ELSIF NEW.done_at IS NULL AND OLD.done_at IS NOT NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'task', NEW.id::text, 'reopened', 'reopened a task');
  -- An owner going to NULL is their account being deleted, not a change to the task.
  ELSIF ROW(NEW.title, NEW.due_on, NEW.shared_with_participant) IS DISTINCT FROM ROW(OLD.title, OLD.due_on, OLD.shared_with_participant)
        OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL) THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.owner_user_id, 'task', NEW.id::text, 'updated', 'changed a task');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_task ON staff_task;
CREATE TRIGGER org_activity_task AFTER INSERT OR UPDATE ON staff_task
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_task();

CREATE OR REPLACE FUNCTION public.org_activity_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.staff_user_id, 'assignment', NEW.id::text, 'assigned', 'assigned them to a caseload');
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NEW.staff_user_id, 'assignment', NEW.id::text, 'assigned', 'moved them to another caseload');
    END IF;
  ELSE
    PERFORM public.org_activity_write(OLD.access_code_id, OLD.client_user_id, OLD.staff_user_id, 'assignment', OLD.id::text, 'unassigned', 'took them off a caseload');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_assignment ON client_staff_assignment;
CREATE TRIGGER org_activity_assignment AFTER INSERT OR UPDATE OR DELETE ON client_staff_assignment
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_assignment();

CREATE OR REPLACE FUNCTION public.org_activity_staff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_role := CASE WHEN NEW.role = 'org_admin' THEN 'an admin' ELSE 'staff' END;
    PERFORM public.org_activity_write(NEW.access_code_id, NULL, NEW.user_id, 'staff', NEW.id::text,
      CASE WHEN NEW.invited_at IS NOT NULL THEN 'invited' ELSE 'created' END,
      CASE WHEN NEW.invited_at IS NOT NULL THEN 'invited a team member as ' || v_role ELSE 'added a team member as ' || v_role END);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NULL, NEW.user_id, 'staff', NEW.id::text, 'updated',
        'changed a team member''s role to ' || CASE WHEN NEW.role = 'org_admin' THEN 'admin' ELSE 'staff' END);
    ELSIF NEW.title IS DISTINCT FROM OLD.title THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NULL, NEW.user_id, 'staff', NEW.id::text, 'updated', 'changed a team member''s title');
    END IF;
  ELSE
    PERFORM public.org_activity_write(OLD.access_code_id, NULL, OLD.user_id, 'staff', OLD.id::text, 'deleted', 'removed a team member');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_staff ON org_staff;
CREATE TRIGGER org_activity_staff AFTER INSERT OR UPDATE OR DELETE ON org_staff
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_staff();

-- Invites. Read through to_jsonb so lifecycle columns added by 100
-- (revoked_at) are honored when present. A DECLINED seat offer is never
-- logged: the organization is promised it never learns of a decline (096).
CREATE OR REPLACE FUNCTION public.org_activity_invite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  n jsonb;
  o jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'invite', NEW.id::text, 'invited',
      CASE WHEN NEW.offer_status = 'offered' THEN 'offered a seat to an existing account' ELSE 'invited a person to join' END);
  ELSIF TG_OP = 'UPDATE' THEN
    n := to_jsonb(NEW); o := to_jsonb(OLD);
    IF (n ->> 'revoked_at') IS NOT NULL AND (o ->> 'revoked_at') IS NULL THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'invite', NEW.id::text, 'revoked', 'revoked an invite');
    ELSIF NEW.offer_status IS DISTINCT FROM OLD.offer_status AND NEW.offer_status = 'withdrawn' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'invite', NEW.id::text, 'revoked', 'withdrew a seat offer');
    ELSIF NEW.offer_status IS DISTINCT FROM OLD.offer_status AND NEW.offer_status = 'joined' THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'invite', NEW.id::text, 'status_changed', 'accepted a seat offer and joined');
    ELSIF NEW.send_count IS DISTINCT FROM OLD.send_count AND NEW.send_count > OLD.send_count THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'invite', NEW.id::text, 'invited', 're-sent an invite');
    END IF;
  ELSE
    PERFORM public.org_activity_write(OLD.access_code_id, OLD.user_id, NULL, 'invite', OLD.id::text, 'deleted', 'removed an invite');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_invite ON org_invite;
CREATE TRIGGER org_activity_invite AFTER INSERT OR UPDATE OR DELETE ON org_invite
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_invite();

CREATE OR REPLACE FUNCTION public.org_activity_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'sharing', NEW.id::text, 'created',
      CASE WHEN NEW.basis = 'program_requirement' THEN 'acknowledged that the program requires ' || public.org_activity_scope_label(NEW.scope)
           ELSE 'started sharing ' || public.org_activity_scope_label(NEW.scope) END);
  ELSIF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'sharing', NEW.id::text, 'revoked',
      CASE WHEN NEW.revoked_reason = 'left_organization' THEN 'stopped sharing ' || public.org_activity_scope_label(NEW.scope) || ' on leaving'
           ELSE 'stopped sharing ' || public.org_activity_scope_label(NEW.scope) END);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_grant ON sharing_grant;
CREATE TRIGGER org_activity_grant AFTER INSERT OR UPDATE ON sharing_grant
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_grant();

-- Asks. Staff already see the answer on Today, so yes and no are logged.
CREATE OR REPLACE FUNCTION public.org_activity_ask() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'sharing', NEW.id::text, 'created',
      'asked them to share ' || public.org_activity_scope_label(NEW.scope));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.user_id, NULL, 'sharing', NEW.id::text, 'status_changed',
      CASE NEW.status WHEN 'approved' THEN 'said yes to sharing ' || public.org_activity_scope_label(NEW.scope)
                      WHEN 'declined' THEN 'said no to sharing ' || public.org_activity_scope_label(NEW.scope)
                      ELSE 'closed the ask to share ' || public.org_activity_scope_label(NEW.scope) END);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_ask ON sharing_request;
CREATE TRIGGER org_activity_ask AFTER INSERT OR UPDATE ON sharing_request
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_ask();

-- The organization itself: closing, reopening, renaming. closed_at (100) is
-- read through to_jsonb so this works before and after 100.
CREATE OR REPLACE FUNCTION public.org_activity_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
BEGIN
  IF ((n ->> 'closed_at') IS NOT NULL AND (o ->> 'closed_at') IS NULL)
     OR (NEW.is_active = false AND OLD.is_active = true) THEN
    PERFORM public.org_activity_write(NEW.id, NULL, NULL, 'org', NEW.id::text, 'closed', 'closed the organization');
  ELSIF ((n ->> 'closed_at') IS NULL AND (o ->> 'closed_at') IS NOT NULL)
     OR (NEW.is_active = true AND OLD.is_active = false) THEN
    PERFORM public.org_activity_write(NEW.id, NULL, NULL, 'org', NEW.id::text, 'reopened', 'reopened the organization');
  END IF;
  IF NEW.partner_name IS DISTINCT FROM OLD.partner_name THEN
    PERFORM public.org_activity_write(NEW.id, NULL, NULL, 'org', NEW.id::text, 'updated', 'renamed the organization');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_org ON access_code;
CREATE TRIGGER org_activity_org AFTER UPDATE ON access_code
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_org();

-- ========================================================== outcome audit ==

-- ---------------------------------------------------------- retention check --
ALTER TABLE retention_check ADD COLUMN IF NOT EXISTS superseded_by UUID;
ALTER TABLE retention_check ADD COLUMN IF NOT EXISTS correction_reason TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.retention_check'::regclass AND conname = 'retention_check_superseded_by_fkey') THEN
    -- Deferred: a correction marks the old answer before the new one exists,
    -- in one transaction. NO ACTION, not SET NULL: a cascade that deletes both
    -- rows passes at commit, and nothing ever rewrites a superseded pointer.
    ALTER TABLE retention_check ADD CONSTRAINT retention_check_superseded_by_fkey
      FOREIGN KEY (superseded_by) REFERENCES retention_check(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.retention_check'::regclass AND conname = 'retention_check_correction_reason_check') THEN
    ALTER TABLE retention_check ADD CONSTRAINT retention_check_correction_reason_check
      CHECK (correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 3 AND 500);
  END IF;
END $$;

-- One CURRENT answer per placement and mark; superseded answers stay beside it.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.retention_check'::regclass AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) = ARRAY['day_mark', 'outcome_id']
  LOOP
    EXECUTE format('ALTER TABLE public.retention_check DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS retention_check_current ON retention_check (outcome_id, day_mark) WHERE superseded_by IS NULL;
-- Review S3: the history read joins on these.
CREATE INDEX IF NOT EXISTS retention_check_outcome ON retention_check (outcome_id);
CREATE INDEX IF NOT EXISTS retention_check_superseded ON retention_check (superseded_by) WHERE superseded_by IS NOT NULL;

-- The app may record a check-in, never write correction history: a row that
-- says it replaced another, or carries a correction reason, is made only by
-- smr_correct_retention_check (definer, so this does not apply to it).
DROP POLICY IF EXISTS retention_check_no_forged_history ON retention_check;
CREATE POLICY retention_check_no_forged_history ON retention_check AS RESTRICTIVE FOR INSERT
  WITH CHECK (superseded_by IS NULL AND correction_reason IS NULL);


-- An answer is never edited. The one change ever made to a row is marking it
-- superseded, once, by smr_correct_retention_check. This holds for every
-- role, the owner included (a trigger is not bypassed by BYPASSRLS).
CREATE OR REPLACE FUNCTION public.retention_check_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- The one other change ever allowed (review B1): checked_by -> NULL because
  -- that team member's account was deleted (the foreign key's ON DELETE SET
  -- NULL is an UPDATE). Only when the account is really gone, so nobody can
  -- use this to strip a name off an answer, and with every other column equal.
  IF OLD.checked_by IS NOT NULL AND NEW.checked_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.checked_by)
     AND ROW(NEW.id, NEW.outcome_id, NEW.access_code_id, NEW.day_mark, NEW.status, NEW.method, NEW.note, NEW.checked_at, NEW.correction_reason, NEW.superseded_by)
         IS NOT DISTINCT FROM ROW(OLD.id, OLD.outcome_id, OLD.access_code_id, OLD.day_mark, OLD.status, OLD.method, OLD.note, OLD.checked_at, OLD.correction_reason, OLD.superseded_by) THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.outcome_id, NEW.access_code_id, NEW.day_mark, NEW.status, NEW.method, NEW.note, NEW.checked_by, NEW.checked_at, NEW.correction_reason)
     IS DISTINCT FROM ROW(OLD.id, OLD.outcome_id, OLD.access_code_id, OLD.day_mark, OLD.status, OLD.method, OLD.note, OLD.checked_by, OLD.checked_at, OLD.correction_reason) THEN
    RAISE EXCEPTION 'a retention check is never edited; a correction is a new answer' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'a retention check is marked superseded once, and never un-marked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS retention_check_guard ON retention_check;
CREATE TRIGGER retention_check_guard BEFORE UPDATE ON retention_check
  FOR EACH ROW EXECUTE FUNCTION public.retention_check_guard();

-- Correct an answer. The app holds no UPDATE on retention_check, so this is
-- the only path. It does not take the app's word for anything: the actor is
-- app.user_id, the org is app.org_id, the actor must hold org.outcome.write
-- (every role has it by default; a 'deny' exception, as the volunteer preset
-- writes, refuses) and must reach the person. Returns one word:
-- ok | refused | not_found | invalid | unchanged.
CREATE OR REPLACE FUNCTION public.smr_correct_retention_check(p_check uuid, p_status text, p_method text, p_note text, p_reason text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org   uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_old   public.retention_check%ROWTYPE;
  v_client uuid;
  v_new   uuid := gen_random_uuid();
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF v_org IS NULL OR v_actor IS NULL OR p_check IS NULL THEN RETURN 'refused'; END IF;
  IF public.smr_org_role(v_org, v_actor) IS NULL
     OR EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = v_org AND o.user_id = v_actor
                  AND o.capability = 'org.outcome.write' AND o.effect = 'deny') THEN
    RETURN 'refused';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN RETURN 'invalid'; END IF;
  IF p_status NOT IN ('employed', 'not_employed', 'unknown')
     OR p_method NOT IN ('participant_told_me', 'employer_confirmed', 'pay_stub_seen', 'could_not_reach')
     OR (p_status = 'unknown') <> (p_method = 'could_not_reach')
     OR (p_note IS NOT NULL AND length(p_note) > 1000) THEN
    RETURN 'invalid';
  END IF;

  SELECT k.* INTO v_old FROM public.retention_check k
   WHERE k.id = p_check AND k.access_code_id = v_org AND k.superseded_by IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT o.client_user_id INTO v_client FROM public.outcome_record o WHERE o.id = v_old.outcome_id AND o.access_code_id = v_org;
  IF v_client IS NULL OR NOT public.smr_staff_reach(v_org, v_actor, v_client) THEN RETURN 'not_found'; END IF;
  IF v_old.status = p_status AND v_old.method = p_method THEN RETURN 'unchanged'; END IF;

  UPDATE public.retention_check SET superseded_by = v_new WHERE id = v_old.id;
  INSERT INTO public.retention_check (id, outcome_id, access_code_id, day_mark, status, method, note, checked_by, correction_reason)
  VALUES (v_new, v_old.outcome_id, v_org, v_old.day_mark, p_status, p_method, NULLIF(btrim(COALESCE(p_note, '')), ''), v_actor, v_reason);
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.smr_correct_retention_check(uuid, text, text, text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_correct_retention_check(uuid, text, text, text, text) TO smr_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.org_activity_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_client uuid;
BEGIN
  SELECT o.client_user_id INTO v_client FROM public.outcome_record o WHERE o.id = NEW.outcome_id;
  PERFORM public.org_activity_write(NEW.access_code_id, v_client, NULL, 'retention', NEW.id::text,
    CASE WHEN NEW.correction_reason IS NULL THEN 'created' ELSE 'corrected' END,
    CASE WHEN NEW.correction_reason IS NULL THEN 'recorded the ' ELSE 'corrected the ' END
      || NEW.day_mark || '-day check-in (' || public.org_activity_retention_label(NEW.status) || ')');
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_retention ON retention_check;
-- INSERT only: the UPDATE that marks the old answer superseded is half of the
-- same correction, which the new row already records.
CREATE TRIGGER org_activity_retention AFTER INSERT ON retention_check
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_retention();

-- ------------------------------------------------------------ outcome record --
ALTER TABLE outcome_record ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE outcome_record ADD COLUMN IF NOT EXISTS updated_by UUID;

-- Every earlier value of a placement, kept. One row per change.
CREATE TABLE IF NOT EXISTS outcome_correction (
  id             BIGSERIAL PRIMARY KEY,
  outcome_id     UUID NOT NULL REFERENCES outcome_record(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL,
  client_user_id UUID NOT NULL,
  -- 'ended': an end date and reason recorded for the first time.
  -- 'corrected': anything else; a reason is required.
  kind           TEXT NOT NULL CHECK (kind IN ('ended', 'corrected')),
  -- {"field": {"from": <old>, "to": <new>}} for each changed field. Named
  -- fields only (see the trigger), so a column added later is not copied in.
  changed        JSONB NOT NULL,
  reason         TEXT CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
  corrected_by   UUID,
  corrected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'ended' OR reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS outcome_correction_outcome ON outcome_correction (outcome_id, corrected_at DESC);

ALTER TABLE outcome_correction ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_correction FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outcome_correction_select ON outcome_correction;
CREATE POLICY outcome_correction_select ON outcome_correction FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS outcome_correction_reach ON outcome_correction;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY outcome_correction_reach ON outcome_correction AS RESTRICTIVE FOR SELECT USING %s', pg_temp.smr_reach_sql('client_user_id'));
END $$;

CREATE OR REPLACE FUNCTION public.outcome_record_keep_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_changed jsonb := '{}'::jsonb;
  v_facts boolean := false;
  v_kind text;
  v_reason text := NULLIF(btrim(COALESCE(current_setting('app.correction_reason', true), '')), '');
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_gone boolean;
BEGIN
  -- updated_at / updated_by are stamped here and only here (review S1): the
  -- app can neither set them on a new row nor forge them on an old one.
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := NULL; NEW.updated_by := NULL;
    RETURN NEW;
  END IF;
  NEW.updated_at := OLD.updated_at; NEW.updated_by := OLD.updated_by;

  -- A team member's account was deleted: ON DELETE SET NULL clears verified_by
  -- (and created_by, which this trigger does not track). That is not a
  -- correction and needs no reason (review B1). Only when the account is gone.
  v_gone := OLD.verified_by IS NOT NULL AND NEW.verified_by IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.verified_by);

  IF NEW.employer IS DISTINCT FROM OLD.employer THEN v_changed := v_changed || jsonb_build_object('employer', jsonb_build_object('from', OLD.employer, 'to', NEW.employer)); v_facts := true; END IF;
  IF NEW.job_title IS DISTINCT FROM OLD.job_title THEN v_changed := v_changed || jsonb_build_object('job_title', jsonb_build_object('from', OLD.job_title, 'to', NEW.job_title)); v_facts := true; END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN v_changed := v_changed || jsonb_build_object('start_date', jsonb_build_object('from', OLD.start_date, 'to', NEW.start_date)); v_facts := true; END IF;
  IF NEW.hourly_wage IS DISTINCT FROM OLD.hourly_wage THEN v_changed := v_changed || jsonb_build_object('hourly_wage', jsonb_build_object('from', OLD.hourly_wage, 'to', NEW.hourly_wage)); v_facts := true; END IF;
  IF NEW.hours_per_week IS DISTINCT FROM OLD.hours_per_week THEN v_changed := v_changed || jsonb_build_object('hours_per_week', jsonb_build_object('from', OLD.hours_per_week, 'to', NEW.hours_per_week)); v_facts := true; END IF;
  IF NEW.source IS DISTINCT FROM OLD.source THEN v_changed := v_changed || jsonb_build_object('source', jsonb_build_object('from', OLD.source, 'to', NEW.source)); v_facts := true; END IF;
  IF NEW.verification_method IS DISTINCT FROM OLD.verification_method THEN v_changed := v_changed || jsonb_build_object('verification_method', jsonb_build_object('from', OLD.verification_method, 'to', NEW.verification_method)); v_facts := true; END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    v_changed := v_changed || jsonb_build_object('verified', jsonb_build_object('from', OLD.verified_at, 'to', NEW.verified_at)); v_facts := true;
  END IF;
  -- Who confirmed it is kept too (review S4), unless the change is only the
  -- deleted account being cleared.
  IF NEW.verified_by IS DISTINCT FROM OLD.verified_by AND NOT v_gone THEN
    v_changed := v_changed || jsonb_build_object('verified_by', jsonb_build_object('from', OLD.verified_by, 'to', NEW.verified_by)); v_facts := true;
  END IF;
  IF NEW.ended_on IS DISTINCT FROM OLD.ended_on THEN v_changed := v_changed || jsonb_build_object('ended_on', jsonb_build_object('from', OLD.ended_on, 'to', NEW.ended_on)); END IF;
  IF NEW.end_reason IS DISTINCT FROM OLD.end_reason THEN v_changed := v_changed || jsonb_build_object('end_reason', jsonb_build_object('from', OLD.end_reason, 'to', NEW.end_reason)); END IF;

  IF v_changed = '{}'::jsonb THEN RETURN NEW; END IF;

  -- Recording the end of a job for the first time is an event. Changing an
  -- end already on file, or any fact, is a correction.
  v_kind := CASE WHEN NOT v_facts AND OLD.ended_on IS NULL AND NEW.ended_on IS NOT NULL THEN 'ended' ELSE 'corrected' END;
  IF v_kind = 'corrected' AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'a correction to a placement needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.outcome_correction (outcome_id, access_code_id, client_user_id, kind, changed, reason, corrected_by)
  VALUES (OLD.id, OLD.access_code_id, OLD.client_user_id, v_kind, v_changed,
          CASE WHEN v_kind = 'corrected' THEN left(v_reason, 500) END, v_actor);
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.outcome_record_keep_history() FROM PUBLIC;
DROP TRIGGER IF EXISTS outcome_record_keep_history ON outcome_record;
-- Fires after outcome_record_guard (alphabetical), which already refused a move.
CREATE TRIGGER outcome_record_keep_history BEFORE INSERT OR UPDATE ON outcome_record
  FOR EACH ROW EXECUTE FUNCTION public.outcome_record_keep_history();

-- ----------------------------------------------- deleting a staff account --
-- Review B1. Every staff-written record points at its author with ON DELETE
-- SET NULL, and that SET NULL is an UPDATE. The guards from 051, 055, 056 and
-- 057 refused it, so deleting a staff member who had written a note, a task,
-- a suggestion, an ask or a placement failed (on main before this file too).
-- Each guard below is its LIVE body with one carve-out at the top: the author
-- column going to NULL, everything else equal, and ONLY when that account no
-- longer exists, so the app can never use it to strip a name off a record.

-- 056: "verified" no longer needs a living verifier in a CHECK (a CHECK cannot
-- tell a deleted account from a missing one). The rule moves to a trigger: a
-- confirmed placement names who confirmed it when it is written, and keeps
-- standing if that person's account is later deleted.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.outcome_record'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ~ 'verified_by IS NOT NULL' LOOP
    EXECUTE format('ALTER TABLE public.outcome_record DROP CONSTRAINT %I', c);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.outcome_record'::regclass AND conname = 'outcome_record_verified_check') THEN
    ALTER TABLE outcome_record ADD CONSTRAINT outcome_record_verified_check
      CHECK (source <> 'staff_verified' OR (verification_method IS NOT NULL AND verified_at IS NOT NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.outcome_record_verified_rule() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.source = 'staff_verified' AND NEW.verified_by IS NULL
     AND NOT (TG_OP = 'UPDATE' AND OLD.source = 'staff_verified'
              AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
              AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method
              AND (OLD.verified_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.verified_by))) THEN
    RAISE EXCEPTION 'new row for relation "outcome_record" violates check constraint "outcome_record_verified_check": a confirmed placement says who confirmed it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.outcome_record_verified_rule() FROM PUBLIC;
DROP TRIGGER IF EXISTS outcome_record_verified_rule ON outcome_record;
CREATE TRIGGER outcome_record_verified_rule BEFORE INSERT OR UPDATE ON outcome_record
  FOR EACH ROW EXECUTE FUNCTION public.outcome_record_verified_rule();

-- 056 outcome_record_guard + created_by -> NULL for a deleted account.
CREATE OR REPLACE FUNCTION public.outcome_record_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by
         AND NOT (OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.created_by))) THEN
    RAISE EXCEPTION 'an outcome cannot be moved to another person or organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 051 case_note_keep_version + author -> NULL for a deleted account.
CREATE OR REPLACE FUNCTION public.case_note_keep_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.author_user_id IS NOT NULL AND NEW.author_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.author_user_id)
     AND ROW(NEW.access_code_id, NEW.client_user_id, NEW.kind, NEW.body, NEW.occurred_at, NEW.visible_to_participant, NEW.drafted_by_assistant, NEW.created_at, NEW.edited_at)
         IS NOT DISTINCT FROM ROW(OLD.access_code_id, OLD.client_user_id, OLD.kind, OLD.body, OLD.occurred_at, OLD.visible_to_participant, OLD.drafted_by_assistant, OLD.created_at, OLD.edited_at) THEN
    RETURN NEW;
  END IF;
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

-- 055 staff_task_guard + created_by -> NULL for a deleted account.
CREATE OR REPLACE FUNCTION public.staff_task_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by
         AND NOT (OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.created_by))) THEN
    RAISE EXCEPTION 'a task cannot be moved to another person or organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 057 staff_suggestion_guard + author -> NULL for a deleted account.
CREATE OR REPLACE FUNCTION public.staff_suggestion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.author_user_id IS NOT NULL AND NEW.author_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.author_user_id)
     AND ROW(NEW.access_code_id, NEW.client_user_id, NEW.kind, NEW.job_title, NEW.company, NEW.location, NEW.apply_url, NEW.artifact_id, NEW.quote, NEW.body, NEW.status, NEW.responded_at, NEW.created_at)
         IS NOT DISTINCT FROM ROW(OLD.access_code_id, OLD.client_user_id, OLD.kind, OLD.job_title, OLD.company, OLD.location, OLD.apply_url, OLD.artifact_id, OLD.quote, OLD.body, OLD.status, OLD.responded_at, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'an answered suggestion cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF ROW(NEW.access_code_id, NEW.client_user_id, NEW.author_user_id, NEW.kind, NEW.job_title, NEW.company, NEW.location, NEW.apply_url, NEW.artifact_id, NEW.quote, NEW.body, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.access_code_id, OLD.client_user_id, OLD.author_user_id, OLD.kind, OLD.job_title, OLD.company, OLD.location, OLD.apply_url, OLD.artifact_id, OLD.quote, OLD.body, OLD.created_at) THEN
    RAISE EXCEPTION 'only the status of a suggestion can change' USING ERRCODE = 'check_violation';
  END IF;
  -- Inside an organization's scope the only move is to withdraw it.
  IF NULLIF(current_setting('app.org_id', true), '') IS NOT NULL AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'an organization can withdraw a suggestion, not answer it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.responded_at := now();
  RETURN NEW;
END;
$$;

-- 051 sharing_request_guard + requested_by -> NULL for a deleted account.
CREATE OR REPLACE FUNCTION public.sharing_request_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.requested_by IS NOT NULL AND NEW.requested_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.requested_by)
     AND ROW(NEW.access_code_id, NEW.user_id, NEW.scope, NEW.reason, NEW.status, NEW.created_at, NEW.answered_at)
         IS NOT DISTINCT FROM ROW(OLD.access_code_id, OLD.user_id, OLD.scope, OLD.reason, OLD.status, OLD.created_at, OLD.answered_at) THEN
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION public.org_activity_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_fields text[] := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'outcome', NEW.id::text, 'created',
      'recorded a placement (' || CASE NEW.source WHEN 'participant_reported' THEN 'they told us'
                                                  WHEN 'staff_reported' THEN 'known, not confirmed' ELSE 'confirmed' END || ')');
    RETURN NULL;
  END IF;
  IF NEW.employer IS DISTINCT FROM OLD.employer THEN v_fields := array_append(v_fields, 'employer'); END IF;
  IF NEW.job_title IS DISTINCT FROM OLD.job_title THEN v_fields := array_append(v_fields, 'job title'); END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN v_fields := array_append(v_fields, 'start date'); END IF;
  IF NEW.hourly_wage IS DISTINCT FROM OLD.hourly_wage THEN v_fields := array_append(v_fields, 'wage'); END IF;
  IF NEW.hours_per_week IS DISTINCT FROM OLD.hours_per_week THEN v_fields := array_append(v_fields, 'hours'); END IF;
  IF NEW.source IS DISTINCT FROM OLD.source OR NEW.verification_method IS DISTINCT FROM OLD.verification_method THEN v_fields := array_append(v_fields, 'how it is known'); END IF;
  IF cardinality(v_fields) = 0 AND OLD.ended_on IS NULL AND NEW.ended_on IS NOT NULL THEN
    PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'outcome', NEW.id::text, 'closed',
      CASE WHEN NEW.end_reason = 'entered_in_error' THEN 'marked a placement as entered by mistake'
           ELSE 'ended a placement (' || CASE NEW.end_reason WHEN 'left_for_better_job' THEN 'left for a better job' WHEN 'left_other' THEN 'left for another reason'
                                                             WHEN 'laid_off' THEN 'laid off' WHEN 'let_go' THEN 'let go' WHEN 'seasonal_ended' THEN 'seasonal work ended'
                                                             ELSE 'reason not known' END || ')' END);
  ELSE
    IF NEW.ended_on IS DISTINCT FROM OLD.ended_on OR NEW.end_reason IS DISTINCT FROM OLD.end_reason THEN v_fields := array_append(v_fields, 'end'); END IF;
    IF cardinality(v_fields) > 0 THEN
      PERFORM public.org_activity_write(NEW.access_code_id, NEW.client_user_id, NULL, 'outcome', NEW.id::text, 'corrected',
        'corrected a placement (' || array_to_string(v_fields, ', ') || ')');
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS org_activity_outcome ON outcome_record;
CREATE TRIGGER org_activity_outcome AFTER INSERT OR UPDATE ON outcome_record
  FOR EACH ROW EXECUTE FUNCTION public.org_activity_outcome();

-- Trigger functions are never called directly; revoke the default anyway.
REVOKE ALL ON FUNCTION public.org_activity_note() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_task() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_invite() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_ask() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_retention() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_activity_outcome() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retention_check_guard() FROM PUBLIC;

-- ------------------------------------------------------------------ grants --
-- Revoke first: default privileges hand every new table to the app role.
-- Same lists as scripts/lib/restricted-grants.mjs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_activity, outcome_correction FROM smr_app;
    GRANT SELECT ON org_activity, outcome_correction TO smr_app;
    REVOKE ALL ON SEQUENCE org_activity_id_seq, outcome_correction_id_seq FROM smr_app;
    -- retention_check keeps exactly SELECT, INSERT (056): corrections go
    -- through smr_correct_retention_check.
    REVOKE ALL ON retention_check FROM smr_app;
    GRANT SELECT, INSERT ON retention_check TO smr_app;
  END IF;
END $$;

DROP FUNCTION IF EXISTS pg_temp.smr_reach_sql(text);
DROP FUNCTION IF EXISTS pg_temp.smr_outside_sql();

-- ------------------------------------------------------------ after-guards --
-- Only what this file creates.
DO $$
DECLARE
  t text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_activity', 'outcome_correction'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = t
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '102 after-guard: % is not row-level protected and forced', t;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['case_note.case_note_reach', 'case_note_version.case_note_version_reach', 'staff_task.staff_task_reach',
                           'outcome_record.outcome_record_reach', 'retention_check.retention_check_reach',
                           'staff_suggestion.staff_suggestion_reach', 'sharing_request.sharing_request_reach',
                           'org_activity.org_activity_reach', 'outcome_correction.outcome_correction_reach',
                           'retention_check.retention_check_no_forged_history'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = split_part(p, '.', 1)
                    AND policyname = split_part(p, '.', 2) AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION '102 after-guard: restrictive policy % is missing', p;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.outcome_record'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ~ 'verified_by IS NOT NULL') THEN
    RAISE EXCEPTION '102 after-guard: a CHECK still requires a living verifier, so deleting a staff account would fail';
  END IF;
  IF to_regclass('public.retention_check_current') IS NULL THEN
    RAISE EXCEPTION '102 after-guard: retention_check_current index is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.org_activity', 'INSERT')
       OR has_table_privilege('smr_app', 'public.org_activity', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.org_activity', 'DELETE')
       OR has_table_privilege('smr_app', 'public.outcome_correction', 'INSERT')
       OR has_table_privilege('smr_app', 'public.retention_check', 'UPDATE') THEN
      RAISE EXCEPTION '102 after-guard: the app role can write an append-only table';
    END IF;
    IF has_function_privilege('smr_app', 'public.org_activity_write(uuid, uuid, uuid, text, text, text, text)', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.smr_org_role(uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '102 after-guard: the app role can call org_activity_write or smr_org_role';
    END IF;
    IF NOT has_function_privilege('smr_app', 'public.smr_staff_reach(uuid, uuid, uuid)', 'EXECUTE')
       OR NOT has_function_privilege('smr_app', 'public.smr_staff_sees_all(uuid, uuid)', 'EXECUTE')
       OR NOT has_function_privilege('smr_app', 'public.smr_staff_unit_reach(uuid, uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '102 after-guard: the app role cannot call the reach functions, so every scoped read would fail';
    END IF;
  END IF;
END $$;
