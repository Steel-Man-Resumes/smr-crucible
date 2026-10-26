-- 104_custom_fields_views.sql
-- Customization (house build L4, 2026-10-26): custom fields, saved views and
-- per-role layouts, as org-owned tables. Depends on 102 (smr_staff_reach,
-- org_activity) and 103 (enrollment). Merge order 100..106.
--
-- WHAT IT ADDS
--   custom_field_def    the fields an organization defines for a participant
--                       or an enrollment. Added, renamed, reordered and
--                       retired by the org's managers, never deleted. The key
--                       and the type are fixed once created (a value written
--                       as a date stays a date).
--   custom_field_value  one value per (field, record). Per-participant data:
--                       org-scoped like case notes AND reach-restricted, so a
--                       staff session sees and writes values only for people
--                       it reaches (smr_staff_reach, 102). Shape-checked here
--                       by type (the app validates first, with the plain
--                       message; this is the floor).
--   saved_view          a named arrangement of a list (columns, filters,
--                       sort, group). owner_user_id NULL = shared with the
--                       organization. Personal views by anyone on staff,
--                       shared views by managers. A view never widens reach:
--                       rows still come through the reach-checked reads.
--   org_role_layout     per role and surface, which Today sections and which
--                       caseload columns show, in what order.
--
-- WHO MAY DO WHAT, AS DATABASE FACTS (the app checks capabilities first)
--   read defs, layouts, shared views   the organization's own scope.
--   write defs, layouts, shared views  a manager of the organization: its
--                                      owner (access_code.partner_user_id) or
--                                      an org_admin (smr_org_manager below).
--                                      A platform admin acting on an org is
--                                      neither and is refused.
--   personal views                     their owner only, inside the org scope.
--   values                             org scope AND smr_staff_reach for the
--                                      participant the value is about.
--   participants                       nothing. Custom field values are org
--                                      records about a person, like notes.
--
-- AUDIT: AFTER triggers (SECURITY DEFINER) call 102's org_activity_write:
-- entity 'custom_field' for definitions and values, 'view' for shared views,
-- 'org' for layouts. Summaries are fixed words ("filled in a custom field"),
-- never a label, a view name or a value; the entity id says which field.
--
-- VALUE HISTORY: custom_field_value_version keeps every overwritten or cleared
-- value (append-only, definer trigger, same org scope and reach as values).
-- SENSITIVE IS ONE WAY: the def guard refuses true -> false.
--
-- Additive: five tables, seven functions, triggers and policies on the new
-- tables only. Nothing existing changes. Rollback:
--   DROP TABLE custom_field_value_version, custom_field_value, custom_field_def, saved_view, org_role_layout CASCADE;
--   DROP FUNCTION public.smr_org_manager(uuid), public.smr_org_staff_session(uuid), public.custom_field_def_guard(),
--     public.custom_field_value_guard(), public.custom_field_activity(), public.org_customization_activity(),
--     public.custom_field_value_keep_version();
-- APPLY BEFORE THE APP RELEASE that ships the Fields page, the caseload views
-- and the Today layouts (the RLS health check lists these four tables).
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  -- The activity triggers call org_activity_write as the owner.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '104 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  -- The reach policy calls 102's function. Without it the policy cannot be
  -- created, and creating the values table without its reach rule is the one
  -- thing this migration must never do.
  IF to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '104 needs migration 102 (public.smr_staff_reach(uuid, uuid, uuid)) applied first';
  END IF;
  IF to_regprocedure('public.org_activity_write(uuid,uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '104 needs migration 102 (public.org_activity_write) applied first';
  END IF;
END $$;

-- ------------------------------------------------------------ the manager --
-- Owner of the organization, or one of its org_admins. SECURITY INVOKER on
-- purpose: it reads access_code (not row-protected) and the caller's own
-- org_staff row (the 046 policy lets a person read their own membership).
CREATE OR REPLACE FUNCTION public.smr_org_manager(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT p_org IS NOT NULL AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.access_code a
             WHERE a.id = p_org AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.org_staff s
                WHERE s.access_code_id = p_org AND s.role = 'org_admin'
                  AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
$$;
REVOKE ALL ON FUNCTION public.smr_org_manager(uuid) FROM PUBLIC;

-- Someone on the organization's staff (owner or any org_staff row), or a
-- platform admin (the app keeps them read-only). Field names, shared view
-- names and layouts are read only by these, never by a participant session
-- that somehow carries the org scope. SECURITY INVOKER, like the manager check.
CREATE OR REPLACE FUNCTION public.smr_org_staff_session(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT p_org IS NOT NULL AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.access_code a
             WHERE a.id = p_org AND a.partner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.org_staff s
                WHERE s.access_code_id = p_org AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    OR EXISTS (SELECT 1 FROM public.platform_admin pa
                WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
$$;
REVOKE ALL ON FUNCTION public.smr_org_staff_session(uuid) FROM PUBLIC;

-- ------------------------------------------------------------------ tables --
CREATE TABLE IF NOT EXISTS custom_field_def (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  entity         TEXT NOT NULL CHECK (entity IN ('participant', 'enrollment')),
  key            TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label          TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  type           TEXT NOT NULL CHECK (type IN ('text', 'long_text', 'number', 'date', 'boolean',
                                               'single_select', 'multi_select', 'staff_member', 'url')),
  -- Select options: [{"id": "slug", "label": "Shown", "retired": false}]. The
  -- id is what a value stores, so an option can be renamed without touching
  -- a single value.
  options        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 100),
  required       BOOLEAN NOT NULL DEFAULT false,
  help           TEXT CHECK (help IS NULL OR length(help) <= 300),
  -- Sensitive values never go to an AI model and leave in an export only when
  -- the person exporting ticks them.
  sensitive      BOOLEAN NOT NULL DEFAULT false,
  position       INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  retired_at     TIMESTAMPTZ,
  retired_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (access_code_id, entity, key)
);
-- Two live fields with the same name on one record would be a guessing game.
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_def_live_label
  ON custom_field_def (access_code_id, entity, lower(btrim(label))) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS custom_field_def_org ON custom_field_def (access_code_id, entity, position);

CREATE TABLE IF NOT EXISTS custom_field_value (
  def_id              UUID NOT NULL REFERENCES custom_field_def(id) ON DELETE CASCADE,
  -- The participant's user id (entity participant) or the enrollment id.
  entity_id           UUID NOT NULL,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- Who the value is about. Set by the guard trigger, never by the caller:
  -- the reach policy reads it, so it must be the truth.
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value               JSONB NOT NULL CHECK (octet_length(value::text) <= 12000),
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (def_id, entity_id)
);
CREATE INDEX IF NOT EXISTS custom_field_value_entity ON custom_field_value (access_code_id, entity_id);
CREATE INDEX IF NOT EXISTS custom_field_value_person ON custom_field_value (access_code_id, participant_user_id);

CREATE TABLE IF NOT EXISTS saved_view (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- NULL = shared with the whole organization.
  owner_user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  surface        TEXT NOT NULL CHECK (surface IN ('caseload', 'today', 'tasks', 'outcomes', 'referrals', 'enrollments')),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Shape owned by TypeScript (savedViewsShared.ts), normalized on every read.
  definition     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 16000),
  -- Which role sees this shared view first. Personal views never carry one.
  role_default   TEXT CHECK (role_default IS NULL OR role_default ~ '^[a-z_]{2,40}$'),
  position       INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_user_id IS NULL OR role_default IS NULL)
);
-- One name per list per person (or per organization for shared views). Also
-- what makes moving the old saved sorts over safe to run twice.
CREATE UNIQUE INDEX IF NOT EXISTS saved_view_name
  ON saved_view (access_code_id, COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), surface, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS saved_view_list ON saved_view (access_code_id, surface, position);

CREATE TABLE IF NOT EXISTS org_role_layout (
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- owner, org_admin, staff today; a pattern rather than a list so a role
  -- added later (L2) needs no migration. The app normalizes against its own list.
  role           TEXT NOT NULL CHECK (role ~ '^[a-z_]{2,40}$'),
  surface        TEXT NOT NULL CHECK (surface IN ('caseload', 'today', 'tasks', 'outcomes', 'referrals', 'enrollments')),
  layout         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout) = 'object' AND octet_length(layout::text) <= 16000),
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (access_code_id, role, surface)
);

