-- 103_org_structure.sql
-- Organization structure: what kind of organization this is, its own words,
-- its tree of units (programs, cohorts, sites, offices, caseloads...), which
-- staff work in which unit, and which participant is enrolled where
-- (house build lane L3a, 2026-10-26).
--
-- WHAT THIS ADDS
--   org_profile   one row per organization: org_type, display name, time zone,
--                 terminology (its own words for "participant", "case
--                 manager"...), modules switched on, and when setup finished.
--   org_unit      the tree. At most 4 levels. Never deleted: a unit is CLOSED
--                 (closed_at, closed_by) and can be reopened. One active name
--                 per parent.
--   unit_member   which staff work in which unit, as lead, member or viewer.
--                 Staff (or the owner) of the same organization only.
--   enrollment    a participant in a program, cohort or caseload, with a status
--                 history in the activity log. One membership per person per
--                 organization stays access_code_redemption; enrollments are
--                 many (one OPEN enrollment per person per unit).
--
-- REACH (who on staff can see which participant). 102 (lane L3b) owns
-- smr_staff_reach and calls one hook for units, smr_staff_unit_reach, which
-- returns false there. 103 replaces ONLY that hook: a staff member reaches a
-- participant who has an OPEN enrollment (referred, enrolled, active, paused)
-- in an ACTIVE unit where the staff member is a lead or a member. A LEAD also
-- reaches enrollments in the units below theirs (a site lead sees the programs
-- at that site). A VIEWER sees the unit and who works in it, never its people.
-- 103 refuses to apply without 102, and never defines smr_staff_reach.
--
-- WHO MAY WRITE (database facts; the routes check capabilities first):
--   org_profile, org_unit, unit_member: the organization's owner or an org
--     admin, inside that organization's scope. Never a platform admin acting
--     for an organization (the routes refuse that too). The routes require
--     org.settings.manage.
--   enrollment: the owner, or any staff member of the organization without a
--     deny on org.enrollment.write (a new delegable capability; the volunteer
--     preset denies it), and only for a participant the writer already
--     reaches (RESTRICTIVE policy below, FOR ALL, in 102's shape). So nobody can widen their
--     own reach by enrolling a stranger into their own unit, and adding staff
--     to a unit (which widens reach) is an owner or admin act.
--   Nobody deletes a unit, a profile or an enrollment through the app (no
--   grant). Removing a staff member from a unit is a real delete; the activity
--   log keeps that it happened.
--
-- SYSTEM CHANGES (SECURITY DEFINER triggers):
--   A participant leaving the organization (access_code_redemption deleted)
--   exits their open enrollments with reason left_organization.
--   A staff member removed from the organization (org_staff deleted) leaves
--   every unit and stops being anyone's primary staff member there.
--
-- ACTIVITY LOG. Every write to these four tables writes one org_activity row
-- through 102's org_activity_write: a short phrase built from FIXED words
-- (never a unit name, a person's name, a typed reason or the program id), with
-- the unit, enrollment, participant and staff member carried as ids. Guarded
-- by an existence check on the writer, so a missing writer never blocks a write.
--
-- Additive. Rollback (data loss for these four tables only):
--   DROP TABLE enrollment, unit_member, org_unit, org_profile CASCADE;
--   CREATE OR REPLACE the hook smr_staff_unit_reach back to SELECT false (102);
--   remove 'org.enrollment.write' from smr_delegable_capabilities() and the
--   overrides 103 added (set_by = '103_org_structure').
-- APPLY AFTER 102 (merge order) and BEFORE the app release that ships the
-- structure routes (they read these tables; without them the routes answer
-- "not switched on yet" and every screen uses the default words).
SET LOCAL lock_timeout = '5s';

-- The reach function reads enrollment and unit_member while a RESTRICTIVE
-- policy on enrollment calls it: its owner must bypass RLS or the policy would
-- recurse. The trigger functions write org_activity and system exits.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '103 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regclass('public.org_capability_override') IS NULL OR to_regclass('public.client_staff_assignment') IS NULL
     OR to_regclass('public.access_code_redemption') IS NULL OR to_regclass('public.org_staff') IS NULL THEN
    RAISE EXCEPTION '103 preflight: 023/049/051 objects are missing; stop';
  END IF;
  -- 103 fills in 102's unit hook and never defines smr_staff_reach itself.
  IF to_regprocedure('public.smr_staff_unit_reach(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.smr_staff_reach(uuid, uuid, uuid)') IS NULL
     OR position('smr_staff_unit_reach' IN pg_get_functiondef(to_regprocedure('public.smr_staff_reach(uuid, uuid, uuid)'))) = 0 THEN
    RAISE EXCEPTION '103 needs migration 102 (smr_staff_reach calling smr_staff_unit_reach) applied first';
  END IF;
  IF to_regprocedure('public.org_activity_write(uuid, uuid, uuid, text, text, text, text)') IS NULL THEN
    RAISE NOTICE '103: org_activity_write (102) is not here; structure changes will not be logged until it is';
  END IF;
END $$;

-- ------------------------------------------------------------- org_profile --
CREATE TABLE IF NOT EXISTS org_profile (
  access_code_id     UUID PRIMARY KEY REFERENCES access_code(id) ON DELETE CASCADE,
  org_type           TEXT NOT NULL DEFAULT 'other' CHECK (org_type IN (
                       'reentry_nonprofit', 'workforce_board', 'job_center', 'corrections_facility',
                       'community_supervision', 'faith_based', 'education_training', 'employer_partner',
                       'legal_aid', 'housing', 'recovery_health', 'coalition', 'other')),
  display_name       TEXT CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120),
  timezone           TEXT NOT NULL DEFAULT 'America/Chicago' CHECK (length(timezone) BETWEEN 1 AND 64),
  terminology        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terminology) = 'object'),
  modules            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(modules) = 'object'),
  setup_completed_at TIMESTAMPTZ,
  updated_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- org_unit --
