-- 105_workflow.sql
-- Staff workflow (house build lane L5, 2026-10-26): autosaved drafts, search
-- and duplicate checks, closed-loop referrals, retention tasks that make
-- themselves. The participant timeline reads these and older tables; it adds
-- no table of its own.
--
-- WHAT THIS ADDS
--   staff_draft          one unsaved text per staff member, organization,
--                        participant and field ("kind"). OWNER ONLY: nobody
--                        else reads it, not an admin, not the owner, not a
--                        platform admin looking in. Never visible to the
--                        participant. Purged after 30 days by the app.
--   participant_contact  the phone and other names an organization keeps for
--                        a participant (its own record, like the invite name),
--                        so search and the duplicate check can use them.
--   referral             a referral with an owner, a due date and a status
--                        that moves only along the closed-loop path below.
--   referral_event       its history, one row per change, written ONLY by a
--                        trigger (the app cannot insert, edit or delete it).
--   staff_task.source_*  marks a task the system made (retention check-ins),
--                        so making it again is a no-op.
--   pg_trgm             created when the database allows it; search scores
--                        names with it when present (orgSearch.ts asks), and
--                        falls back to contains and word-start matching.
--   smr_phone_digits     phone numbers compared as digits.
--
-- REFERRAL PATH (the same table as REFERRAL_TRANSITIONS in orgReferrals.ts):
--   draft              -> sent, closed
--   sent               -> accepted, declined, contacted, unable_to_contact, closed
--   accepted           -> contacted, service_delivered, unable_to_contact, closed
--   declined           -> sent, closed
--   contacted          -> service_delivered, unable_to_contact, closed
--   unable_to_contact  -> contacted, closed
--   service_delivered  -> closed
--   closed             -> (nothing; a new need is a new referral)
-- "closed" never means "helped": a closed referral that never passed
-- service_delivered is reported as closed without service (the NCCARE360
-- lesson). declined, unable_to_contact and a close without service need a reason.
--
-- CONSENT. A referral to a directory listing or to "other" sends nothing to
-- anyone: it is the organization's own record. A referral to a PARTNER
-- ORGANIZATION may leave draft only when the participant has an active
-- 'referrals' sharing grant with this organization. That scope does not exist
-- in sharingScopes.ts today, so such referrals stay drafts, by design, until a
-- consent step for them is built. consent_ok is computed by the database on
-- every write; the app cannot set it.
--
-- REACH. Every per-participant table here has RLS enabled and FORCED, org
-- scope (app.org_id) in its permissive policies, and a RESTRICTIVE policy
-- calling smr_staff_reach (migration 102) so a staff session sees only the
-- participants it reaches, even through a route that forgets to check.
--
-- DEPENDS ON 102 (smr_staff_reach, org_activity_write, retention_check
-- superseded_by). Refuses to run without it.
-- 103 (enrollment) is not needed here; the app reads it only when it exists.
--
-- Additive. Rollback: DROP TABLE referral_event, referral, participant_contact,
-- staff_draft CASCADE; ALTER TABLE staff_task DROP COLUMN source_kind,
-- DROP COLUMN source_id, DROP COLUMN source_mark; DROP the functions named
-- below (pg_trgm may stay). APPLY BEFORE the app release that ships the workflow routes.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '105 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.smr_staff_reach(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '105 needs migration 102 first (smr_staff_reach(org, staff, participant) is missing)';
  END IF;
  IF to_regprocedure('public.org_activity_write(uuid,uuid,uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '105 needs migration 102 first (org_activity_write is missing)';
  END IF;
END $$;

/* ------------------------------------------------------------ search helpers -- */

-- pg_trgm when the database allows it (Neon lists it; it is a trusted
-- extension). Any refusal leaves search on its plain fallback; nothing else
-- depends on it.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '105: pg_trgm not available (%); search uses contains-matching', SQLERRM;
  END;
END $$;

-- Digits only; a leading US country code is dropped so 1-555-0100 matches 555-0100.
-- Mirrors phoneDigits() in orgWorkflowShared.ts. Pure: reads no table.
CREATE OR REPLACE FUNCTION public.smr_phone_digits(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(CASE WHEN length(d) = 11 AND left(d, 1) = '1' THEN substr(d, 2) ELSE d END, '')
    FROM (SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS d) x
$$;
REVOKE ALL ON FUNCTION public.smr_phone_digits(text) FROM PUBLIC;

-- ACCOUNT AND ORGANIZATION DELETES (review B1, the 102 fix-round pattern).
-- A foreign key's ON DELETE SET NULL is an UPDATE, and the guards below refuse
-- most updates. This says yes to exactly that: the only columns that changed
-- are the listed ones, each went from a value to NULL, and the row it pointed
-- at (in users or access_code) no longer exists. Nobody can use it to strip a
-- name off a live record. Guards return early without re-stamping, and the
-- history trigger writes nothing for it.
CREATE OR REPLACE FUNCTION public.smr_only_gone_refs_cleared(p_new jsonb, p_old jsonb, p_cols text[], p_tables text[])
RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  i integer;
  v_any boolean := false;
  v_old text;
BEGIN
  IF (p_new - p_cols) IS DISTINCT FROM (p_old - p_cols) THEN RETURN false; END IF;
  FOR i IN 1 .. COALESCE(array_length(p_cols, 1), 0) LOOP
    CONTINUE WHEN (p_new -> p_cols[i]) IS NOT DISTINCT FROM (p_old -> p_cols[i]);
    v_old := p_old ->> p_cols[i];
    IF v_old IS NULL OR (p_new ->> p_cols[i]) IS NOT NULL THEN RETURN false; END IF;
    IF p_tables[i] = 'users' THEN
      IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_old::uuid) THEN RETURN false; END IF;
    ELSIF p_tables[i] = 'access_code' THEN
      IF EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = v_old::uuid) THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
    v_any := true;
  END LOOP;
  RETURN v_any;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_only_gone_refs_cleared(jsonb, jsonb, text[], text[]) FROM PUBLIC;

