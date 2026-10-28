-- 112_directory_contributions.sql
-- Staff as research agents for the employer and resource directory: four ways
-- in, one review queue the SMR data owner works, nothing publishes on its own
-- (staff side build lane S6, 2026-10-27).
--
-- THE FOUR FLOWS (directory_contribution.flow)
--   new_place       "Add a place we are missing" (an employer or a local help program)
--   correction      "Something here is wrong" (hours, phone, closed, moved)
--   called_today    "I called them today": what they said, the date, and how
--                   (phone call, in person, an email reply from them, a visit)
--   knows_someone   "I know someone who hires there": the person stays in
--                   private_note, which no view, no staff read-back and no
--                   publication ever returns
--
-- RULES MADE INTO DATABASE FACTS
--   * Only the data owner decides (platform admin, as every directory table in
--     061 and 072). The app role cannot insert or update a contribution row
--     directly: staff submit through submit_directory_contribution (SECURITY
--     DEFINER, the 085 intake pattern), read back through
--     my_directory_contributions (never private_note), and withdraw through
--     withdraw_directory_contribution. The owner decides through
--     decide_directory_contribution and records a verified call through
--     apply_contribution_call.
--   * A logged live call is the documented interaction behind employer Tier 2
--     and resource R3 (the 073 rules): apply_contribution_call writes an
--     employer_relationship (avenue partner_org, partner_org_id = the program)
--     with a dated employer_relationship_confirmation, or a resource
--     relationship event kind 'confirmed' bound to the service's live check.
--     Only phone_call, in_person (a visit counts as in person) and email_reply
--     can do that. Hearsay ('heard_from_someone') can never be approved as a
--     verified call (CHECK), the same rule as 073's partner_report block.
--     The employer's Tier 2 still needs the owner's 'certain' evidence row on
--     that relationship: this function records the interaction, it does not
--     grade evidence.
--   * Credit is recorded, never shown publicly (Troy has not decided the
--     listing wording, decision 5): access_code_id is the program,
--     submitted_by the staff member, credit_org_ok defaults true,
--     credit_person_ok defaults false. No publication view reads this table.
--     confirmed_by / recorded_by on the directory rows is 'org:<uuid>', never
--     a person's name.
--   * Contributions earn credit only on approval: a verified call or a warm
--     introduction 3, a correction 2, a new row 1 (staffRewardsShared.ts
--     CONTRIBUTION_CREDIT is the same table). An approval reverted within 30
--     days takes its milestones back. Every approval sets a re-check date a
--     year after the interaction (the 211 / Inform USA yearly standard).
--   * Limits: 20 submissions a day per staff member, 60 per organization;
--     the same flow about the same listing by the same person within a day
--     returns the earlier submission instead of a new row.
--
-- ALSO: staff_listing_nudge, one row per staff member per listing, so t.ROY
-- asks "Did this place still check out?" at most once a week per listing.
--
-- APPLY AFTER 111 (staff_milestone_grant). Additive: two tables, six
-- functions, and a `provenance` column ('smr' by default, 'partner_staff'
-- for a program's call) on employer_relationship, its confirmations,
-- resource_relationship and its events. No view, policy, existing CHECK or
-- publication contract changes. FOR TROY: a program's live call counts as
-- the documented interaction (R3 / the Tier 2 relationship) and is marked
-- partner_staff, so any later count of Steel Man's own contacts excludes it.
--
-- ROLLBACK, in this order:
--   1. Revert the S6 app code and deploy that.
--   2. As the owner role (pg_dump directory_contribution first: it is real
--      research history), in one transaction:
--        DROP TABLE IF EXISTS staff_listing_nudge, directory_contribution CASCADE;
--        DROP FUNCTION IF EXISTS public.submit_directory_contribution(jsonb),
--          public.my_directory_contributions(), public.withdraw_directory_contribution(uuid),
--          public.decide_directory_contribution(uuid, text, text, text),
--          public.apply_contribution_call(uuid, uuid, uuid), public.directory_contribution_owner(),
--          public.staff_listing_nudge_guard();
--        DROP VIEW IF EXISTS directory_contact_provenance_v;
--        (the provenance columns and their fixed-value triggers may stay: every existing row reads 'smr'.)
--        DELETE FROM _migrations WHERE filename = '112_directory_contributions.sql';
--      Rows already written to employer_relationship_confirmation or
--      resource_relationship_event stay (they are dated facts; void a wrong
--      event through resource_relationship_event_void as 073 says).
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------- pre-guards --
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '112 needs an owner with BYPASSRLS; % has none', current_user;
  END IF;
  IF to_regprocedure('public.staff_milestone_grant(uuid,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION '112 needs migration 111 (staff_milestone_grant) first';
  END IF;
END $$;

-- ---------------------------------------------------------------- tables --
CREATE TABLE IF NOT EXISTS directory_contribution (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The program the staff member works for (credit goes here, never public yet).
  access_code_id     UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  submitted_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  flow               TEXT NOT NULL CHECK (flow IN ('new_place', 'correction', 'called_today', 'knows_someone')),
  target_kind        TEXT NOT NULL CHECK (target_kind IN ('employer', 'resource')),
  -- employer_org.id or resource_service.id. No foreign key: listings are
  -- retired, never deleted, and the app role cannot read the base tables.
  target_id          UUID,
  -- Public-safe fields only, cleaned by the intake function: name, city,
  -- state, website, phone (an organization line), change, said.
  details            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND length(details::text) <= 4000),
  interaction_on     DATE,
  interaction_method TEXT CHECK (interaction_method IN ('phone_call', 'in_person', 'email_reply', 'site_visit', 'website', 'heard_from_someone')),
  source_url         TEXT CHECK (source_url IS NULL OR (source_url ~ '^https?://' AND length(source_url) <= 500)),
  -- A person's name or number. Owner-only; never returned to staff, never published.
  private_note       TEXT CHECK (private_note IS NULL OR length(btrim(private_note)) BETWEEN 1 AND 1000),
  credit_org_ok      BOOLEAN NOT NULL DEFAULT true,
  credit_person_ok   BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'approved', 'needs_more', 'not_used', 'withdrawn')),
  outcome            TEXT CHECK (outcome IN ('verified_call', 'warm_intro', 'correction', 'new_row')),
  owner_answer       TEXT CHECK (owner_answer IS NULL OR length(btrim(owner_answer)) BETWEEN 1 AND 300),
  decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  recheck_on         DATE,
  applied_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT directory_contribution_target CHECK (flow IN ('new_place', 'knows_someone') OR target_id IS NOT NULL),
  CONSTRAINT directory_contribution_new_has_no_target CHECK (flow <> 'new_place' OR target_id IS NULL),
  CONSTRAINT directory_contribution_call_documented CHECK (flow <> 'called_today'
    OR (interaction_on IS NOT NULL AND interaction_method IN ('phone_call', 'in_person', 'email_reply', 'site_visit'))),
  CONSTRAINT directory_contribution_hires_is_employer CHECK (flow <> 'knows_someone' OR target_kind = 'employer'),
  CONSTRAINT directory_contribution_outcome_when_approved CHECK ((status = 'approved') = (outcome IS NOT NULL)),
  -- Hearsay never verifies; each outcome belongs to its flow.
  CONSTRAINT directory_contribution_outcome_fits CHECK (outcome IS NULL
    OR (outcome = 'verified_call' AND flow = 'called_today' AND interaction_method IN ('phone_call', 'in_person', 'email_reply', 'site_visit'))
    OR (outcome = 'warm_intro' AND flow = 'knows_someone')
    OR (outcome = 'correction' AND flow IN ('correction', 'called_today'))
    OR (outcome = 'new_row' AND flow = 'new_place')),
  -- An answer names a time; a fresh submission has none. (A withdrawal after
  -- "needs more" keeps the time that question was asked.)
  CONSTRAINT directory_contribution_decided CHECK ((status NOT IN ('approved', 'needs_more', 'not_used') OR decided_at IS NOT NULL)
                                                   AND (status <> 'received' OR decided_at IS NULL)),
  CONSTRAINT directory_contribution_applied_is_call CHECK (applied_at IS NULL OR (outcome = 'verified_call' AND status = 'approved'))
);
CREATE INDEX IF NOT EXISTS directory_contribution_queue ON directory_contribution (created_at) WHERE status = 'received';
CREATE INDEX IF NOT EXISTS directory_contribution_org ON directory_contribution (access_code_id, submitted_by, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_listing_nudge (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  listing_kind   TEXT NOT NULL CHECK (listing_kind IN ('employer', 'resource')),
  listing_id     UUID NOT NULL,
  shown_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, access_code_id, listing_kind, listing_id)
);