CREATE TABLE IF NOT EXISTS org_unit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  parent_id      UUID REFERENCES org_unit(id),
  kind           TEXT NOT NULL CHECK (kind IN ('program', 'cohort', 'site', 'facility', 'housing_unit', 'office', 'team', 'caseload', 'other')),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  short_code     TEXT CHECK (short_code IS NULL OR short_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,15}$'),
  description    TEXT CHECK (description IS NULL OR length(description) <= 500),
  starts_on      DATE,
  ends_on        DATE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  capacity       INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ,
  closed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS org_unit_org ON org_unit (access_code_id, parent_id);
-- One ACTIVE unit of a name under the same parent (case and spaces ignored).
CREATE UNIQUE INDEX IF NOT EXISTS org_unit_active_name ON org_unit
  (access_code_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE status = 'active';

-- ------------------------------------------------------------- unit_member --
CREATE TABLE IF NOT EXISTS unit_member (
  org_unit_id    UUID NOT NULL REFERENCES org_unit(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  role_in_unit   TEXT NOT NULL DEFAULT 'member' CHECK (role_in_unit IN ('lead', 'member', 'viewer')),
  added_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_unit_id, user_id)
);
CREATE INDEX IF NOT EXISTS unit_member_user ON unit_member (access_code_id, user_id);

-- -------------------------------------------------------------- enrollment --
CREATE TABLE IF NOT EXISTS enrollment (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id         UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  org_unit_id            UUID NOT NULL REFERENCES org_unit(id),
  participant_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'enrolled'
                         CHECK (status IN ('referred', 'enrolled', 'active', 'paused', 'completed', 'exited', 'withdrawn')),
  enrolled_on            DATE,
  exited_on              DATE,
  -- Plain lists, never free text: a reason box is where a court date or a
  -- violation would get typed, and these values feed the activity log.
  exit_reason            TEXT CHECK (exit_reason IS NULL OR exit_reason IN (
                           'completed', 'found_work', 'moved_away', 'chose_to_stop', 'could_not_reach',
                           'transferred', 'program_ended', 'left_organization', 'needs_a_pause', 'other')),
  status_reason          TEXT CHECK (status_reason IS NULL OR status_reason IN (
                           'completed', 'found_work', 'moved_away', 'chose_to_stop', 'could_not_reach',
                           'transferred', 'program_ended', 'left_organization', 'needs_a_pause', 'other')),
  primary_staff_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The ORGANIZATION'S own id for this person. Never a DOC number or a case
  -- number: the screen says so where it is typed.
  program_participant_id TEXT CHECK (program_participant_id IS NULL OR program_participant_id ~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$'),
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status IN ('completed', 'exited', 'withdrawn')) = (exited_on IS NOT NULL)),
  CHECK ((status IN ('completed', 'exited', 'withdrawn')) = (exit_reason IS NOT NULL)),
  CHECK (exited_on IS NULL OR enrolled_on IS NULL OR exited_on >= enrolled_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_one_open ON enrollment (org_unit_id, participant_user_id)
  WHERE status IN ('referred', 'enrolled', 'active', 'paused');
CREATE INDEX IF NOT EXISTS enrollment_participant ON enrollment (access_code_id, participant_user_id)
  WHERE status IN ('referred', 'enrolled', 'active', 'paused');
CREATE INDEX IF NOT EXISTS enrollment_unit ON enrollment (org_unit_id, status);

-- ------------------------------------------------------ who may do what -----
-- Owner or org admin of p_org. SECURITY DEFINER so a policy can ask it; it
-- answers only for the caller's own org scope (like 102's reach), so it is
-- never an oracle about another organization's staff.
CREATE OR REPLACE FUNCTION public.smr_org_structure_manager(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_org IS NOT NULL AND p_user IS NOT NULL
    AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
         OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user AND s.role = 'org_admin'))
$$;
REVOKE ALL ON FUNCTION public.smr_org_structure_manager(uuid, uuid) FROM PUBLIC;

-- The owner, or a staff member of p_org who has not been denied
-- org.enrollment.write (every role carries it; the volunteer preset denies it).
-- Own org scope only, like the function above.
CREATE OR REPLACE FUNCTION public.smr_enrollment_writer(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_org IS NOT NULL AND p_user IS NOT NULL
    AND p_org = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = p_org AND a.partner_user_id = p_user)
    OR (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_user)
        AND NOT EXISTS (SELECT 1 FROM public.org_capability_override o
                         WHERE o.org_id = p_org AND o.user_id = p_user
                           AND o.capability = 'org.enrollment.write' AND o.effect = 'deny')))