-- ------------------------------------------------------------------ guards --
-- A field cannot move between organizations or records, and its key and type
-- are fixed: every stored value was checked against them.
CREATE OR REPLACE FUNCTION public.custom_field_def_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.entity IS DISTINCT FROM OLD.entity
       OR NEW.key IS DISTINCT FROM OLD.key OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a field keeps its organization, record, key and type' USING ERRCODE = 'check_violation';
    END IF;
    -- Sensitive is one way. Lowering it would quietly let a field's values
    -- reach AI tools and exports; retire the field and make a new one instead.
    IF OLD.sensitive AND NOT NEW.sensitive THEN
      RAISE EXCEPTION 'a sensitive field stays sensitive: retire it and make a new field instead' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.created_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
    NEW.created_at := now();
  END IF;
  IF NEW.type IN ('single_select', 'multi_select') THEN
    IF jsonb_array_length(NEW.options) = 0 THEN
      RAISE EXCEPTION 'a choice field needs at least one choice' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) o
                WHERE jsonb_typeof(o) <> 'object' OR jsonb_typeof(o->'id') <> 'string'
                   OR NOT ((o->>'id') ~ '^[a-z0-9][a-z0-9_]{0,39}$')
                   OR jsonb_typeof(o->'label') <> 'string' OR length(btrim(o->>'label')) NOT BETWEEN 1 AND 80)
       OR (SELECT count(DISTINCT o->>'id') FROM jsonb_array_elements(NEW.options) o) <> jsonb_array_length(NEW.options) THEN
      RAISE EXCEPTION 'each choice needs a unique id and a label' USING ERRCODE = 'check_violation';
    END IF;
    -- A choice that values may hold is never removed, only retired.
    IF TG_OP = 'UPDATE' AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(OLD.options) AS was(opt)
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) AS now_(opt) WHERE now_.opt->>'id' = was.opt->>'id')) THEN
      RAISE EXCEPTION 'a choice can be retired, not removed' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF jsonb_array_length(NEW.options) <> 0 THEN
    RAISE EXCEPTION 'only choice fields have choices' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.custom_field_def_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS custom_field_def_guard ON custom_field_def;