-- Search and Today read an organization's members by org. Until now only
-- (user_id) was indexed, so "everyone in this org" scanned every org's rows.
CREATE INDEX IF NOT EXISTS access_code_redemption_org_user ON access_code_redemption (access_code_id, user_id);

/* ------------------------------------------------------- participant_contact -- */

CREATE TABLE IF NOT EXISTS participant_contact (
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone               TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  phone_digits        TEXT GENERATED ALWAYS AS (public.smr_phone_digits(phone)) STORED,
  -- Other names they go by: a nickname, a name before a change. Never a DOC
  -- number or case number (the UI says so).
  aliases             TEXT[] NOT NULL DEFAULT '{}'
                      CHECK (cardinality(aliases) <= 5 AND array_position(aliases, NULL) IS NULL),
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (access_code_id, participant_user_id)
);
CREATE INDEX IF NOT EXISTS participant_contact_phone ON participant_contact (access_code_id, phone_digits) WHERE phone_digits IS NOT NULL;

CREATE OR REPLACE FUNCTION public.participant_contact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- The person who last edited it deleted their account (B1): keep the row as it was.
  -- phone_digits is a generated column: NULL in NEW inside a BEFORE trigger, so it is left out of the comparison.
  IF TG_OP = 'UPDATE' AND public.smr_only_gone_refs_cleared(to_jsonb(NEW) - 'phone_digits', to_jsonb(OLD) - 'phone_digits', ARRAY['updated_by'], ARRAY['users']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id) THEN
    RAISE EXCEPTION 'contact details cannot move to another person or organization' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.aliases) a WHERE length(btrim(a)) NOT BETWEEN 1 AND 120) THEN
    RAISE EXCEPTION 'each other name is 1 to 120 characters' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.participant_contact_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS participant_contact_guard ON participant_contact;
CREATE TRIGGER participant_contact_guard BEFORE INSERT OR UPDATE ON participant_contact
  FOR EACH ROW EXECUTE FUNCTION public.participant_contact_guard();

ALTER TABLE participant_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_contact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS participant_contact_select ON participant_contact;
CREATE POLICY participant_contact_select ON participant_contact FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS participant_contact_insert ON participant_contact;
CREATE POLICY participant_contact_insert ON participant_contact FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = participant_contact.participant_user_id AND r.access_code_id = participant_contact.access_code_id));
DROP POLICY IF EXISTS participant_contact_update ON participant_contact;
CREATE POLICY participant_contact_update ON participant_contact FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS participant_contact_reach ON participant_contact;
CREATE POLICY participant_contact_reach ON participant_contact AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

/* --------------------------------------------------------------- staff_draft -- */