$$;
REVOKE ALL ON FUNCTION public.smr_enrollment_writer(uuid, uuid) FROM PUBLIC;

-- org.enrollment.write becomes delegable (so the volunteer preset can deny it).
-- APPENDED to whatever list is live, never retyped: 101 (L2) may have changed
-- the list, and this must not undo that.
DO $do$
DECLARE
  v_list text[];
BEGIN
  IF to_regprocedure('public.smr_delegable_capabilities()') IS NULL THEN
    RAISE EXCEPTION '103 preflight: smr_delegable_capabilities() (055) is missing; stop';
  END IF;
  EXECUTE 'SELECT public.smr_delegable_capabilities()' INTO v_list;
  IF NOT ('org.enrollment.write' = ANY (v_list)) THEN
    v_list := v_list || 'org.enrollment.write'::text;
    EXECUTE format($f$CREATE OR REPLACE FUNCTION public.smr_delegable_capabilities() RETURNS text[]
      LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $b$ SELECT %L::text[] $b$ $f$, v_list);
  END IF;
END $do$;

-- ------------------------------------------------------------------ reach --
-- 102 (lane L3b) owns smr_staff_reach(p_org, p_staff, p_participant) and ORs
-- in ONE hook for units, smr_staff_unit_reach, which returns false there. 103
-- replaces ONLY the hook, with 102's exact properties (LANGUAGE sql, STABLE,
-- SECURITY DEFINER, search_path pinned, no EXECUTE for PUBLIC or smr_app: it
-- is called only from inside smr_staff_reach). Every 102 reach policy, and
-- the one on enrollment below, picks it up with no policy change and no grant:
--   a staff member reaches a participant who has an OPEN enrollment
--   (referred, enrolled, active, paused) in an ACTIVE unit where the staff
--   member is a lead or a member; a lead also reaches the units below theirs
--   (depth is at most 4, so three parents cover every ancestor). A viewer
--   reaches nobody through a unit. Still on staff, or nothing.
CREATE OR REPLACE FUNCTION public.smr_staff_unit_reach(p_org uuid, p_staff uuid, p_participant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_org IS NOT NULL AND p_staff IS NOT NULL AND p_participant IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_staff)
    AND EXISTS (
      SELECT 1
        FROM public.enrollment e
        JOIN public.org_unit u ON u.id = e.org_unit_id AND u.access_code_id = p_org AND u.status = 'active'
        LEFT JOIN public.org_unit p1 ON p1.id = u.parent_id
        LEFT JOIN public.org_unit p2 ON p2.id = p1.parent_id
        LEFT JOIN public.org_unit p3 ON p3.id = p2.parent_id
        JOIN public.unit_member m ON m.access_code_id = p_org AND m.user_id = p_staff
         AND ((m.org_unit_id = u.id AND m.role_in_unit IN ('lead', 'member'))
              OR (m.role_in_unit = 'lead' AND m.org_unit_id IN (p1.id, p2.id, p3.id)))
       WHERE e.access_code_id = p_org AND e.participant_user_id = p_participant
         AND e.status IN ('referred', 'enrolled', 'active', 'paused')),
    false)