CREATE TRIGGER custom_field_def_guard BEFORE INSERT OR UPDATE ON custom_field_def
  FOR EACH ROW EXECUTE FUNCTION public.custom_field_def_guard();

-- The value floor. SECURITY INVOKER on purpose: it sees the definition, the
-- membership and the enrollment exactly as the caller may, so a staff session
-- that cannot see an enrollment (reach) cannot attach a value to it, and the
-- function is no oracle about rows the caller could not read.
CREATE OR REPLACE FUNCTION public.custom_field_value_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  d       public.custom_field_def%ROWTYPE;
  v       jsonb := NEW.value;
  v_who   uuid;
  v_opt   text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.def_id IS DISTINCT FROM OLD.def_id OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
                           OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id) THEN
    RAISE EXCEPTION 'a value stays on its field and record' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM public.custom_field_def WHERE id = NEW.def_id;
  IF NOT FOUND OR d.access_code_id IS DISTINCT FROM NEW.access_code_id THEN
    RAISE EXCEPTION 'no such field in this organization' USING ERRCODE = 'check_violation';
  END IF;
  IF d.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'that field is retired: its old values stay, new ones are not taken' USING ERRCODE = 'check_violation';
  END IF;

  -- Who the value is about, from the record itself.
  IF d.entity = 'participant' THEN
    SELECT r.user_id INTO v_who FROM public.access_code_redemption r
     WHERE r.user_id = NEW.entity_id AND r.access_code_id = NEW.access_code_id;
  ELSE
    IF to_regclass('public.enrollment') IS NULL THEN
      RAISE EXCEPTION 'enrollments are not set up in this database' USING ERRCODE = 'check_violation';
    END IF;
    EXECUTE 'SELECT participant_user_id FROM public.enrollment WHERE id = $1 AND access_code_id = $2'
      INTO v_who USING NEW.entity_id, NEW.access_code_id;
  END IF;
  IF v_who IS NULL THEN
    RAISE EXCEPTION 'that record is not in this organization' USING ERRCODE = 'check_violation';
  END IF;
  NEW.participant_user_id := v_who;

  -- Shape by type. Plain messages; the app says it better first.
  CASE d.type
    WHEN 'text' THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 500 THEN RAISE EXCEPTION 'expected a short text' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'long_text' THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 5000 THEN RAISE EXCEPTION 'expected a text' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'number' THEN
      IF jsonb_typeof(v) <> 'number' THEN RAISE EXCEPTION 'expected a number' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'date' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT ((v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$') THEN
        RAISE EXCEPTION 'expected a date' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM (v #>> '{}')::date;
    WHEN 'boolean' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'expected yes or no' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'single_select' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.options) o WHERE o->>'id' = v #>> '{}') THEN
        RAISE EXCEPTION 'expected one of the field''s choices' USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'multi_select' THEN
      IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) > 100 THEN RAISE EXCEPTION 'expected a list of choices' USING ERRCODE = 'check_violation'; END IF;
      FOR v_opt IN SELECT e #>> '{}' FROM jsonb_array_elements(v) e LOOP
        IF v_opt IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.options) o WHERE o->>'id' = v_opt) THEN
          RAISE EXCEPTION 'expected only the field''s choices' USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string')
         OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) <> jsonb_array_length(v) THEN
        RAISE EXCEPTION 'each choice once' USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'staff_member' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT ((v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
         OR NOT (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = NEW.access_code_id AND s.user_id = (v #>> '{}')::uuid)
                 OR EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = NEW.access_code_id AND a.partner_user_id = (v #>> '{}')::uuid)) THEN
        RAISE EXCEPTION 'expected someone on this organization''s staff' USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'url' THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 2000 OR NOT ((v #>> '{}') ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$') THEN
        RAISE EXCEPTION 'expected a web address starting with http:// or https://' USING ERRCODE = 'check_violation';
      END IF;
  END CASE;

  NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.custom_field_value_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS custom_field_value_guard ON custom_field_value;
CREATE TRIGGER custom_field_value_guard BEFORE INSERT OR UPDATE ON custom_field_value
  FOR EACH ROW EXECUTE FUNCTION public.custom_field_value_guard();

-- ---------------------------------------------------------------- activity --
-- Every change goes through 102's one writer, public.org_activity_write, from
-- SECURITY DEFINER triggers with a pinned search_path (the app role can
-- neither write org_activity nor call the writer). Summaries are FIXED WORDS
-- only (102's rule: never text a person typed), so no field label, view name
-- or value can reach the log. The entity id (the field or view id) says which.
CREATE OR REPLACE FUNCTION public.custom_field_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_def    public.custom_field_def%ROWTYPE;
  v_what   text;
  v_action text;
  v_sum    text;
BEGIN
  IF TG_TABLE_NAME = 'custom_field_def' THEN
    -- Reordering moves position only; that is not news.
    IF TG_OP = 'UPDATE' AND (NEW.label, NEW.options, NEW.required, NEW.help, NEW.sensitive, NEW.retired_at)
         IS NOT DISTINCT FROM (OLD.label, OLD.options, OLD.required, OLD.help, OLD.sensitive, OLD.retired_at) THEN
      RETURN NULL;
    END IF;
    v_what := CASE WHEN NEW.sensitive THEN 'a sensitive custom field' ELSE 'a custom field' END
              || CASE WHEN NEW.entity = 'enrollment' THEN ' for enrollments' ELSE '' END;
    IF TG_OP = 'INSERT' THEN
      v_action := 'created'; v_sum := 'added ' || v_what;
    ELSIF NEW.retired_at IS NOT NULL AND OLD.retired_at IS NULL THEN
      v_action := 'closed'; v_sum := 'retired ' || v_what;
    ELSIF NEW.retired_at IS NULL AND OLD.retired_at IS NOT NULL THEN
      v_action := 'reopened'; v_sum := 'brought back ' || v_what;
    ELSIF NEW.sensitive AND NOT OLD.sensitive THEN
      v_action := 'updated'; v_sum := 'marked a custom field sensitive' || CASE WHEN NEW.entity = 'enrollment' THEN ' for enrollments' ELSE '' END;
    ELSE
      v_action := 'updated'; v_sum := 'changed ' || v_what;
    END IF;
    PERFORM public.org_activity_write(NEW.access_code_id, NULL, NULL, 'custom_field', NEW.id::text, v_action, v_sum);
    RETURN NULL;
  END IF;

  -- custom_field_value
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN RETURN NULL; END IF;
  SELECT * INTO v_def FROM public.custom_field_def WHERE id = COALESCE(NEW.def_id, OLD.def_id);
  v_what := CASE WHEN v_def.sensitive THEN 'a sensitive custom field' ELSE 'a custom field' END
            || CASE WHEN v_def.entity = 'enrollment' THEN ' on an enrollment' ELSE '' END;
  IF TG_OP = 'INSERT' THEN v_action := 'created'; v_sum := 'filled in ' || v_what;
  ELSIF TG_OP = 'UPDATE' THEN v_action := 'updated'; v_sum := 'changed ' || v_what;
  ELSE v_action := 'deleted'; v_sum := 'cleared ' || v_what;
  END IF;
  PERFORM public.org_activity_write(COALESCE(NEW.access_code_id, OLD.access_code_id), COALESCE(NEW.participant_user_id, OLD.participant_user_id),
                                    NULL, 'custom_field', COALESCE(NEW.def_id, OLD.def_id)::text, v_action, v_sum);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.custom_field_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS custom_field_def_activity ON custom_field_def;
CREATE TRIGGER custom_field_def_activity AFTER INSERT OR UPDATE ON custom_field_def
  FOR EACH ROW EXECUTE FUNCTION public.custom_field_activity();
DROP TRIGGER IF EXISTS custom_field_value_activity ON custom_field_value;
CREATE TRIGGER custom_field_value_activity AFTER INSERT OR UPDATE OR DELETE ON custom_field_value
  FOR EACH ROW EXECUTE FUNCTION public.custom_field_activity();

-- Shared views and role layouts change what a whole organization sees, so
-- they are on the record too. Personal views are nobody else's business.
CREATE OR REPLACE FUNCTION public.org_customization_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_action text := CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  v_role   text;
  v_screen text;
BEGIN
  IF TG_TABLE_NAME = 'saved_view' THEN
    -- Only views that are (or were) shared with the organization.
    IF NOT ((TG_OP <> 'DELETE' AND NEW.owner_user_id IS NULL) OR (TG_OP <> 'INSERT' AND OLD.owner_user_id IS NULL)) THEN
      RETURN NULL;
    END IF;
    PERFORM public.org_activity_write(COALESCE(NEW.access_code_id, OLD.access_code_id), NULL, NULL, 'view', COALESCE(NEW.id, OLD.id)::text, v_action,
      CASE TG_OP WHEN 'INSERT' THEN 'added a shared view' WHEN 'UPDATE' THEN 'changed a shared view' ELSE 'removed a shared view' END);
    RETURN NULL;
  END IF;
  -- org_role_layout: role and screen as fixed words.
  v_role := CASE COALESCE(NEW.role, OLD.role) WHEN 'owner' THEN 'the owner' WHEN 'org_admin' THEN 'admins' WHEN 'staff' THEN 'staff' ELSE 'a role' END;
  v_screen := CASE COALESCE(NEW.surface, OLD.surface) WHEN 'today' THEN 'Today' WHEN 'caseload' THEN 'People' WHEN 'tasks' THEN 'Tasks'
                WHEN 'outcomes' THEN 'Outcomes' WHEN 'referrals' THEN 'Referrals' ELSE 'Enrollments' END;
  PERFORM public.org_activity_write(COALESCE(NEW.access_code_id, OLD.access_code_id), NULL, NULL, 'org', COALESCE(NEW.access_code_id, OLD.access_code_id)::text,
    'updated', format('%s the %s layout for %s', CASE TG_OP WHEN 'DELETE' THEN 'reset' ELSE 'changed' END, v_screen, v_role));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.org_customization_activity() FROM PUBLIC;
DROP TRIGGER IF EXISTS saved_view_activity ON saved_view;
CREATE TRIGGER saved_view_activity AFTER INSERT OR UPDATE OR DELETE ON saved_view
  FOR EACH ROW EXECUTE FUNCTION public.org_customization_activity();
DROP TRIGGER IF EXISTS org_role_layout_activity ON org_role_layout;
CREATE TRIGGER org_role_layout_activity AFTER INSERT OR UPDATE OR DELETE ON org_role_layout
  FOR EACH ROW EXECUTE FUNCTION public.org_customization_activity();

-- ----------------------------------------------------------- value history --
-- Overwriting or clearing a value keeps the earlier one, like case notes keep
-- earlier wordings (051). Append-only: written only by the definer trigger
-- below, read under the same org scope and reach as the values themselves.
CREATE TABLE IF NOT EXISTS custom_field_value_version (
  id                  BIGSERIAL PRIMARY KEY,
  def_id              UUID NOT NULL REFERENCES custom_field_def(id) ON DELETE CASCADE,
  entity_id           UUID NOT NULL,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The value as it was before this change, and who had set it, when.
  value               JSONB NOT NULL,
  set_by              UUID,
  set_at              TIMESTAMPTZ,
  -- What replaced it: 'changed' (a new value) or 'cleared'.
  change              TEXT NOT NULL CHECK (change IN ('changed', 'cleared')),
  replaced_by         UUID,
  replaced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_field_value_version_entity ON custom_field_value_version (access_code_id, entity_id, def_id, replaced_at DESC);

CREATE OR REPLACE FUNCTION public.custom_field_value_keep_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN RETURN NULL; END IF;
  -- A cascade from deleting the organization, the person or the field takes
  -- the history with it (their own foreign keys); nothing to keep.
  IF NOT EXISTS (SELECT 1 FROM public.access_code WHERE id = OLD.access_code_id)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.participant_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.custom_field_def WHERE id = OLD.def_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.custom_field_value_version
    (def_id, entity_id, access_code_id, participant_user_id, value, set_by, set_at, change, replaced_by)
  VALUES (OLD.def_id, OLD.entity_id, OLD.access_code_id, OLD.participant_user_id, OLD.value, OLD.updated_by, OLD.updated_at,
          CASE TG_OP WHEN 'DELETE' THEN 'cleared' ELSE 'changed' END,
          NULLIF(current_setting('app.user_id', true), '')::uuid);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.custom_field_value_keep_version() FROM PUBLIC;
DROP TRIGGER IF EXISTS custom_field_value_keep_version ON custom_field_value;
CREATE TRIGGER custom_field_value_keep_version AFTER UPDATE OR DELETE ON custom_field_value
  FOR EACH ROW EXECUTE FUNCTION public.custom_field_value_keep_version();

ALTER TABLE custom_field_value_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_value_version FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_field_value_version_select ON custom_field_value_version;
CREATE POLICY custom_field_value_version_select ON custom_field_value_version FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS custom_field_value_version_reach ON custom_field_value_version;
CREATE POLICY custom_field_value_version_reach ON custom_field_value_version AS RESTRICTIVE FOR ALL
  USING (public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));
-- No INSERT, UPDATE or DELETE policy, and (below) no such grant: the app reads.

-- ---------------------------------------------------------------- policies --
ALTER TABLE custom_field_def ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_def FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_value FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_view FORCE ROW LEVEL SECURITY;
ALTER TABLE org_role_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_role_layout FORCE ROW LEVEL SECURITY;

-- custom_field_def: the org reads; managers write. No DELETE (retire instead).
DROP POLICY IF EXISTS custom_field_def_select ON custom_field_def;
CREATE POLICY custom_field_def_select ON custom_field_def FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_staff_session(access_code_id));
DROP POLICY IF EXISTS custom_field_def_insert ON custom_field_def;
CREATE POLICY custom_field_def_insert ON custom_field_def FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS custom_field_def_update ON custom_field_def;
CREATE POLICY custom_field_def_update ON custom_field_def FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));

-- custom_field_value: org scope (permissive) AND reach (restrictive).
DROP POLICY IF EXISTS custom_field_value_select ON custom_field_value;
CREATE POLICY custom_field_value_select ON custom_field_value FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS custom_field_value_insert ON custom_field_value;
CREATE POLICY custom_field_value_insert ON custom_field_value FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS custom_field_value_update ON custom_field_value;
CREATE POLICY custom_field_value_update ON custom_field_value FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS custom_field_value_delete ON custom_field_value;
CREATE POLICY custom_field_value_delete ON custom_field_value FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
-- The reach wall (SPEC: 102 signature smr_staff_reach(org, staff, participant)).
-- FOR ALL, so it narrows reads AND writes: a staff session cannot see, set,
-- change or clear a value about someone outside its reach, even through a
-- route that forgets the app-level check. WITH CHECK runs after the BEFORE
-- trigger has set participant_user_id from the record itself.
DROP POLICY IF EXISTS custom_field_value_reach ON custom_field_value;
CREATE POLICY custom_field_value_reach ON custom_field_value AS RESTRICTIVE FOR ALL
  USING (public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- saved_view: your own views and the org's shared ones; shared ones are
-- written by managers only.
DROP POLICY IF EXISTS saved_view_select ON saved_view;
CREATE POLICY saved_view_select ON saved_view FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND ((owner_user_id IS NULL AND public.smr_org_staff_session(access_code_id))
              OR owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS saved_view_insert ON saved_view;
CREATE POLICY saved_view_insert ON saved_view FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                   OR (owner_user_id IS NULL AND public.smr_org_manager(access_code_id))));
DROP POLICY IF EXISTS saved_view_update ON saved_view;
CREATE POLICY saved_view_update ON saved_view FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              OR (owner_user_id IS NULL AND public.smr_org_manager(access_code_id))))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
              AND (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                   OR (owner_user_id IS NULL AND public.smr_org_manager(access_code_id))));
DROP POLICY IF EXISTS saved_view_delete ON saved_view;
CREATE POLICY saved_view_delete ON saved_view FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              OR (owner_user_id IS NULL AND public.smr_org_manager(access_code_id))));