-- ------------------------------------------------------------ provenance --
-- A staff member's live call is the documented interaction (Troy's
-- direction), but it is a PARTNER's call, not Steel Man's own. Every
-- relationship and contact row apply_contribution_call writes says so in a
-- structured column, so nothing later reads it as SMR's own contact. Existing
-- rows are Steel Man's ('smr'). New columns only; no existing CHECK is
-- rebuilt. The 073 relationship guard keeps the column fixed after insert.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employer_relationship', 'employer_relationship_confirmation', 'resource_relationship', 'resource_relationship_event'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS provenance TEXT NOT NULL DEFAULT %L', t, 'smr');
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_provenance_known') THEN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (provenance IN (%L, %L))', t, t || '_provenance_known', 'smr', 'partner_staff');
      END IF;
    END IF;
  END LOOP;
END $$;

-- A row's provenance is fixed once written (review round 2): nobody turns a
-- program's call into Steel Man's own, or back.
CREATE OR REPLACE FUNCTION public.directory_provenance_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.provenance IS DISTINCT FROM OLD.provenance THEN
    RAISE EXCEPTION 'provenance is fixed once written' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.directory_provenance_fixed() FROM PUBLIC;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employer_relationship', 'employer_relationship_confirmation', 'resource_relationship', 'resource_relationship_event'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_provenance_fixed', t);
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.directory_provenance_fixed()', t || '_provenance_fixed', t);
    END IF;
  END LOOP;