$$;
REVOKE ALL ON FUNCTION public.smr_staff_unit_reach(uuid, uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON FUNCTION public.smr_staff_unit_reach(uuid, uuid, uuid) FROM smr_app;
  END IF;
END $$;

-- --------------------------------------------------------- activity writer --
-- One row in org_activity through 102's writer, org_activity_write. Guarded
-- by an existence check on the writer (then nothing is logged).
-- Summaries are built from FIXED words and allowlisted values only, never
-- from a name someone typed (a unit name, a person's name, an id): 102's rule.
-- The unit, enrollment and staff member are carried as ids for the audit
-- screen to show. SECURITY DEFINER; not callable by the app (no grant).
CREATE OR REPLACE FUNCTION public.smr_structure_activity(
  p_org uuid, p_participant uuid, p_staff uuid, p_entity text, p_entity_id uuid, p_action text, p_summary text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Inside a cascade (an organization or an account being deleted) there is
  -- nothing left to log against.
  IF NOT EXISTS (SELECT 1 FROM public.access_code WHERE id = p_org) THEN RETURN; END IF;
  IF p_participant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_participant) THEN RETURN; END IF;
  IF to_regprocedure('public.org_activity_write(uuid, uuid, uuid, text, text, text, text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.org_activity_write($1, $2, $3, $4, $5, $6, $7)'
      USING p_org, p_participant, p_staff, p_entity, p_entity_id::text, p_action, left(p_summary, 200);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_structure_activity(uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.smr_unit_kind_word(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_kind WHEN 'housing_unit' THEN 'housing unit' ELSE p_kind END
$$;
REVOKE ALL ON FUNCTION public.smr_unit_kind_word(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.smr_reason_words(p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_reason
    WHEN 'completed' THEN 'finished'
    WHEN 'found_work' THEN 'found work'
    WHEN 'moved_away' THEN 'moved away'
    WHEN 'chose_to_stop' THEN 'chose to stop'
    WHEN 'could_not_reach' THEN 'could not reach them'
    WHEN 'transferred' THEN 'moved to another program'
    WHEN 'program_ended' THEN 'the program ended'
    WHEN 'left_organization' THEN 'left the organization'
    WHEN 'needs_a_pause' THEN 'needs a pause'
    WHEN 'other' THEN 'another reason'
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.smr_reason_words(text) FROM PUBLIC;

-- ---------------------------------------------------------- profile guard --
CREATE OR REPLACE FUNCTION public.org_profile_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.access_code_id IS DISTINCT FROM OLD.access_code_id THEN
    RAISE EXCEPTION 'an organization profile cannot move to another organization' USING ERRCODE = 'check_violation';
  END IF;
  -- A real time zone, or the write fails here rather than on every page.
  PERFORM now() AT TIME ZONE NEW.timezone;
  FOR k, v IN SELECT * FROM jsonb_each(NEW.terminology) LOOP
    IF k NOT IN ('participant', 'participants', 'staff_member', 'case_manager', 'program', 'site', 'team', 'caseload', 'enrollment') THEN
      RAISE EXCEPTION 'unknown word key %', k USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(v) <> 'string' OR length(btrim(v #>> '{}')) NOT BETWEEN 1 AND 40 OR (v #>> '{}') ~ '[<>{}\[\]\\]' THEN
      RAISE EXCEPTION 'each word is 1 to 40 plain characters' USING ERRCODE = 'check_violation';
    END IF;
    -- Never a label on a person (house words rule).
    IF k IN ('participant', 'participants') AND lower(v #>> '{}') ~ '(felon|offender|inmate|convict|ex-con|criminal|prisoner|delinquent)' THEN
      RAISE EXCEPTION 'pick a word that names the person, not their record' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  FOR k, v IN SELECT * FROM jsonb_each(NEW.modules) LOOP
    IF k NOT IN ('programs', 'sites', 'teams', 'referrals', 'outcomes', 'custom_fields', 'saved_views', 'ai_assist') OR jsonb_typeof(v) <> 'boolean' THEN
      RAISE EXCEPTION 'modules are on or off switches from the known list' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_profile_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_profile_guard ON org_profile;
CREATE TRIGGER org_profile_guard BEFORE INSERT OR UPDATE ON org_profile
  FOR EACH ROW EXECUTE FUNCTION public.org_profile_guard();

CREATE OR REPLACE FUNCTION public.org_profile_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  parts text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_type IS DISTINCT FROM OLD.org_type THEN parts := parts || 'type'::text; END IF;
    IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN parts := parts || 'name'::text; END IF;
    IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN parts := parts || 'time zone'::text; END IF;
    IF NEW.terminology IS DISTINCT FROM OLD.terminology THEN parts := parts || 'words'::text; END IF;
    IF NEW.modules IS DISTINCT FROM OLD.modules THEN parts := parts || 'modules'::text; END IF;
  END IF;
  IF NEW.setup_completed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.setup_completed_at IS NULL) THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'org', NEW.access_code_id, 'updated',
      'finished setup as ' || replace(NEW.org_type, '_', ' '));
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'org', NEW.access_code_id, 'created',
      'set the organization''s type, words and modules');
  ELSIF array_length(parts, 1) > 0 THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'org', NEW.access_code_id, 'updated',
      'changed the organization''s ' || array_to_string(parts, ', '));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_profile_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_profile_activity ON org_profile;
CREATE TRIGGER org_profile_activity AFTER INSERT OR UPDATE ON org_profile
  FOR EACH ROW EXECUTE FUNCTION public.org_profile_activity();

-- ------------------------------------------------------------- unit guard --
-- Depth at most 4, no cycles, parent in the same organization and open,
-- closing only an empty unit (no open children, no open enrollments), kind
-- fixed once anyone has been enrolled. SECURITY DEFINER so the depth and
-- emptiness checks see every row, not only what the caller's policy shows.
CREATE OR REPLACE FUNCTION public.org_unit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_parent public.org_unit%ROWTYPE;
  v_depth int := 1;
  v_cursor uuid;
  v_height int;
  v_guard int := 0;
BEGIN
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'a new unit starts open' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := v_actor;
    NEW.created_at := now();
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a unit cannot move to another organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (SELECT 1 FROM public.enrollment e WHERE e.org_unit_id = OLD.id) THEN
      RAISE EXCEPTION 'people have been enrolled here, so its kind stays' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'closed' AND OLD.status = 'active' THEN
      IF EXISTS (SELECT 1 FROM public.org_unit c WHERE c.parent_id = OLD.id AND c.status = 'active') THEN
        RAISE EXCEPTION 'close the units inside it first' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.enrollment e WHERE e.org_unit_id = OLD.id AND e.status IN ('referred', 'enrolled', 'active', 'paused')) THEN
        RAISE EXCEPTION 'people are still enrolled here; exit or move them first' USING ERRCODE = 'check_violation';
      END IF;
      NEW.closed_at := now();
      NEW.closed_by := v_actor;
    ELSIF NEW.status = 'active' AND OLD.status = 'closed' THEN
      NEW.closed_at := NULL;
      NEW.closed_by := NULL;
    ELSE
      NEW.closed_at := OLD.closed_at;
      NEW.closed_by := OLD.closed_by;
    END IF;
  END IF;

  IF NEW.parent_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR (NEW.status = 'active' AND OLD.status = 'closed')) THEN
    SELECT * INTO v_parent FROM public.org_unit WHERE id = NEW.parent_id;
    IF NOT FOUND OR v_parent.access_code_id <> NEW.access_code_id THEN
      RAISE EXCEPTION 'the unit above must belong to the same organization' USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent.status <> 'active' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'the unit above is closed' USING ERRCODE = 'check_violation';
    END IF;
    -- Depth of the new parent, and no cycle (walk up; a cycle meets NEW.id).
    v_cursor := NEW.parent_id;
    v_depth := 1;
    WHILE v_cursor IS NOT NULL LOOP
      IF TG_OP = 'UPDATE' AND v_cursor = NEW.id THEN
        RAISE EXCEPTION 'a unit cannot sit inside itself' USING ERRCODE = 'check_violation';
      END IF;
      v_depth := v_depth + 1;
      v_guard := v_guard + 1;
      IF v_guard > 10 THEN RAISE EXCEPTION 'the unit tree is too deep' USING ERRCODE = 'check_violation'; END IF;
      SELECT parent_id INTO v_cursor FROM public.org_unit WHERE id = v_cursor;
    END LOOP;
    -- v_depth is now this unit's level (top = 1). Add the height of what sits under it.
    IF TG_OP = 'UPDATE' THEN
      WITH RECURSIVE sub(id, h) AS (
        SELECT c.id, 1 FROM public.org_unit c WHERE c.parent_id = NEW.id
        UNION ALL
        SELECT c.id, sub.h + 1 FROM public.org_unit c JOIN sub ON c.parent_id = sub.id WHERE sub.h < 10)
      SELECT COALESCE(max(h), 0) INTO v_height FROM sub;
    ELSE
      v_height := 0;
    END IF;
    IF v_depth + v_height > 4 THEN
      RAISE EXCEPTION 'units go at most 4 levels deep' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.org_unit_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_unit_guard ON org_unit;
CREATE TRIGGER org_unit_guard BEFORE INSERT OR UPDATE ON org_unit
  FOR EACH ROW EXECUTE FUNCTION public.org_unit_guard();

CREATE OR REPLACE FUNCTION public.org_unit_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_kind text := public.smr_unit_kind_word(NEW.kind);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'created', 'added a ' || v_kind);
  ELSIF NEW.status = 'closed' AND OLD.status = 'active' THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'closed', 'closed a ' || v_kind);
  ELSIF NEW.status = 'active' AND OLD.status = 'closed' THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'reopened', 'reopened a ' || v_kind);
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'updated', 'renamed a ' || v_kind);
  ELSIF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'updated', 'moved a ' || v_kind);
  ELSIF row(NEW.kind, NEW.short_code, NEW.description, NEW.starts_on, NEW.ends_on, NEW.capacity)
        IS DISTINCT FROM row(OLD.kind, OLD.short_code, OLD.description, OLD.starts_on, OLD.ends_on, OLD.capacity) THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NULL, NULL, 'unit', NEW.id, 'updated', 'changed the details of a ' || v_kind);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_unit_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS org_unit_activity ON org_unit;
