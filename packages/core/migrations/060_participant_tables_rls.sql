-- Row-level security on the participant's own work: their applications, their
-- resumes and letters and plans, their profile.
--
-- THE BASE TABLES BECOME OWNER-ONLY. The application role, scoped to an
-- organization, can no longer select a single row from them -- not a private
-- note, not a salary, not a disclosure plan. What staff and platform admins
-- legitimately need is served by VIEWS that name their columns and carry the
-- participant's side of every rule:
--
--   staff_shared_application   applications of a member of THIS org who shares
--                              'applications' with it (their choice, or a
--                              requirement they acknowledged), respecting
--                              "from today on" and "only my case manager".
--                              NO notes, salary, description or saved posting.
--   staff_shared_artifact      resumes (scope 'resume') and cover letters
--                              (scope 'documents') under the same rules. A
--                              disclosure plan or interview practice is not in
--                              this view at all, so no grant can reach one.
--   staff_progress_counts      counts and dates only, for members who have the
--                              long-standing "share my progress" switch on.
--   admin_job_application      platform admins: no content columns. The check is
--   admin_refinery_artifact    against platform_admin, a table the app cannot write.
--
-- A view runs with its OWNER'S rights, so it sees through the base tables'
-- policies; that is what makes it the only door. Each is a security_barrier so
-- a caller's own WHERE clause cannot be evaluated before the view's rules and
-- leak a row through a side effect.
--
-- WHAT THE DATABASE NOW GUARANTEES: no organization reads the work of someone
-- who did not share it, no organization reads another's, and nobody on staff
-- reads a private column, however the application is written. WHAT STAYS IN
-- THE APPLICATION: which colleague inside an organization may open a given
-- person (assignment, "sees everyone", capability denies). That is a rule about
-- staff, enforced in orgClientView.ts with the same predicate as before.
--
-- APPLY ONLY AFTER the code that reads these views is live.
-- ROLLBACK, no deploy (a SECURITY rollback; say so when you do it):
--   ALTER TABLE job_application   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE refinery_artifact DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE consumer_profile  DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW staff_shared_application WITH (security_barrier = true) AS
SELECT ja.id, ja.user_id, ja.job_title, ja.company, ja.location, ja.employment_type, ja.status,
       ja.status_updated_at, ja.applied_at, ja.follow_up_at, ja.hired_at, ja.apply_url,
       (ja.resume_artifact_id IS NOT NULL)       AS has_tailored_resume,
       (ja.cover_letter_artifact_id IS NOT NULL) AS has_cover_letter,
       ja.created_at, ja.updated_at
  FROM job_application ja
 WHERE EXISTS (SELECT 1 FROM access_code_redemption r
                WHERE r.user_id = ja.user_id
                  AND r.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
   AND EXISTS (SELECT 1 FROM sharing_grant g
                LEFT JOIN org_sharing_policy_version pv ON pv.id = g.policy_version_id
               WHERE g.user_id = ja.user_id
                 AND g.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
                 AND g.scope = 'applications' AND g.revoked_at IS NULL
                 AND ja.created_at >= COALESCE(g.covers_from, '-infinity'::timestamptz)
                 AND (pv.id IS NULL OR pv.audience = 'assigned_staff_and_admins'
                      OR EXISTS (SELECT 1 FROM client_staff_assignment a
                                  WHERE a.access_code_id = g.access_code_id AND a.client_user_id = g.user_id
                                    AND a.staff_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)));

CREATE OR REPLACE VIEW staff_shared_artifact WITH (security_barrier = true) AS
SELECT ra.id, ra.user_id, ra.artifact_type, ra.lane, ra.is_current, ra.is_locked,
       ra.target_context, ra.content, ra.created_at, ra.updated_at, ra.approved_at
  FROM refinery_artifact ra
 WHERE ra.artifact_type IN ('resume', 'cover_letter')
   AND EXISTS (SELECT 1 FROM access_code_redemption r
                WHERE r.user_id = ra.user_id
                  AND r.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
   AND EXISTS (SELECT 1 FROM sharing_grant g
                LEFT JOIN org_sharing_policy_version pv ON pv.id = g.policy_version_id
               WHERE g.user_id = ra.user_id
                 AND g.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
                 AND g.scope = CASE ra.artifact_type WHEN 'resume' THEN 'resume' ELSE 'documents' END
                 AND g.revoked_at IS NULL
                 AND ra.created_at >= COALESCE(g.covers_from, '-infinity'::timestamptz)
                 AND (pv.id IS NULL OR pv.audience = 'assigned_staff_and_admins'
                      OR EXISTS (SELECT 1 FROM client_staff_assignment a
                                  WHERE a.access_code_id = g.access_code_id AND a.client_user_id = g.user_id
                                    AND a.staff_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)));

CREATE OR REPLACE VIEW staff_progress_counts WITH (security_barrier = true) AS
SELECT r.user_id,
       (SELECT COUNT(*) FROM job_application ja WHERE ja.user_id = r.user_id AND ja.status <> 'saved')::int  AS applications,
       (SELECT COUNT(*) FROM job_application ja WHERE ja.user_id = r.user_id AND ja.status = 'saved')::int   AS saved_jobs,
       (SELECT COUNT(*) FROM refinery_artifact ra WHERE ra.user_id = r.user_id AND ra.artifact_type = 'interview_prep')::int AS practice_sessions,
       EXISTS (SELECT 1 FROM job_application ja WHERE ja.user_id = r.user_id AND ja.resume_artifact_id IS NOT NULL) AS has_resume_tailored,
       EXISTS (SELECT 1 FROM refinery_artifact ra WHERE ra.user_id = r.user_id AND ra.artifact_type = 'disclosure_plan') AS has_disclosure_plan,
       EXISTS (SELECT 1 FROM job_application ja WHERE ja.user_id = r.user_id AND (ja.status IN ('hired', 'started_work') OR ja.hired_at IS NOT NULL)) AS hired,
       (SELECT MAX(ja.updated_at) FROM job_application ja WHERE ja.user_id = r.user_id)   AS last_application_at,
       (SELECT MAX(ra.updated_at) FROM refinery_artifact ra WHERE ra.user_id = r.user_id) AS last_artifact_at
  FROM access_code_redemption r
 WHERE r.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM consumer_consent cc
                WHERE cc.user_id = r.user_id AND cc.consent_layer = 'sharing' AND cc.status = 'granted');

CREATE OR REPLACE VIEW admin_job_application WITH (security_barrier = true) AS
SELECT ja.id, ja.user_id, ja.status, ja.job_title, ja.company, ja.created_at, ja.updated_at, ja.hired_at
  FROM job_application ja
 WHERE EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE OR REPLACE VIEW admin_refinery_artifact WITH (security_barrier = true) AS
SELECT ra.id, ra.user_id, ra.artifact_type, ra.created_at
  FROM refinery_artifact ra
 WHERE EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT ON staff_shared_application, staff_shared_artifact, staff_progress_counts, admin_job_application, admin_refinery_artifact TO smr_app;
  END IF;
END $$;

-- A comment may only be made on a document the person SHARED. The policy used to
-- look at refinery_artifact directly, which an organization can no longer read.
DROP POLICY IF EXISTS staff_suggestion_insert ON staff_suggestion;
CREATE POLICY staff_suggestion_insert ON staff_suggestion FOR INSERT WITH CHECK (
  access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = staff_suggestion.client_user_id AND r.access_code_id = staff_suggestion.access_code_id)
  AND (artifact_id IS NULL OR EXISTS (SELECT 1 FROM staff_shared_artifact v WHERE v.id = staff_suggestion.artifact_id AND v.user_id = staff_suggestion.client_user_id)));