END $$;

-- Where the data owner decides Tier 2 and R3: every documented contact, with
-- who made it. Owner-only (the app role holds nothing; read it with the owner
-- credential or neon-run, as the other tier views). Public views are
-- unchanged: Troy rules on public treatment.
DO $$
BEGIN
  IF to_regclass('public.employer_relationship_confirmation') IS NOT NULL AND to_regclass('public.resource_relationship_event') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW directory_contact_provenance_v WITH (security_barrier = true) AS
      SELECT 'employer'::text AS listing_kind, r.org_id AS listing_org_id, r.place_id, NULL::uuid AS service_id,
             r.id AS relationship_id, c.id AS contact_row_id, c.confirmed_on AS occurred_on, c.method,
             c.provenance, CASE c.provenance WHEN 'partner_staff' THEN 'partner staff call' ELSE 'Steel Man' END AS source_label,
             r.partner_org_id AS program_id, a.partner_name AS program_name
        FROM public.employer_relationship r
        JOIN public.employer_relationship_confirmation c ON c.relationship_id = r.id
        LEFT JOIN public.access_code a ON a.id = r.partner_org_id
      UNION ALL
      SELECT 'resource'::text, rr.org_id, NULL::uuid, e.service_id, rr.id, e.id, e.occurred_on, e.method,
             e.provenance, CASE e.provenance WHEN 'partner_staff' THEN 'partner staff call' ELSE 'Steel Man' END,
             CASE WHEN e.recorded_by ~ '^org:[0-9a-f-]{36}$' THEN substr(e.recorded_by, 5)::uuid END,
             (SELECT a2.partner_name FROM public.access_code a2 WHERE e.recorded_by = 'org:' || a2.id::text)
        FROM public.resource_relationship rr
        JOIN public.resource_relationship_event e ON e.relationship_id = rr.id
       WHERE e.kind IN ('confirmed', 'working')
         AND NOT EXISTS (SELECT 1 FROM public.resource_relationship_event_void v WHERE v.event_id = e.id)
    $v$;
    REVOKE ALL ON directory_contact_provenance_v FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
      REVOKE ALL ON directory_contact_provenance_v FROM smr_app;
    END IF;
  END IF;
END $$;

-- --------------------------------------------------------------- helpers --
CREATE OR REPLACE FUNCTION public.directory_contribution_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
$$;
REVOKE ALL ON FUNCTION public.directory_contribution_owner() FROM PUBLIC;