CREATE TRIGGER org_unit_activity AFTER INSERT OR UPDATE ON org_unit
  FOR EACH ROW EXECUTE FUNCTION public.org_unit_activity();

-- ------------------------------------------------------ unit_member guard --
CREATE OR REPLACE FUNCTION public.unit_member_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_unit public.org_unit%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id THEN
      RAISE EXCEPTION 'a unit membership cannot move; remove it and add another' USING ERRCODE = 'check_violation';
    END IF;
    NEW.added_by := OLD.added_by;
    NEW.added_at := OLD.added_at;
    RETURN NEW;
  END IF;
  SELECT * INTO v_unit FROM public.org_unit WHERE id = NEW.org_unit_id;
  IF NOT FOUND OR v_unit.access_code_id <> NEW.access_code_id THEN
    RAISE EXCEPTION 'that unit is not in this organization' USING ERRCODE = 'check_violation';
  END IF;
  IF v_unit.status <> 'active' THEN
    RAISE EXCEPTION 'that unit is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = NEW.access_code_id AND s.user_id = NEW.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'only staff of this organization can be added to a unit' USING ERRCODE = 'check_violation';
  END IF;
  NEW.added_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  NEW.added_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.unit_member_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS unit_member_guard ON unit_member;
CREATE TRIGGER unit_member_guard BEFORE INSERT OR UPDATE ON unit_member
  FOR EACH ROW EXECUTE FUNCTION public.unit_member_guard();

CREATE OR REPLACE FUNCTION public.unit_member_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
  v_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT public.smr_unit_kind_word(kind) INTO v_kind FROM public.org_unit WHERE id = r.org_unit_id;
  IF v_kind IS NULL THEN RETURN NULL; END IF; -- the unit itself is going (organization deleted)
  IF TG_OP = 'INSERT' THEN
    PERFORM public.smr_structure_activity(r.access_code_id, NULL, r.user_id, 'unit', r.org_unit_id, 'assigned',
      format('added a staff member to a %s as %s', v_kind, NEW.role_in_unit));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.smr_structure_activity(r.access_code_id, NULL, r.user_id, 'unit', r.org_unit_id, 'unassigned',
      format('removed a staff member from a %s', v_kind));
  ELSIF NEW.role_in_unit IS DISTINCT FROM OLD.role_in_unit THEN
    PERFORM public.smr_structure_activity(r.access_code_id, NULL, r.user_id, 'unit', r.org_unit_id, 'updated',
      format('made a staff member %s of a %s', NEW.role_in_unit, v_kind));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.unit_member_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS unit_member_activity ON unit_member;