-- org_role_layout: the org reads; managers write.
DROP POLICY IF EXISTS org_role_layout_select ON org_role_layout;
CREATE POLICY org_role_layout_select ON org_role_layout FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_staff_session(access_code_id));
DROP POLICY IF EXISTS org_role_layout_insert ON org_role_layout;
CREATE POLICY org_role_layout_insert ON org_role_layout FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS org_role_layout_update ON org_role_layout;
CREATE POLICY org_role_layout_update ON org_role_layout FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));
DROP POLICY IF EXISTS org_role_layout_delete ON org_role_layout;
CREATE POLICY org_role_layout_delete ON org_role_layout FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid AND public.smr_org_manager(access_code_id));

-- ------------------------------------------------------------------ grants --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON custom_field_def, custom_field_value, custom_field_value_version, saved_view, org_role_layout FROM smr_app;
    GRANT SELECT ON custom_field_value_version TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON custom_field_def TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_value TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON saved_view TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON org_role_layout TO smr_app;
    REVOKE ALL ON FUNCTION public.smr_org_manager(uuid) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_org_manager(uuid) TO smr_app;
    REVOKE ALL ON FUNCTION public.smr_org_staff_session(uuid) FROM smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_org_staff_session(uuid) TO smr_app;
    REVOKE ALL ON FUNCTION public.custom_field_value_keep_version() FROM smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------ after-guards --