CREATE TABLE IF NOT EXISTS staff_draft (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  -- NULL = a draft that is not about one participant.
  participant_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- Which field: "note", "task", "referral_reason", "outcome_note", or
  -- "field:<slug>" for a long custom field. Allowlisted in orgDrafts.ts.
  kind                TEXT NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}(:[a-z0-9_-]{1,60})?$'),
  body                TEXT NOT NULL CHECK (length(body) <= 20000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_draft_one
  ON staff_draft (user_id, access_code_id, (COALESCE(participant_user_id, '00000000-0000-0000-0000-000000000000'::uuid)), kind);
CREATE INDEX IF NOT EXISTS staff_draft_age ON staff_draft (user_id, updated_at);
-- For the 30-day purge across everyone's drafts.
CREATE INDEX IF NOT EXISTS staff_draft_updated ON staff_draft (updated_at);

CREATE OR REPLACE FUNCTION public.staff_draft_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.access_code_id IS DISTINCT FROM OLD.access_code_id
       OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'a draft cannot change hands' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_draft_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_draft_guard ON staff_draft;
CREATE TRIGGER staff_draft_guard BEFORE INSERT OR UPDATE ON staff_draft FOR EACH ROW EXECUTE FUNCTION public.staff_draft_guard();

ALTER TABLE staff_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_draft FORCE ROW LEVEL SECURITY;
-- OWNER ONLY, for every verb. The organization scope must also match, so a
-- draft written while acting for one organization never surfaces in another.
DROP POLICY IF EXISTS staff_draft_owner ON staff_draft;
CREATE POLICY staff_draft_owner ON staff_draft FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND (participant_user_id IS NULL OR EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = staff_draft.participant_user_id AND r.access_code_id = staff_draft.access_code_id)));
DROP POLICY IF EXISTS staff_draft_reach ON staff_draft;
CREATE POLICY staff_draft_reach ON staff_draft AS RESTRICTIVE FOR ALL
  USING (participant_user_id IS NULL
         OR NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (participant_user_id IS NULL
         OR NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

-- Purge (S4). A draft is words about a person in progress: it does not outlive
-- 30 days without a touch (which also ends drafts about someone the author can
-- no longer reach, since they cannot touch them), and it goes at once when its
-- author leaves the staff or the person leaves the organization. Run as the
-- owner; the app may call the time purge (it removes only stale rows).
CREATE OR REPLACE FUNCTION public.smr_purge_stale_staff_drafts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.staff_draft WHERE updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_purge_stale_staff_drafts() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.staff_draft_drop_on_staff_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.staff_draft d WHERE d.user_id = OLD.user_id AND d.access_code_id = OLD.access_code_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_draft_drop_on_staff_leave() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_draft_drop_on_staff_leave ON org_staff;
CREATE TRIGGER staff_draft_drop_on_staff_leave AFTER DELETE ON org_staff FOR EACH ROW EXECUTE FUNCTION public.staff_draft_drop_on_staff_leave();

CREATE OR REPLACE FUNCTION public.staff_draft_drop_on_member_leave() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.staff_draft d WHERE d.participant_user_id = OLD.user_id AND d.access_code_id = OLD.access_code_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_draft_drop_on_member_leave() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_draft_drop_on_member_leave ON access_code_redemption;
CREATE TRIGGER staff_draft_drop_on_member_leave AFTER DELETE ON access_code_redemption FOR EACH ROW EXECUTE FUNCTION public.staff_draft_drop_on_member_leave();

/* ------------------------------------------------------------------ referral -- */

CREATE TABLE IF NOT EXISTS referral (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_kind             TEXT NOT NULL CHECK (to_kind IN ('directory_resource', 'partner_org', 'other')),
  -- A directory listing (resource_app_v.service_id). No foreign key: listings
  -- are retired, never deleted, and the app role cannot read the base table.
  to_resource_id      UUID,
  to_access_code_id   UUID REFERENCES access_code(id) ON DELETE SET NULL,
  to_name             TEXT NOT NULL CHECK (length(btrim(to_name)) BETWEEN 2 AND 200),
  reason              TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'contacted', 'service_delivered', 'unable_to_contact', 'closed')),
  status_reason       TEXT CHECK (status_reason IS NULL OR length(status_reason) <= 500),
  owner_staff_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  due_on              DATE,
  consent_ok          BOOLEAN NOT NULL DEFAULT false,
  -- Set once by the trigger when service_delivered is reached, never unset:
  -- "closed" alone never claims anyone was helped.
  delivered_at        TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_kind = 'directory_resource' OR to_resource_id IS NULL),
  CHECK (to_kind <> 'directory_resource' OR to_resource_id IS NOT NULL),
  CHECK (to_kind = 'partner_org' OR to_access_code_id IS NULL),
  CHECK (to_access_code_id IS NULL OR to_access_code_id <> access_code_id),
  -- Blocked until consent: a partner-organization referral stays a draft (or
  -- is closed) unless the participant agreed.
  CHECK (to_kind <> 'partner_org' OR consent_ok OR status IN ('draft', 'closed')),
  CHECK (status NOT IN ('declined', 'unable_to_contact') OR length(btrim(COALESCE(status_reason, ''))) >= 2),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS referral_person ON referral (access_code_id, participant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_open_due ON referral (access_code_id, owner_staff_id, due_on) WHERE status <> 'closed';

-- The order of moves. One place in SQL; orgReferrals.ts mirrors it and a test
-- compares the two.
CREATE OR REPLACE FUNCTION public.smr_referral_next(p_from text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_from
    WHEN 'draft'             THEN ARRAY['sent', 'closed']
    WHEN 'sent'              THEN ARRAY['accepted', 'declined', 'contacted', 'unable_to_contact', 'closed']
    WHEN 'accepted'          THEN ARRAY['contacted', 'service_delivered', 'unable_to_contact', 'closed']
    WHEN 'declined'          THEN ARRAY['sent', 'closed']
    WHEN 'contacted'         THEN ARRAY['service_delivered', 'unable_to_contact', 'closed']
    WHEN 'unable_to_contact' THEN ARRAY['contacted', 'closed']
    WHEN 'service_delivered' THEN ARRAY['closed']
    ELSE ARRAY[]::text[]
  END
$$;
REVOKE ALL ON FUNCTION public.smr_referral_next(text) FROM PUBLIC;

-- Has the participant agreed to a referral leaving this organization? Reads
-- sharing_grant as its owner (the app may not see every grant row). The
-- 'referrals' scope is not offered to participants yet, so this is false
-- everywhere today: partner-organization referrals stay drafts.
-- Answers only inside the caller's own organization scope (like 102's
-- smr_staff_sees_all), and only the person's own choice counts: a program
-- requirement is not consent to send their name somewhere else.
CREATE OR REPLACE FUNCTION public.smr_referral_consent(p_org uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(p_org = NULLIF(current_setting('app.org_id', true), '')::uuid, false)
     AND EXISTS (SELECT 1 FROM public.sharing_grant g
                  WHERE g.user_id = p_participant AND g.access_code_id = p_org
                    AND g.scope = 'referrals' AND g.basis = 'participant_choice' AND g.revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.smr_referral_consent(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.referral_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'sent') THEN
      RAISE EXCEPTION 'a referral starts as a draft or as sent' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.delivered_at := NULL;
    NEW.closed_at := NULL;
  ELSE
    -- An account or a partner organization was deleted (B1): the foreign key
    -- clears its column. Allowed on any referral, closed ones included, and
    -- nothing else about the row moves or is re-stamped.
    IF public.smr_only_gone_refs_cleared(to_jsonb(NEW), to_jsonb(OLD),
         ARRAY['created_by', 'updated_by', 'owner_staff_id', 'to_access_code_id'], ARRAY['users', 'users', 'users', 'access_code']) THEN
      RETURN NEW;
    END IF;
    IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.participant_user_id IS DISTINCT FROM OLD.participant_user_id
       OR NEW.to_kind IS DISTINCT FROM OLD.to_kind OR NEW.to_resource_id IS DISTINCT FROM OLD.to_resource_id
       OR NEW.to_access_code_id IS DISTINCT FROM OLD.to_access_code_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a referral cannot be moved to another person, place or organization' USING ERRCODE = 'check_violation';
    END IF;
    -- A new owner must be on staff and reach the person (S3). Checked on change
    -- only: an owner who has since left does not freeze the referral.
    IF NEW.owner_staff_id IS DISTINCT FROM OLD.owner_staff_id AND NEW.owner_staff_id IS NOT NULL
       AND NOT public.smr_staff_reach(NEW.access_code_id, NEW.owner_staff_id, NEW.participant_user_id) THEN
      RAISE EXCEPTION 'a referral can be handed only to someone who works with this person' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'a closed referral stays closed; make a new one' USING ERRCODE = 'check_violation';
    END IF;
    -- Who it is to, and why, may be fixed only while it is still a draft.
    IF OLD.status <> 'draft' AND (NEW.to_name IS DISTINCT FROM OLD.to_name OR NEW.reason IS DISTINCT FROM OLD.reason) THEN
      RAISE EXCEPTION 'a referral that has gone out keeps its wording' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (NEW.status = ANY (public.smr_referral_next(OLD.status))) THEN
      RAISE EXCEPTION 'a referral cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'closed' AND OLD.status <> 'closed' AND OLD.delivered_at IS NULL
       AND length(btrim(COALESCE(NEW.status_reason, ''))) < 2 THEN
      RAISE EXCEPTION 'closing a referral that never delivered a service needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.delivered_at := OLD.delivered_at;
    NEW.closed_at := OLD.closed_at;
  END IF;
  IF NEW.status = 'service_delivered' AND NEW.delivered_at IS NULL THEN NEW.delivered_at := now(); END IF;
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  -- Nothing to do once closed.
  IF NEW.status = 'closed' THEN NEW.due_on := NULL; END IF;
  NEW.consent_ok := CASE WHEN NEW.to_kind = 'partner_org'
                         THEN public.smr_referral_consent(NEW.access_code_id, NEW.participant_user_id)
                         ELSE true END;
  NEW.updated_by := v_actor;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.referral_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS referral_guard ON referral;
CREATE TRIGGER referral_guard BEFORE INSERT OR UPDATE ON referral FOR EACH ROW EXECUTE FUNCTION public.referral_guard();

CREATE TABLE IF NOT EXISTS referral_event (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id         UUID NOT NULL REFERENCES referral(id) ON DELETE CASCADE,
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  participant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status         TEXT,
  to_status           TEXT NOT NULL,
  status_reason       TEXT,
  owner_staff_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  due_on              DATE,
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_event_ref ON referral_event (referral_id, at);
CREATE INDEX IF NOT EXISTS referral_event_person ON referral_event (access_code_id, participant_user_id, at DESC);

-- History and the activity log, written as the owner: the app role has no
-- INSERT on either. The activity row goes through 102's one writer,
-- org_activity_write, which stamps the actor and their role itself. Summaries name statuses only, never the place or the reason.
CREATE OR REPLACE FUNCTION public.referral_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_action text;
  v_summary text;
BEGIN
  -- An account or organization delete clearing a column is not an event (B1).
  IF TG_OP = 'UPDATE' AND public.smr_only_gone_refs_cleared(to_jsonb(NEW), to_jsonb(OLD),
       ARRAY['created_by', 'updated_by', 'owner_staff_id', 'to_access_code_id'], ARRAY['users', 'users', 'users', 'access_code']) THEN
    RETURN NULL;
  END IF;
  -- Verb first, fixed words and CHECK-listed statuses only (102's rule for summaries).
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_summary := 'made a referral (' || replace(NEW.status, '_', ' ') || ')';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := CASE WHEN NEW.status = 'closed' THEN 'closed' ELSE 'status_changed' END;
    v_summary := 'moved a referral from ' || replace(OLD.status, '_', ' ') || ' to ' || replace(NEW.status, '_', ' ');
  ELSIF NEW.owner_staff_id IS DISTINCT FROM OLD.owner_staff_id THEN
    v_action := 'assigned';
    v_summary := 'handed a referral to another staff member';
  ELSIF NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.to_name IS DISTINCT FROM OLD.to_name OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.status_reason IS DISTINCT FROM OLD.status_reason THEN
    v_action := 'updated';
    v_summary := 'changed a referral''s details';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO public.referral_event (referral_id, access_code_id, participant_user_id, from_status, to_status, status_reason, owner_staff_id, due_on, actor_user_id)
  VALUES (NEW.id, NEW.access_code_id, NEW.participant_user_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
          CASE WHEN TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.status_reason IS DISTINCT FROM OLD.status_reason THEN NEW.status_reason END,
          NEW.owner_staff_id, NEW.due_on, v_actor);
  PERFORM public.org_activity_write(NEW.access_code_id, NEW.participant_user_id, NEW.owner_staff_id, 'referral', NEW.id::text, v_action, v_summary);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.referral_history() FROM PUBLIC;
DROP TRIGGER IF EXISTS referral_history ON referral;
CREATE TRIGGER referral_history AFTER INSERT OR UPDATE ON referral FOR EACH ROW EXECUTE FUNCTION public.referral_history();

ALTER TABLE referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral FORCE ROW LEVEL SECURITY;
ALTER TABLE referral_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_event FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_select ON referral;
CREATE POLICY referral_select ON referral FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS referral_insert ON referral;
CREATE POLICY referral_insert ON referral FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r
               WHERE r.user_id = referral.participant_user_id AND r.access_code_id = referral.access_code_id)
  -- The owner is someone on staff who reaches this person (S3).
  AND (owner_staff_id IS NULL OR public.smr_staff_reach(access_code_id, owner_staff_id, participant_user_id)));
DROP POLICY IF EXISTS referral_update ON referral;
CREATE POLICY referral_update ON referral FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
-- The owner's reach is checked by referral_guard only when the owner CHANGES,
-- so a colleague can still work a referral whose stored owner has left the
-- staff (and take it over).
DROP POLICY IF EXISTS referral_reach ON referral;
CREATE POLICY referral_reach ON referral AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

DROP POLICY IF EXISTS referral_event_select ON referral_event;
CREATE POLICY referral_event_select ON referral_event FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
DROP POLICY IF EXISTS referral_event_reach ON referral_event;
CREATE POLICY referral_event_reach ON referral_event AS RESTRICTIVE FOR ALL
  USING (NULLIF(current_setting('app.org_id', true), '') IS NULL
         OR access_code_id IS DISTINCT FROM NULLIF(current_setting('app.org_id', true), '')::uuid
         OR public.smr_staff_reach(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid, participant_user_id));

/* ------------------------------------------- retention tasks that make themselves -- */

ALTER TABLE staff_task ADD COLUMN IF NOT EXISTS source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('retention'));
ALTER TABLE staff_task ADD COLUMN IF NOT EXISTS source_id UUID;
ALTER TABLE staff_task ADD COLUMN IF NOT EXISTS source_mark INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_task_source_whole' AND conrelid = 'public.staff_task'::regclass) THEN
    ALTER TABLE staff_task ADD CONSTRAINT staff_task_source_whole CHECK (
      (source_kind IS NULL AND source_id IS NULL AND source_mark IS NULL)
      OR (source_kind = 'retention' AND source_id IS NOT NULL AND source_mark IN (30, 90, 180) AND client_user_id IS NOT NULL));
  END IF;
END $$;
-- One task per placement and mark, ever: making it again is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS staff_task_source_once ON staff_task (source_kind, source_id, source_mark) WHERE source_kind IS NOT NULL;

-- A source cannot be changed, only the definer maker may set one, and a task
-- can only claim a placement of its own person and organization.
CREATE OR REPLACE FUNCTION public.staff_task_source_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.source_mark IS DISTINCT FROM OLD.source_mark THEN
      RAISE EXCEPTION 'where a task came from cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_kind IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.rolbypassrls OR r.rolsuper)) THEN
    -- Only the definer maker (owner, BYPASSRLS) marks a task as system-made.
    RAISE EXCEPTION 'only the system makes check-in tasks' USING ERRCODE = 'insufficient_privilege';
  ELSIF NEW.source_kind = 'retention' AND NOT EXISTS (
      SELECT 1 FROM public.outcome_record o
       WHERE o.id = NEW.source_id AND o.access_code_id = NEW.access_code_id AND o.client_user_id = NEW.client_user_id) THEN
    RAISE EXCEPTION 'a retention task must point at a placement for the same person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_task_source_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_task_source_guard ON staff_task;
CREATE TRIGGER staff_task_source_guard BEFORE INSERT OR UPDATE ON staff_task FOR EACH ROW EXECUTE FUNCTION public.staff_task_source_guard();

CREATE OR REPLACE FUNCTION public.smr_retention_task_title(p_mark integer, p_employer text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT left(p_mark || '-day check-in: still at ' || btrim(p_employer) || '?', 300)
$$;
REVOKE ALL ON FUNCTION public.smr_retention_task_title(integer, text) FROM PUBLIC;

-- The retention marks that get a task. 60 stays a check-in on the Outcomes tab
-- but gets no task (R26 asks for 30, 90 and 180).
CREATE OR REPLACE FUNCTION public.smr_retention_task_marks() RETURNS int[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$ SELECT ARRAY[30, 90, 180] $$;
REVOKE ALL ON FUNCTION public.smr_retention_task_marks() FROM PUBLIC;

-- Who owns a placement's check-in tasks (S5): the participant's assigned case
-- manager in this organization, if they are still on its staff; else whoever
-- recorded the placement, if they are still on staff AND see everyone (owner,
-- org admin, or a "sees everyone" grant with no deny); else nobody, and the
-- organization's owner and admins see the task unassigned. Never someone who
-- cannot reach the person. Read as the owner, so it works with no org scope
-- (the backfill) as well as inside one.
CREATE OR REPLACE FUNCTION public.smr_retention_task_owner(p_org uuid, p_participant uuid, p_recorder uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    (SELECT a.staff_user_id FROM public.client_staff_assignment a
      WHERE a.access_code_id = p_org AND a.client_user_id = p_participant
        AND (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = a.staff_user_id)
             OR EXISTS (SELECT 1 FROM public.access_code ac WHERE ac.id = p_org AND ac.partner_user_id = a.staff_user_id))
      LIMIT 1),
    (SELECT p_recorder WHERE p_recorder IS NOT NULL
        AND (EXISTS (SELECT 1 FROM public.access_code ac WHERE ac.id = p_org AND ac.partner_user_id = p_recorder)
             OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_recorder AND s.role = 'org_admin')
             OR (EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = p_org AND s.user_id = p_recorder)
                 AND EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_recorder
                              AND o.capability = 'org.client.view_all' AND o.effect = 'grant')))
        AND NOT EXISTS (SELECT 1 FROM public.org_capability_override o WHERE o.org_id = p_org AND o.user_id = p_recorder
                         AND o.capability = 'org.client.view_all' AND o.effect = 'deny')))