CREATE TRIGGER unit_member_activity AFTER INSERT OR UPDATE OR DELETE ON unit_member
  FOR EACH ROW EXECUTE FUNCTION public.unit_member_activity();

-- ------------------------------------------------------- enrollment guard --
-- Allowed moves. A finished enrollment can be reopened (a correction); that
-- is logged as reopened. Same status is a details edit.
CREATE OR REPLACE FUNCTION public.smr_enrollment_move_ok(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT p_from = p_to OR (p_from, p_to) IN (
    ('referred', 'enrolled'), ('referred', 'active'), ('referred', 'withdrawn'), ('referred', 'exited'),
    ('enrolled', 'active'), ('enrolled', 'paused'), ('enrolled', 'completed'), ('enrolled', 'exited'), ('enrolled', 'withdrawn'),
    ('active', 'paused'), ('active', 'completed'), ('active', 'exited'), ('active', 'withdrawn'),
    ('paused', 'active'), ('paused', 'completed'), ('paused', 'exited'), ('paused', 'withdrawn'),
    ('completed', 'enrolled'), ('completed', 'active'),
    ('exited', 'enrolled'), ('exited', 'active'),
    ('withdrawn', 'enrolled'), ('withdrawn', 'active'))
$$;
REVOKE ALL ON FUNCTION public.smr_enrollment_move_ok(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enrollment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_unit public.org_unit%ROWTYPE;
  v_terminal boolean := NEW.status IN ('completed', 'exited', 'withdrawn');
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_unit FROM public.org_unit WHERE id = NEW.org_unit_id;
    IF NOT FOUND OR v_unit.access_code_id <> NEW.access_code_id THEN
      RAISE EXCEPTION 'that program is not in this organization' USING ERRCODE = 'check_violation';
    END IF;
    IF v_unit.status <> 'active' THEN
      RAISE EXCEPTION 'that program is closed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_unit.kind NOT IN ('program', 'cohort', 'caseload') THEN
      RAISE EXCEPTION 'people are enrolled in a program, cohort or caseload' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('referred', 'enrolled', 'active') THEN
      RAISE EXCEPTION 'an enrollment starts as referred, enrolled or active' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.access_code_redemption r WHERE r.access_code_id = NEW.access_code_id AND r.user_id = NEW.participant_user_id) THEN
      RAISE EXCEPTION 'that person has not joined this organization' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := v_actor;
    NEW.created_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
       OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'an enrollment cannot move to another person, program or organization' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.smr_enrollment_move_ok(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'an enrollment cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.status_reason := OLD.status_reason;
    END IF;
  END IF;

  IF NEW.primary_staff_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.primary_staff_id IS DISTINCT FROM OLD.primary_staff_id)
     AND NOT EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = NEW.access_code_id AND s.user_id = NEW.primary_staff_id)
     AND NOT EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = NEW.primary_staff_id) THEN
    RAISE EXCEPTION 'the primary staff member must be on this organization''s staff' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('enrolled', 'active', 'paused') AND NEW.enrolled_on IS NULL THEN
    NEW.enrolled_on := current_date;
  END IF;
  IF v_terminal THEN
    NEW.exited_on := COALESCE(CASE WHEN TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN NEW.exited_on END, current_date);
    IF NEW.enrolled_on IS NOT NULL AND NEW.exited_on < NEW.enrolled_on THEN NEW.exited_on := NEW.enrolled_on; END IF;
    NEW.exit_reason := COALESCE(NEW.status_reason, NEW.exit_reason,
                                CASE NEW.status WHEN 'completed' THEN 'completed' WHEN 'withdrawn' THEN 'chose_to_stop' ELSE 'other' END);
    IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN NEW.exit_reason := OLD.exit_reason; END IF;
  ELSE
    NEW.exited_on := NULL;
    NEW.exit_reason := NULL;
  END IF;
  NEW.updated_by := v_actor;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enrollment_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS enrollment_guard ON enrollment;
CREATE TRIGGER enrollment_guard BEFORE INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_guard();

CREATE OR REPLACE FUNCTION public.enrollment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_kind text;
  v_why text;