-- Only what this migration created.
DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_field_def', 'custom_field_value', 'custom_field_value_version', 'saved_view', 'org_role_layout'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '104 after: % does not have row-level security enabled and forced', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_field_value'
                  AND policyname = 'custom_field_value_reach' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL') THEN
    RAISE EXCEPTION '104 after: the reach policy on custom_field_value is missing or not restrictive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_field_value_version'
                  AND policyname = 'custom_field_value_version_reach' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL') THEN
    RAISE EXCEPTION '104 after: the reach policy on custom_field_value_version is missing or not restrictive';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('custom_field_def_guard', 'custom_field_value_guard', 'custom_field_def_activity',
                    'custom_field_value_activity', 'saved_view_activity', 'org_role_layout_activity',
                    'custom_field_value_keep_version') AND NOT tgisinternal;
  IF n <> 7 THEN
    RAISE EXCEPTION '104 after: expected 7 triggers, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.custom_field_def', 'DELETE') THEN
      RAISE EXCEPTION '104 after: smr_app can delete field definitions (retire only)';
    END IF;
    IF NOT has_table_privilege('smr_app', 'public.custom_field_value', 'SELECT') THEN
      RAISE EXCEPTION '104 after: smr_app cannot read custom_field_value';
    END IF;
    IF has_table_privilege('smr_app', 'public.custom_field_value_version', 'INSERT')
       OR has_table_privilege('smr_app', 'public.custom_field_value_version', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.custom_field_value_version', 'DELETE') THEN
      RAISE EXCEPTION '104 after: smr_app can write value history (append-only, trigger only)';
    END IF;
    IF has_function_privilege('smr_app', 'public.custom_field_activity()', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.org_customization_activity()', 'EXECUTE')
       OR has_function_privilege('smr_app', 'public.custom_field_value_keep_version()', 'EXECUTE') THEN
      RAISE EXCEPTION '104 after: smr_app can call an activity writer directly';
    END IF;
  END IF;
  IF has_function_privilege('public', 'public.custom_field_activity()', 'EXECUTE')
     OR has_function_privilege('public', 'public.org_customization_activity()', 'EXECUTE')
     OR has_function_privilege('public', 'public.custom_field_value_keep_version()', 'EXECUTE') THEN
    RAISE EXCEPTION '104 after: PUBLIC can call an activity or history writer';
  END IF;
END $$;