-- ---------------------------------------------------------------- intake --
CREATE OR REPLACE FUNCTION public.submit_directory_contribution(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me     uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org    uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_flow   text := p->>'flow';
  v_kind   text := p->>'target_kind';
  v_target uuid;
  v_on     date;
  v_method text := NULLIF(p->>'interaction_method', '');
  v_url    text := NULLIF(btrim(COALESCE(p->>'source_url', '')), '');
  v_note   text := NULLIF(btrim(COALESCE(p->>'private_note', '')), '');
  v_d      jsonb := COALESCE(p->'details', '{}'::jsonb);
  v_clean  jsonb := '{}'::jsonb;
  v_key    text;
  v_val    text;
  v_exists boolean;
  v_id     uuid;
BEGIN
  IF v_me IS NULL OR v_org IS NULL OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RAISE EXCEPTION 'only staff of an organization add to the directory, as themselves' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_flow IS NULL OR v_flow NOT IN ('new_place', 'correction', 'called_today', 'knows_someone')
     OR v_kind IS NULL OR v_kind NOT IN ('employer', 'resource') THEN
    RAISE EXCEPTION 'Invalid contribution' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(v_d) <> 'object' THEN
    RAISE EXCEPTION 'Invalid contribution' USING ERRCODE = 'check_violation';
  END IF;
  -- Keep only the public-safe fields, trimmed and capped. Anything else is dropped.
  FOREACH v_key IN ARRAY ARRAY['name', 'city', 'state', 'website', 'phone', 'change', 'said'] LOOP
    v_val := NULLIF(btrim(regexp_replace(COALESCE(v_d->>v_key, ''), '[[:cntrl:]]+', ' ', 'g')), '');
    IF v_val IS NOT NULL THEN
      IF v_key = 'state' AND v_val !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid contribution: state' USING ERRCODE = 'check_violation'; END IF;
      IF v_key = 'website' AND v_val !~ '^https?://' THEN RAISE EXCEPTION 'Invalid contribution: website' USING ERRCODE = 'check_violation'; END IF;
      v_clean := v_clean || jsonb_build_object(v_key, left(v_val, CASE WHEN v_key IN ('change', 'said') THEN 600 WHEN v_key = 'phone' THEN 30 ELSE 200 END));
    END IF;
  END LOOP;
  IF v_url IS NOT NULL AND (v_url !~ '^https?://' OR length(v_url) > 500) THEN
    RAISE EXCEPTION 'Invalid contribution: source' USING ERRCODE = 'check_violation';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Invalid contribution: note too long' USING ERRCODE = 'check_violation';
  END IF;
  IF p->>'target_id' IS NOT NULL AND p->>'target_id' <> '' THEN
    IF p->>'target_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid contribution: listing' USING ERRCODE = 'check_violation';
    END IF;
    v_target := (p->>'target_id')::uuid;
    v_exists := false;
    IF v_kind = 'employer' AND to_regclass('public.employer_org') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.employer_org WHERE id = $1)' INTO v_exists USING v_target;
    ELSIF v_kind = 'resource' AND to_regclass('public.resource_service') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.resource_service WHERE id = $1)' INTO v_exists USING v_target;
    END IF;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'That listing was not found' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF p->>'interaction_on' IS NOT NULL AND p->>'interaction_on' <> '' THEN
    IF p->>'interaction_on' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Invalid contribution: date' USING ERRCODE = 'check_violation';
    END IF;
    v_on := (p->>'interaction_on')::date;
    -- UTC days, as the app counts them (and as 073 dates contact events).
    IF v_on > (now() AT TIME ZONE 'UTC')::date OR v_on < (now() AT TIME ZONE 'UTC')::date - 30 THEN
      RAISE EXCEPTION 'The date has to be in the last 30 days' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_method IS NOT NULL AND v_method NOT IN ('phone_call', 'in_person', 'email_reply', 'site_visit', 'website', 'heard_from_someone') THEN
    RAISE EXCEPTION 'Invalid contribution: how' USING ERRCODE = 'check_violation';
  END IF;

  -- What each flow needs.
  IF v_flow = 'new_place' AND (v_target IS NOT NULL OR v_clean->>'name' IS NULL OR v_clean->>'state' IS NULL) THEN
    RAISE EXCEPTION 'A new place needs its name and state' USING ERRCODE = 'check_violation';
  ELSIF v_flow = 'correction' AND (v_target IS NULL OR v_clean->>'change' IS NULL) THEN
    RAISE EXCEPTION 'A correction needs the listing and what to change' USING ERRCODE = 'check_violation';
  ELSIF v_flow = 'called_today' AND (v_target IS NULL OR v_clean->>'said' IS NULL OR v_on IS NULL
                                     OR v_method IS NULL OR v_method NOT IN ('phone_call', 'in_person', 'email_reply', 'site_visit')) THEN
    RAISE EXCEPTION 'A call needs the listing, the date, how you reached them, and what they said' USING ERRCODE = 'check_violation';
  ELSIF v_flow = 'knows_someone' AND (v_kind <> 'employer' OR v_note IS NULL OR (v_target IS NULL AND v_clean->>'name' IS NULL)) THEN
    RAISE EXCEPTION 'Tell us the employer and, privately, who you know there' USING ERRCODE = 'check_violation';
  END IF;

  -- Same flow, same listing, same person, within a day: the earlier one stands.
  SELECT c.id INTO v_id FROM public.directory_contribution c
   WHERE c.access_code_id = v_org AND c.submitted_by = v_me AND c.flow = v_flow AND c.target_kind = v_kind
     AND c.target_id IS NOT DISTINCT FROM v_target AND c.status = 'received' AND c.created_at > now() - interval '1 day'
     AND (v_target IS NOT NULL OR lower(c.details->>'name') = lower(v_clean->>'name'))
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'earlier', true);
  END IF;

  IF (SELECT count(*) FROM public.directory_contribution c WHERE c.access_code_id = v_org AND c.submitted_by = v_me
        AND c.created_at > now() - interval '1 day') >= 20
     OR (SELECT count(*) FROM public.directory_contribution c WHERE c.access_code_id = v_org
        AND c.created_at > now() - interval '1 day') >= 60 THEN
    RAISE EXCEPTION 'That is the most we can take in one day. Thank you; try again tomorrow' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.directory_contribution (access_code_id, submitted_by, flow, target_kind, target_id, details,
      interaction_on, interaction_method, source_url, private_note, credit_org_ok, credit_person_ok)
  VALUES (v_org, v_me, v_flow, v_kind, v_target, v_clean, v_on, v_method, v_url,
      v_note,
      COALESCE((p->>'credit_org_ok')::boolean, true), COALESCE((p->>'credit_person_ok')::boolean, false))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'earlier', false);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_directory_contribution(jsonb) FROM PUBLIC;