BEGIN
  SELECT public.smr_unit_kind_word(kind) INTO v_kind FROM public.org_unit WHERE id = NEW.org_unit_id;
  v_kind := COALESCE(v_kind, 'program');
  IF TG_OP = 'INSERT' THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NEW.participant_user_id, NULL, 'enrollment', NEW.id, 'created',
      CASE NEW.status WHEN 'referred' THEN format('referred a person to a %s', v_kind)
                      ELSE format('enrolled a person in a %s (%s)', v_kind, NEW.status) END);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_why := public.smr_reason_words(COALESCE(NEW.status_reason, CASE WHEN NEW.status IN ('completed', 'exited', 'withdrawn') THEN NEW.exit_reason END));
    PERFORM public.smr_structure_activity(NEW.access_code_id, NEW.participant_user_id, NULL, 'enrollment', NEW.id,
      CASE WHEN OLD.status IN ('completed', 'exited', 'withdrawn') THEN 'reopened' ELSE 'status_changed' END,
      format('moved an enrollment in a %s from %s to %s', v_kind, OLD.status, NEW.status)
        || CASE WHEN v_why IS NOT NULL THEN ' (' || v_why || ')' ELSE '' END);
  ELSIF NEW.primary_staff_id IS DISTINCT FROM OLD.primary_staff_id THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NEW.participant_user_id, NEW.primary_staff_id, 'enrollment', NEW.id,
      CASE WHEN NEW.primary_staff_id IS NULL THEN 'unassigned' ELSE 'assigned' END,
      CASE WHEN NEW.primary_staff_id IS NULL THEN 'cleared the primary staff member on an enrollment'
           ELSE 'set the primary staff member on an enrollment' END);
  ELSIF row(NEW.program_participant_id, NEW.enrolled_on, NEW.exited_on) IS DISTINCT FROM row(OLD.program_participant_id, OLD.enrolled_on, OLD.exited_on) THEN
    PERFORM public.smr_structure_activity(NEW.access_code_id, NEW.participant_user_id, NULL, 'enrollment', NEW.id, 'updated',
      'updated the details of an enrollment');
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enrollment_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS enrollment_activity ON enrollment;
CREATE TRIGGER enrollment_activity AFTER INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_activity();

-- ------------------------------------------------------- system changes ---
-- A participant leaves an organization: their open enrollments there end.
CREATE OR REPLACE FUNCTION public.enrollment_on_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.enrollment
     SET status = 'exited', status_reason = 'left_organization'
   WHERE access_code_id = OLD.access_code_id AND participant_user_id = OLD.user_id
     AND status IN ('referred', 'enrolled', 'active', 'paused');
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.enrollment_on_leave() FROM PUBLIC;
DROP TRIGGER IF EXISTS enrollment_on_leave ON access_code_redemption;
CREATE TRIGGER enrollment_on_leave AFTER DELETE ON access_code_redemption
  FOR EACH ROW EXECUTE FUNCTION public.enrollment_on_leave();

-- A staff member leaves an organization: out of every unit there, and no
-- longer anyone's primary staff member there.
CREATE OR REPLACE FUNCTION public.structure_on_staff_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.unit_member WHERE access_code_id = OLD.access_code_id AND user_id = OLD.user_id;
  UPDATE public.enrollment SET primary_staff_id = NULL
   WHERE access_code_id = OLD.access_code_id AND primary_staff_id = OLD.user_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.structure_on_staff_removed() FROM PUBLIC;
DROP TRIGGER IF EXISTS structure_on_staff_removed ON org_staff;
CREATE TRIGGER structure_on_staff_removed AFTER DELETE ON org_staff
  FOR EACH ROW EXECUTE FUNCTION public.structure_on_staff_removed();

-- --------------------------------------------------------------- policies --
ALTER TABLE org_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit FORCE ROW LEVEL SECURITY;
ALTER TABLE unit_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_member FORCE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment FORCE ROW LEVEL SECURITY;