$$;
REVOKE ALL ON FUNCTION public.smr_retention_task_owner(uuid, uuid, uuid) FROM PUBLIC;

-- Make the 30/90/180-day tasks for one placement (owner above). Skips marks
-- with a current answer (102: superseded_by IS NULL) and marks after an end
-- date; never for an entry made by mistake. Idempotent: returns how many it
-- made now.
CREATE OR REPLACE FUNCTION public.smr_make_retention_tasks(p_outcome uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.outcome_record%ROWTYPE;
  v_owner uuid;
  v_actor uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_n integer := 0;
  v_one integer;
  m integer;
BEGIN
  SELECT * INTO o FROM public.outcome_record WHERE id = p_outcome;
  IF NOT FOUND OR COALESCE(o.end_reason, '') = 'entered_in_error' THEN RETURN 0; END IF;
  v_owner := public.smr_retention_task_owner(o.access_code_id, o.client_user_id, o.created_by);
  FOREACH m IN ARRAY public.smr_retention_task_marks() LOOP
    CONTINUE WHEN o.ended_on IS NOT NULL AND o.start_date + m > o.ended_on;
    -- Answered = a current answer exists (102: a correction supersedes, never edits).
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.retention_check k WHERE k.outcome_id = o.id AND k.day_mark = m AND k.superseded_by IS NULL);
    INSERT INTO public.staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, due_on, shared_with_participant,
                                   source_kind, source_id, source_mark)
    VALUES (o.access_code_id, o.client_user_id, v_owner, COALESCE(v_actor, o.created_by),
            public.smr_retention_task_title(m, o.employer), o.start_date + m, false,
            'retention', o.id, m)
    ON CONFLICT (source_kind, source_id, source_mark) WHERE source_kind IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_one = ROW_COUNT;
    v_n := v_n + v_one;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.smr_make_retention_tasks(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.outcome_retention_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_was_off boolean;
  v_is_off boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.smr_make_retention_tasks(NEW.id);
    RETURN NULL;
  END IF;
  -- A corrected start date or employer (102 correction): open tasks follow it.
  IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.employer IS DISTINCT FROM OLD.employer THEN
    UPDATE public.staff_task t
       SET due_on = NEW.start_date + t.source_mark, title = public.smr_retention_task_title(t.source_mark, NEW.employer)
     WHERE t.source_kind = 'retention' AND t.source_id = NEW.id AND t.done_at IS NULL AND t.cancelled_at IS NULL;
  END IF;
  IF NEW.ended_on IS DISTINCT FROM OLD.ended_on OR NEW.end_reason IS DISTINCT FROM OLD.end_reason OR NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    -- Ended: open check-ins after the end date are moot. Entered by mistake: all of them are.
    UPDATE public.staff_task t SET cancelled_at = now()
     WHERE t.source_kind = 'retention' AND t.source_id = NEW.id AND t.done_at IS NULL AND t.cancelled_at IS NULL
       AND (COALESCE(NEW.end_reason, '') = 'entered_in_error' OR (NEW.ended_on IS NOT NULL AND NEW.start_date + t.source_mark > NEW.ended_on));
    -- Un-ended, a later end date, or no longer "entered by mistake" (a
    -- correction): bring back the check-ins that apply again, re-dated, and
    -- make any that were never made.
    v_was_off := COALESCE(OLD.end_reason, '') = 'entered_in_error';
    v_is_off := COALESCE(NEW.end_reason, '') = 'entered_in_error';
    IF NOT v_is_off THEN
      UPDATE public.staff_task t
         SET cancelled_at = NULL, due_on = NEW.start_date + t.source_mark, title = public.smr_retention_task_title(t.source_mark, NEW.employer)
       WHERE t.source_kind = 'retention' AND t.source_id = NEW.id AND t.done_at IS NULL AND t.cancelled_at IS NOT NULL
         AND (NEW.ended_on IS NULL OR NEW.start_date + t.source_mark <= NEW.ended_on)
         AND (v_was_off OR (OLD.ended_on IS NOT NULL AND OLD.start_date + t.source_mark > OLD.ended_on))
         AND NOT EXISTS (SELECT 1 FROM public.retention_check k WHERE k.outcome_id = NEW.id AND k.day_mark = t.source_mark AND k.superseded_by IS NULL);
      PERFORM public.smr_make_retention_tasks(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.outcome_retention_tasks() FROM PUBLIC;
DROP TRIGGER IF EXISTS outcome_retention_tasks ON outcome_record;
CREATE TRIGGER outcome_retention_tasks AFTER INSERT OR UPDATE ON outcome_record FOR EACH ROW EXECUTE FUNCTION public.outcome_retention_tasks();

-- Answering a check-in finishes its task. A correction (a new current answer,
-- 102) finds the task already done and changes nothing.
CREATE OR REPLACE FUNCTION public.retention_check_done_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.staff_task t SET done_at = now(), done_by = NEW.checked_by
   WHERE t.source_kind = 'retention' AND t.source_id = NEW.outcome_id AND t.source_mark = NEW.day_mark
     AND t.done_at IS NULL AND t.cancelled_at IS NULL;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.retention_check_done_task() FROM PUBLIC;
DROP TRIGGER IF EXISTS retention_check_done_task ON retention_check;
CREATE TRIGGER retention_check_done_task AFTER INSERT ON retention_check FOR EACH ROW EXECUTE FUNCTION public.retention_check_done_task();

-- Placements recorded before this migration get their tasks too (idempotent).
-- Only placements still open that started in the last 120 days (S5): an old
-- placement does not need a fresh pile of overdue tasks. Count first with
-- packages/core/scripts/105-backfill-count.sql (read only).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.outcome_record
            WHERE ended_on IS NULL AND COALESCE(end_reason, '') <> 'entered_in_error' AND start_date > current_date - 120 LOOP
    PERFORM public.smr_make_retention_tasks(r.id);
  END LOOP;
END $$;

/* -------------------------------------------------------------------- grants -- */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON staff_draft, participant_contact, referral, referral_event FROM smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON staff_draft TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON participant_contact TO smr_app;
    GRANT SELECT, INSERT, UPDATE ON referral TO smr_app;
    GRANT SELECT ON referral_event TO smr_app;
    GRANT EXECUTE ON FUNCTION public.smr_phone_digits(text), public.smr_referral_next(text), public.smr_purge_stale_staff_drafts(),
                              public.smr_only_gone_refs_cleared(jsonb, jsonb, text[], text[]), public.smr_referral_consent(uuid, uuid),
                              public.smr_retention_task_marks() TO smr_app;
  END IF;
END $$;

/* --------------------------------------------------------------- after-guards -- */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_draft', 'participant_contact', 'referral', 'referral_event'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || t)::regclass AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '105: % must have row-level security enabled and forced', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION '105: % must carry the restrictive reach policy', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'referral_event', 'INSERT') OR has_table_privilege('smr_app', 'referral_event', 'UPDATE')
       OR has_table_privilege('smr_app', 'referral_event', 'DELETE') OR has_table_privilege('smr_app', 'referral', 'DELETE') THEN
      RAISE EXCEPTION '105: the app must not write referral history or delete referrals';
    END IF;
    IF has_function_privilege('smr_app', 'public.smr_make_retention_tasks(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '105: the app must not call smr_make_retention_tasks directly';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'staff_task_source_once') THEN
    RAISE EXCEPTION '105: staff_task_source_once is missing';
  END IF;
END $$;