-- Owner only, per command, on all three.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_application', 'refinery_artifact', 'consumer_profile'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
                                                 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_delete', t);
  END LOOP;
END $$;

-- COUNTS ONLY, for the funnel report and the nightly tracking sync (a scheduled
-- job with nobody signed in, so it cannot present an admin identity). These
-- return seven integers and nothing about any person. p_code NULL = the whole
-- platform. They exist so that aggregate reporting does not need a way to read
-- rows.
CREATE OR REPLACE FUNCTION public.smr_funnel_counts(p_code text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (forge_sessions_started bigint, forge_sessions_completed bigint, refinery_users bigint,
               applications_logged bigint, interviews bigint, offers bigint, hires bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH people AS (
    SELECT DISTINCT acr.user_id FROM public.access_code ac JOIN public.access_code_redemption acr ON acr.access_code_id = ac.id
     WHERE p_code IS NOT NULL AND ac.code = p_code
  ), fs AS (
    SELECT f.id, f.status FROM public.forge_session f
     WHERE (p_code IS NULL OR f.user_id IN (SELECT user_id FROM people))
       AND (p_from IS NULL OR f.started_at >= p_from) AND (p_to IS NULL OR f.started_at <= p_to)
  ), ja AS (
    SELECT j.id, j.status FROM public.job_application j WHERE p_code IS NULL OR j.user_id IN (SELECT user_id FROM people)
  )
  SELECT (SELECT COUNT(*) FROM fs WHERE status IN ('in_progress', 'completed', 'abandoned')),
         (SELECT COUNT(*) FROM fs WHERE status = 'completed'),
         (SELECT COUNT(DISTINCT r.user_id) FROM public.refinery_artifact r WHERE p_code IS NULL OR r.user_id IN (SELECT user_id FROM people)),
         (SELECT COUNT(*) FROM ja),
         (SELECT COUNT(*) FROM ja WHERE status IN ('interviewing', 'heard_back', 'offered', 'hired', 'started_work')),
         (SELECT COUNT(*) FROM ja WHERE status IN ('offered', 'hired', 'started_work')),
         (SELECT COUNT(*) FROM ja WHERE status IN ('hired', 'started_work'))
$$;
REVOKE ALL ON FUNCTION public.smr_funnel_counts(text, timestamptz, timestamptz) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.smr_funnel_counts(text, timestamptz, timestamptz) TO smr_app;
  END IF;
END $$;
