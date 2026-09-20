-- Outcomes and retention: what happened after "hired", and how we know.
--
-- A participant marking a job "hired" in their own tracker is THEIR record and
-- stays theirs. This is the ORGANIZATION'S record: a placement a staff member
-- entered, with an honest statement of how they know. "staff_verified" on its
-- own proves little, so a verified record must say by what method and when --
-- the database refuses one that does not. Wage and hours are optional and are
-- never required to record that someone is working.
--
-- Retention is asked at 30, 60, 90 and 180 days, and "unknown" is a real
-- answer: a program that could not reach someone has not retained them and has
-- not lost them, and a report that folds unknowns into either is wrong.
--
-- Never deleted by the app. A wrong record is ended or corrected, on the record.
CREATE TABLE IF NOT EXISTS outcome_record (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id      UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  client_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employer            TEXT NOT NULL CHECK (length(btrim(employer)) BETWEEN 2 AND 200),
  job_title           TEXT CHECK (job_title IS NULL OR length(job_title) <= 200),
  start_date          DATE NOT NULL,
  hourly_wage         NUMERIC(7,2) CHECK (hourly_wage IS NULL OR hourly_wage BETWEEN 0 AND 500),
  hours_per_week      NUMERIC(4,1) CHECK (hours_per_week IS NULL OR hours_per_week BETWEEN 0 AND 100),
  -- How the organization knows. In rising order of strength.
  source              TEXT NOT NULL CHECK (source IN ('participant_reported', 'staff_reported', 'staff_verified')),
  verification_method TEXT CHECK (verification_method IS NULL OR verification_method IN ('employer_confirmed', 'pay_stub_seen', 'offer_letter_seen', 'work_site_visit', 'other_document')),
  verified_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,
  ended_on            DATE,
  end_reason          TEXT CHECK (end_reason IS NULL OR end_reason IN ('left_for_better_job', 'left_other', 'laid_off', 'let_go', 'seasonal_ended', 'entered_in_error', 'unknown')),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "Verified" without saying how, by whom and when is not verified.
  CHECK (source <> 'staff_verified' OR (verification_method IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (ended_on IS NULL OR ended_on >= start_date)
);
CREATE INDEX IF NOT EXISTS outcome_record_org ON outcome_record (access_code_id, client_user_id);

CREATE TABLE IF NOT EXISTS retention_check (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_id     UUID NOT NULL REFERENCES outcome_record(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  day_mark       INTEGER NOT NULL CHECK (day_mark IN (30, 60, 90, 180)),
  status         TEXT NOT NULL CHECK (status IN ('employed', 'not_employed', 'unknown')),
  method         TEXT NOT NULL CHECK (method IN ('participant_told_me', 'employer_confirmed', 'pay_stub_seen', 'could_not_reach')),
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),
  checked_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (outcome_id, day_mark),
  -- "Could not reach" is the method of an unknown, and only of an unknown.
  CHECK ((status = 'unknown') = (method = 'could_not_reach'))
);

CREATE OR REPLACE FUNCTION public.outcome_record_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.access_code_id IS DISTINCT FROM OLD.access_code_id OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'an outcome cannot be moved to another person or organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS outcome_record_guard ON outcome_record;
CREATE TRIGGER outcome_record_guard BEFORE UPDATE ON outcome_record FOR EACH ROW EXECUTE FUNCTION public.outcome_record_guard();

ALTER TABLE outcome_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_record FORCE ROW LEVEL SECURITY;
ALTER TABLE retention_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_check FORCE ROW LEVEL SECURITY;

-- The organization's record, and the person it is about may read it: nobody
-- should have a placement on file about them that they cannot see.
DROP POLICY IF EXISTS outcome_select ON outcome_record;
CREATE POLICY outcome_select ON outcome_record FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DROP POLICY IF EXISTS outcome_insert ON outcome_record;
CREATE POLICY outcome_insert ON outcome_record FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = outcome_record.client_user_id AND r.access_code_id = outcome_record.access_code_id));
DROP POLICY IF EXISTS outcome_update ON outcome_record;
CREATE POLICY outcome_update ON outcome_record FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

DROP POLICY IF EXISTS retention_select ON retention_check;
CREATE POLICY retention_select ON retention_check FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR EXISTS (SELECT 1 FROM outcome_record o WHERE o.id = retention_check.outcome_id
              AND o.client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS retention_insert ON retention_check;
CREATE POLICY retention_insert ON retention_check FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND checked_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM outcome_record o WHERE o.id = retention_check.outcome_id AND o.access_code_id = retention_check.access_code_id));

CREATE OR REPLACE FUNCTION public.smr_delegable_capabilities() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT ARRAY['org.client.view_all', 'org.client.view_content', 'org.client.request_sharing',
               'org.client.assign', 'org.note.write', 'org.task.write', 'org.outcome.write', 'org.participant.invite',
               'org.export', 'org.seats.view', 'org.costs.view', 'org.insights.view']::text[]
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON outcome_record, retention_check FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON outcome_record TO smr_app;
    GRANT SELECT, INSERT ON retention_check TO smr_app;
  END IF;
END $$;
