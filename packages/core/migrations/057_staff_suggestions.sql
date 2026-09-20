-- Staff help that the participant decides about: a job worth a look, or a
-- comment on a resume or letter they shared.
--
-- THE RULE THIS TABLE EXISTS TO KEEP: staff never write into a participant's
-- own work. A suggested job is NOT a saved job until the participant saves it,
-- with their own session, through the same path as any job they found
-- themselves. A comment sits BESIDE a document; it never edits it. The
-- participant answers (saved / dismissed), through a function, and that is all
-- they can do to a suggestion. Staff can withdraw one. Nothing is deleted.
CREATE TABLE IF NOT EXISTS staff_suggestion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES access_code(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('job', 'comment')),
  -- kind = 'job'
  job_title      TEXT CHECK (job_title IS NULL OR length(job_title) <= 200),
  company        TEXT CHECK (company IS NULL OR length(company) <= 200),
  location       TEXT CHECK (location IS NULL OR length(location) <= 200),
  -- https only: this becomes a link a participant is invited to click.
  apply_url      TEXT CHECK (apply_url IS NULL OR (apply_url ~ '^https://[^\s]+$' AND length(apply_url) <= 1000)),
  -- kind = 'comment': which shared document, and optionally the words it is about.
  artifact_id    UUID REFERENCES refinery_artifact(id) ON DELETE CASCADE,
  quote          TEXT CHECK (quote IS NULL OR length(quote) <= 500),
  -- Why (job) or the comment itself. The participant reads it under the author's name.
  body           TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 3 AND 1500),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'saved', 'dismissed', 'withdrawn')),
  responded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'job' AND job_title IS NOT NULL AND company IS NOT NULL AND artifact_id IS NULL)
      OR (kind = 'comment' AND artifact_id IS NOT NULL AND job_title IS NULL))
);
CREATE INDEX IF NOT EXISTS staff_suggestion_client ON staff_suggestion (client_user_id, status);

CREATE OR REPLACE FUNCTION public.staff_suggestion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
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
DROP TRIGGER IF EXISTS staff_suggestion_guard ON staff_suggestion;
CREATE TRIGGER staff_suggestion_guard BEFORE UPDATE ON staff_suggestion FOR EACH ROW EXECUTE FUNCTION public.staff_suggestion_guard();

ALTER TABLE staff_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_suggestion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_suggestion_select ON staff_suggestion;
CREATE POLICY staff_suggestion_select ON staff_suggestion FOR SELECT USING (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  OR (status <> 'withdrawn' AND client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS staff_suggestion_insert ON staff_suggestion;
CREATE POLICY staff_suggestion_insert ON staff_suggestion FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = staff_suggestion.client_user_id AND r.access_code_id = staff_suggestion.access_code_id)
  -- A comment must be about a document that belongs to that participant.
  AND (artifact_id IS NULL OR EXISTS (SELECT 1 FROM refinery_artifact ra WHERE ra.id = staff_suggestion.artifact_id AND ra.user_id = staff_suggestion.client_user_id)));
DROP POLICY IF EXISTS staff_suggestion_update ON staff_suggestion;
CREATE POLICY staff_suggestion_update ON staff_suggestion FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         OR (client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND NULLIF(current_setting('app.org_id', true), '') IS NULL))
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         OR client_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION public.smr_delegable_capabilities() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT ARRAY['org.client.view_all', 'org.client.view_content', 'org.client.request_sharing',
               'org.client.assign', 'org.note.write', 'org.task.write', 'org.outcome.write', 'org.suggest.write',
               'org.participant.invite', 'org.export', 'org.seats.view', 'org.costs.view', 'org.insights.view']::text[]
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON staff_suggestion FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON staff_suggestion TO smr_app;
  END IF;
END $$;