-- The words are read by anyone who belongs (staff and members), so screens
-- on either side can say "your case manager" the organization's way.
DROP POLICY IF EXISTS org_profile_select ON org_profile;
CREATE POLICY org_profile_select ON org_profile FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR EXISTS (SELECT 1 FROM access_code_redemption r
              WHERE r.access_code_id = org_profile.access_code_id
                AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM org_staff s
              WHERE s.access_code_id = org_profile.access_code_id
                AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM access_code a
              WHERE a.id = org_profile.access_code_id
                AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR EXISTS (SELECT 1 FROM platform_admin pa
              WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS org_profile_insert ON org_profile;
CREATE POLICY org_profile_insert ON org_profile FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS org_profile_update ON org_profile;
CREATE POLICY org_profile_update ON org_profile FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS org_unit_select ON org_unit;
CREATE POLICY org_unit_select ON org_unit FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS org_unit_insert ON org_unit;
CREATE POLICY org_unit_insert ON org_unit FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS org_unit_update ON org_unit;
CREATE POLICY org_unit_update ON org_unit FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS unit_member_select ON unit_member;
CREATE POLICY unit_member_select ON unit_member FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS unit_member_insert ON unit_member;
CREATE POLICY unit_member_insert ON unit_member FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS unit_member_update ON unit_member;
CREATE POLICY unit_member_update ON unit_member FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS unit_member_delete ON unit_member;
CREATE POLICY unit_member_delete ON unit_member FOR DELETE USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_org_structure_manager(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));

-- Enrollment: org scope, then REACH on every command (RESTRICTIVE, FOR ALL).
DROP POLICY IF EXISTS enrollment_select ON enrollment;
CREATE POLICY enrollment_select ON enrollment FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS enrollment_insert ON enrollment;
CREATE POLICY enrollment_insert ON enrollment FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND public.smr_enrollment_writer(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS enrollment_update ON enrollment;
CREATE POLICY enrollment_update ON enrollment FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND public.smr_enrollment_writer(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS enrollment_reach ON enrollment;
-- 102's shape: no org scope (a definer path) passes; a row of another org
-- passes this clause (the permissive policies already refuse it); a row of
-- the scoped org passes only when the acting user reaches its participant.
-- FOR ALL, so nobody writes an enrollment for someone they do not reach.
CREATE POLICY enrollment_reach ON enrollment AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- ----------------------------------------------------------------- grants --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_profile FROM smr_app;
    REVOKE ALL ON org_unit FROM smr_app;
    REVOKE ALL ON unit_member FROM smr_app;
    REVOKE ALL ON enrollment FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON org_profile TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON org_unit TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON unit_member TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON enrollment TO smr_app;
    -- 103's policies call these as the app role (smr_staff_reach is 102's grant).
    GRANT EXECUTE ON FUNCTION public.smr_org_structure_manager(uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_enrollment_writer(uuid, uuid) TO smr_app;
  END IF;
END $$;

-- ------------------------------------------------- volunteers stay narrow --
-- The volunteer preset now also denies org.enrollment.write. Staff who were
-- given the preset before this (a deny on BOTH participant invites and
-- placements, which only the preset writes for a staff role) get the new deny
-- too, so they keep matching "Volunteer" and cannot enroll people. Idempotent;
-- one org_audit row per person, like smr_set_capability_override writes.
WITH vols AS (
  SELECT s.access_code_id AS org_id, s.user_id
    FROM org_staff s
   WHERE s.role = 'staff'
     AND EXISTS (SELECT 1 FROM org_capability_override o WHERE o.org_id = s.access_code_id AND o.user_id = s.user_id
                    AND o.capability = 'org.participant.invite' AND o.effect = 'deny')
     AND EXISTS (SELECT 1 FROM org_capability_override o WHERE o.org_id = s.access_code_id AND o.user_id = s.user_id
                    AND o.capability = 'org.outcome.write' AND o.effect = 'deny')
     AND NOT EXISTS (SELECT 1 FROM org_capability_override o WHERE o.org_id = s.access_code_id AND o.user_id = s.user_id
                    AND o.capability = 'org.enrollment.write')
), added AS (
  INSERT INTO org_capability_override (org_id, user_id, capability, effect, set_by)
  SELECT org_id, user_id, 'org.enrollment.write', 'deny', '103_org_structure' FROM vols
  ON CONFLICT (org_id, user_id, capability) DO NOTHING
  RETURNING org_id, user_id
)
INSERT INTO org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
SELECT 'org_capability_override', 'DENY', org_id, user_id, '103_org_structure', session_user,
       jsonb_build_object('capability', 'org.enrollment.write', 'why', 'volunteer preset gained this deny')
  FROM added;

-- ----------------------------------------------------------- after-guards --
-- Only what this file creates.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_profile', 'org_unit', 'unit_member', 'enrollment'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION '103 after: % is not RLS enabled and forced', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'enrollment' AND policyname = 'enrollment_reach' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION '103 after: enrollment has no RESTRICTIVE reach policy';
  END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid, uuid, uuid)') IS NULL
     OR NOT (SELECT p.prosecdef AND p.provolatile = 's' FROM pg_proc p WHERE p.oid = to_regprocedure('public.smr_staff_reach(uuid, uuid, uuid)')) THEN
    RAISE EXCEPTION '103 after: smr_staff_reach is missing, or not STABLE SECURITY DEFINER';
  END IF;
  IF to_regprocedure('public.smr_staff_unit_reach(uuid, uuid, uuid)') IS NULL
     OR position('unit_member' IN pg_get_functiondef(to_regprocedure('public.smr_staff_unit_reach(uuid, uuid, uuid)'))) = 0 THEN
    RAISE EXCEPTION '103 after: the unit reach hook is missing or still the 102 placeholder';
  END IF;
  IF NOT ('org.enrollment.write' = ANY (public.smr_delegable_capabilities())) THEN
    RAISE EXCEPTION '103 after: org.enrollment.write is not delegable';
  END IF;
  IF to_regclass('public.org_unit_active_name') IS NULL OR to_regclass('public.enrollment_one_open') IS NULL THEN
    RAISE EXCEPTION '103 after: a uniqueness index is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'org_unit', 'DELETE') OR has_table_privilege('smr_app', 'enrollment', 'DELETE')
       OR has_table_privilege('smr_app', 'org_profile', 'DELETE') THEN
      RAISE EXCEPTION '103 after: smr_app can delete a unit, an enrollment or a profile';
    END IF;
    IF NOT has_table_privilege('smr_app', 'enrollment', 'SELECT') OR NOT has_table_privilege('smr_app', 'unit_member', 'DELETE') THEN
      RAISE EXCEPTION '103 after: smr_app lacks a grant it needs';
    END IF;
    IF has_function_privilege('smr_app', 'public.smr_staff_unit_reach(uuid, uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '103 after: smr_app can call the unit reach hook directly';
    END IF;
    IF has_function_privilege('smr_app', 'public.smr_structure_activity(uuid, uuid, uuid, text, uuid, text, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '103 after: smr_app can write the activity log directly';
    END IF;
  END IF;
END $$;