-- Staff read back: their own submissions; the owner or an org admin of the
-- program also sees the program's. Status and the owner's short answer only:
-- never private_note, never the decider.
CREATE OR REPLACE FUNCTION public.my_directory_contributions()
RETURNS TABLE (id uuid, flow text, target_kind text, target_id uuid, name text, status text, outcome text,
               owner_answer text, interaction_on date, created_at timestamptz, decided_at timestamptz,
               recheck_on date, mine boolean, submitter_first_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  v_mgr boolean;
BEGIN
  IF v_me IS NULL OR v_org IS NULL OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RETURN;
  END IF;
  v_mgr := EXISTS (SELECT 1 FROM public.access_code a WHERE a.id = v_org AND a.partner_user_id = v_me)
        OR EXISTS (SELECT 1 FROM public.org_staff s WHERE s.access_code_id = v_org AND s.user_id = v_me AND s.role = 'org_admin');
  RETURN QUERY
    SELECT c.id, c.flow, c.target_kind, c.target_id, c.details->>'name', c.status, c.outcome, c.owner_answer,
           c.interaction_on, c.created_at, c.decided_at, c.recheck_on, c.submitted_by = v_me,
           NULLIF(split_part(btrim(COALESCE(u.name, '')), ' ', 1), '')
      FROM public.directory_contribution c
      LEFT JOIN public.users u ON u.id = c.submitted_by
     WHERE c.access_code_id = v_org AND (c.submitted_by = v_me OR v_mgr)
     ORDER BY c.created_at DESC
     LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.my_directory_contributions() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.withdraw_directory_contribution(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
  n int;
BEGIN
  IF v_me IS NULL OR v_org IS NULL THEN RETURN false; END IF;
  UPDATE public.directory_contribution SET status = 'withdrawn'
   WHERE id = p_id AND access_code_id = v_org AND submitted_by = v_me AND status IN ('received', 'needs_more');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_directory_contribution(uuid) FROM PUBLIC;

-- ---------------------------------------------------------- owner review --
-- The data owner's decision. Approve (with what it turned out to be), ask for
-- more, or not use; revert an approval within 30 days (credit comes back
-- off). Milestones are granted here, never before approval.
CREATE OR REPLACE FUNCTION public.decide_directory_contribution(p_id uuid, p_status text, p_outcome text, p_answer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  c     public.directory_contribution%ROWTYPE;
  v_answer text := NULLIF(btrim(COALESCE(p_answer, '')), '');
  v_credit int;
BEGIN
  IF NOT public.directory_contribution_owner() THEN
    RAISE EXCEPTION 'only the directory owner decides contributions' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('approved', 'needs_more', 'not_used') OR (v_answer IS NOT NULL AND length(v_answer) > 300) THEN
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM public.directory_contribution WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF c.submitted_by IS NOT DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Someone else reviews your own contribution' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF c.status = 'approved' THEN
    -- Only a revert: approved to not used, within 30 days, before any call was recorded.
    IF p_status <> 'not_used' OR c.decided_at < now() - interval '30 days' OR c.applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'An approval can only be reverted within 30 days, and not after the call was recorded' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.directory_contribution SET status = 'not_used', outcome = NULL, decided_by = v_me, decided_at = now(),
           owner_answer = COALESCE(v_answer, owner_answer), recheck_on = NULL
     WHERE id = p_id;
    IF c.submitted_by IS NOT NULL THEN
      PERFORM public.staff_milestone_revoke(c.submitted_by, c.access_code_id, c.id);
      -- Thresholds are earned by the running total, so a revert can drop
      -- the person below one another contribution reached: take that back too.
      SELECT COALESCE(sum(CASE x.outcome WHEN 'verified_call' THEN 3 WHEN 'warm_intro' THEN 3 WHEN 'correction' THEN 2 WHEN 'new_row' THEN 1 ELSE 0 END), 0)
        INTO v_credit FROM public.directory_contribution x
       WHERE x.access_code_id = c.access_code_id AND x.submitted_by = c.submitted_by AND x.status = 'approved';
      DELETE FROM public.staff_milestone m
       WHERE m.user_id = c.submitted_by AND m.access_code_id = c.access_code_id
         AND ((m.key = 'research_helper' AND v_credit < 3) OR (m.key = 'research_partner' AND v_credit < 10) OR (m.key = 'directory_anchor' AND v_credit < 25));
    END IF;
    RETURN true;
  END IF;
  IF c.status NOT IN ('received', 'needs_more') THEN
    RAISE EXCEPTION 'That contribution was already answered' USING ERRCODE = 'check_violation';
  END IF;

  IF p_status = 'approved' THEN
    UPDATE public.directory_contribution SET status = 'approved', outcome = p_outcome, owner_answer = v_answer,
           decided_by = v_me, decided_at = now(), recheck_on = COALESCE(c.interaction_on, current_date) + 365
     WHERE id = p_id;  -- the outcome CHECK refuses an outcome that does not fit the flow (and any hearsay "call")
    IF c.submitted_by IS NOT NULL THEN
      PERFORM public.staff_milestone_grant(c.submitted_by, c.access_code_id,
        CASE p_outcome WHEN 'verified_call' THEN 'first_verified_listing' WHEN 'warm_intro' THEN 'first_warm_intro'
                       WHEN 'correction' THEN 'first_correction' ELSE 'first_new_place' END, c.id);
      SELECT COALESCE(sum(CASE x.outcome WHEN 'verified_call' THEN 3 WHEN 'warm_intro' THEN 3 WHEN 'correction' THEN 2 WHEN 'new_row' THEN 1 ELSE 0 END), 0)
        INTO v_credit FROM public.directory_contribution x
       WHERE x.access_code_id = c.access_code_id AND x.submitted_by = c.submitted_by AND x.status = 'approved';
      IF v_credit >= 3 THEN PERFORM public.staff_milestone_grant(c.submitted_by, c.access_code_id, 'research_helper', c.id); END IF;
      IF v_credit >= 10 THEN PERFORM public.staff_milestone_grant(c.submitted_by, c.access_code_id, 'research_partner', c.id); END IF;
      IF v_credit >= 25 THEN PERFORM public.staff_milestone_grant(c.submitted_by, c.access_code_id, 'directory_anchor', c.id); END IF;
    END IF;
  ELSE
    UPDATE public.directory_contribution SET status = p_status, outcome = NULL, owner_answer = v_answer,
           decided_by = v_me, decided_at = now()
     WHERE id = p_id;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.decide_directory_contribution(uuid, text, text, text) FROM PUBLIC;

-- Record an approved live call as the documented interaction (073 / 061).
-- Resource: p_check_id is the service's live check the call confirmed.
-- Employer: p_place_id is the employer place the call was about (Tier 2 is
-- derived per place; without one the call is recorded company-wide).
-- Returns what it wrote.
CREATE OR REPLACE FUNCTION public.apply_contribution_call(p_id uuid, p_check_id uuid, p_place_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c        public.directory_contribution%ROWTYPE;
  v_method text;
  v_by     text;
  v_rel    uuid;
  v_rorg   uuid;
BEGIN
  IF NOT public.directory_contribution_owner() THEN
    RAISE EXCEPTION 'only the directory owner records a call' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM public.directory_contribution WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'approved' OR c.outcome IS DISTINCT FROM 'verified_call' OR c.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an approved, not yet recorded call can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  -- A visit is in person; nothing else but a call, a visit or their own email reply gets here (CHECKs).
  v_method := CASE c.interaction_method WHEN 'site_visit' THEN 'in_person' ELSE c.interaction_method END;
  IF v_method NOT IN ('phone_call', 'in_person', 'email_reply') THEN
    RAISE EXCEPTION 'Hearsay never confirms a listing' USING ERRCODE = 'check_violation';
  END IF;
  -- Never a person's name: the program is the source.
  v_by := 'org:' || c.access_code_id::text;

  IF c.target_kind = 'resource' THEN
    IF p_check_id IS NULL THEN
      RAISE EXCEPTION 'Name the live check this call confirmed' USING ERRCODE = 'check_violation';
    END IF;
    SELECT s.org_id INTO v_rorg FROM public.resource_service s WHERE s.id = c.target_id;
    IF v_rorg IS NULL THEN RAISE EXCEPTION 'That service was not found' USING ERRCODE = 'check_violation'; END IF;
    SELECT r.id INTO v_rel FROM public.resource_relationship r
     WHERE r.org_id = v_rorg AND r.service_id = c.target_id AND r.status = 'active' AND r.started_on <= c.interaction_on
       AND r.provenance = 'partner_staff'
     ORDER BY r.started_on LIMIT 1;
    IF v_rel IS NULL THEN
      INSERT INTO public.resource_relationship (org_id, service_id, started_on, note, provenance)
      VALUES (v_rorg, c.target_id, c.interaction_on, 'Staff contribution ' || c.id::text, 'partner_staff')
      RETURNING id INTO v_rel;
    END IF;
    -- The 073 guard checks the check is live and belongs to this service.
    INSERT INTO public.resource_relationship_event (relationship_id, service_id, check_id, kind, occurred_on, method, recorded_by, note, provenance)
    VALUES (v_rel, c.target_id, p_check_id, 'confirmed', c.interaction_on, v_method, v_by, 'Staff contribution ' || c.id::text, 'partner_staff');
    UPDATE public.directory_contribution SET applied_at = now() WHERE id = c.id;
    RETURN 'resource_confirmed';
  END IF;

  IF p_place_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employer_place p WHERE p.id = p_place_id AND p.org_id = c.target_id) THEN
    RAISE EXCEPTION 'That place is not this employer''s' USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.id INTO v_rel FROM public.employer_relationship r
   WHERE r.org_id = c.target_id AND r.avenue = 'partner_org' AND r.partner_org_id = c.access_code_id
     AND r.place_id IS NOT DISTINCT FROM p_place_id AND r.status = 'active' AND r.provenance = 'partner_staff'
   LIMIT 1;
  IF v_rel IS NULL THEN
    INSERT INTO public.employer_relationship (org_id, place_id, avenue, partner_org_id, started_on, note, provenance)
    VALUES (c.target_id, p_place_id, 'partner_org', c.access_code_id, c.interaction_on, 'Staff contribution ' || c.id::text, 'partner_staff')
    RETURNING id INTO v_rel;
  END IF;
  INSERT INTO public.employer_relationship_confirmation (org_id, relationship_id, confirmed_on, method, confirmed_by, note, provenance)
  VALUES (c.target_id, v_rel, c.interaction_on, v_method, v_by, 'Staff contribution ' || c.id::text, 'partner_staff');
  UPDATE public.directory_contribution SET applied_at = now() WHERE id = c.id;
  RETURN 'employer_confirmed';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_contribution_call(uuid, uuid, uuid) FROM PUBLIC;

-- ------------------------------------------------------------- the nudge --
CREATE OR REPLACE FUNCTION public.staff_listing_nudge_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_me  uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_org uuid := NULLIF(current_setting('app.org_id', true), '')::uuid;
BEGIN
  IF v_me IS NULL OR NEW.user_id IS DISTINCT FROM v_me OR NEW.access_code_id IS DISTINCT FROM v_org
     OR NOT public.staff_rewards_member(v_org, v_me) THEN
    RAISE EXCEPTION 'a nudge is yours, in your own organization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - 'shown_at') IS DISTINCT FROM (to_jsonb(OLD) - 'shown_at')) THEN
    RAISE EXCEPTION 'only the time a nudge was shown changes' USING ERRCODE = 'check_violation';
  END IF;
  NEW.shown_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_listing_nudge_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS staff_listing_nudge_guard ON staff_listing_nudge;
CREATE TRIGGER staff_listing_nudge_guard BEFORE INSERT OR UPDATE ON staff_listing_nudge
  FOR EACH ROW EXECUTE FUNCTION public.staff_listing_nudge_guard();

-- ------------------------------------------------------------------- RLS --
ALTER TABLE directory_contribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_contribution FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_listing_nudge ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_listing_nudge FORCE ROW LEVEL SECURITY;

-- The queue is the data owner's, like every directory table (061:723-736).
-- Staff reach their own rows only through the definer read-back above.
DROP POLICY IF EXISTS directory_contribution_admin_select ON directory_contribution;
CREATE POLICY directory_contribution_admin_select ON directory_contribution FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS staff_listing_nudge_own ON staff_listing_nudge;
CREATE POLICY staff_listing_nudge_own ON staff_listing_nudge FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- ---------------------------------------------------------------- grants --
REVOKE ALL ON directory_contribution, staff_listing_nudge FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON directory_contribution, staff_listing_nudge FROM smr_app;
    GRANT SELECT ON directory_contribution TO smr_app;
    GRANT SELECT, INSERT ON staff_listing_nudge TO smr_app;
    GRANT UPDATE (shown_at) ON staff_listing_nudge TO smr_app;
    GRANT EXECUTE ON FUNCTION public.submit_directory_contribution(jsonb) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.my_directory_contributions() TO smr_app;
    GRANT EXECUTE ON FUNCTION public.withdraw_directory_contribution(uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.decide_directory_contribution(uuid, text, text, text) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.apply_contribution_call(uuid, uuid, uuid) TO smr_app;
    GRANT EXECUTE ON FUNCTION public.directory_contribution_owner() TO smr_app;
  END IF;
END $$;

-- The answer reaches the person who sent the update (integration 2026-10-28; 109's inbox, kind
-- 'contribution_answered', widened by 111). The data owner decides with no org scope, so this writes the
-- item directly, while the sender is still on that organization's staff. Fixed words, no actor. Skips
-- where 109 is absent.
CREATE OR REPLACE FUNCTION public.directory_contribution_inbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_words text := CASE NEW.status WHEN 'approved' THEN 'your update to the directory was approved'
                                  WHEN 'needs_more' THEN 'the directory team asked for more on your update'
                                  ELSE 'your update to the directory was not used' END;
BEGIN
  IF to_regclass('public.staff_inbox_item') IS NULL OR NEW.submitted_by IS NULL THEN RETURN NULL; END IF;
  IF NOT public.staff_rewards_member(NEW.access_code_id, NEW.submitted_by) THEN RETURN NULL; END IF;
  INSERT INTO public.staff_inbox_item (access_code_id, recipient_user_id, kind, actor_user_id, participant_user_id, ref_table, ref_id, summary)
  VALUES (NEW.access_code_id, NEW.submitted_by, 'contribution_answered', NULL, NULL, 'directory_contribution', NEW.id, v_words)
  ON CONFLICT (recipient_user_id, kind, ref_id) WHERE read_at IS NULL
  DO UPDATE SET summary = EXCLUDED.summary, created_at = now();
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS directory_contribution_inbox ON directory_contribution;
CREATE TRIGGER directory_contribution_inbox AFTER UPDATE OF status ON directory_contribution
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'needs_more', 'not_used'))
  EXECUTE FUNCTION public.directory_contribution_inbox();
REVOKE ALL ON FUNCTION public.directory_contribution_inbox() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON FUNCTION public.directory_contribution_inbox() FROM smr_app;
  END IF;
END $$;

-- ------------------------------------------------------------ after-guards --
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directory_contribution', 'staff_listing_nudge'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '112: % must have row-level security enabled and forced', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directory_contribution' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '112: directory_contribution is written only through its definer functions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.staff_listing_nudge'::regclass AND tgname = 'staff_listing_nudge_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '112: the nudge guard is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.directory_contribution'::regclass AND tgname = 'directory_contribution_inbox' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '112: the answer inbox trigger is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    IF has_table_privilege('smr_app', 'public.directory_contribution', 'INSERT')
       OR has_table_privilege('smr_app', 'public.directory_contribution', 'UPDATE')
       OR has_table_privilege('smr_app', 'public.directory_contribution', 'DELETE') THEN
      RAISE EXCEPTION '112: smr_app must not write directory_contribution directly';
    END IF;
  END IF;
END $$;
