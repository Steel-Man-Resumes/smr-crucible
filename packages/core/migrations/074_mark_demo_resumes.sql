-- 074_mark_demo_resumes.sql
-- Data migration: mark example and test resumes and letters as examples.
--
-- Demos and test runs left resumes for made-up people inside real accounts.
-- This marks them (is_demo = true) so the Refinery hides them behind "Show
-- examples". NOTHING IS DELETED, and nothing else on the row changes. A person
-- can bring one back with "Not an example".
--
-- HOW AN EXAMPLE IS RECOGNISED. Only by contact details reserved for fiction
-- and documentation:
--   * a US phone number 555-0100 through 555-0199 (set aside for fictional use);
--   * an email at example.com, example.org or example.net, or at any name under
--     the .test, .example or .invalid top-level names (reserved; no real inbox).
-- Every sample and persona in this codebase uses these. In a letter's text the
-- address must END at the reserved name (jane@hr.test.com is a real domain and
-- is left alone). The same rule lives in core/src/careerLaneShared.ts and the
-- tests check the two agree. The one real-person case that can match: someone
-- who typed a placeholder address on purpose. Their resume is hidden, not
-- lost, and comes back with one tap.
--
-- COUNT FIRST. migrations/dry-run/074_mark_demo_resumes_count.sql returns
-- counts only (no names, no content). Run it before applying, and keep the
-- marked id list afterwards (SELECT id FROM refinery_artifact WHERE is_demo)
-- as the rollback record.
--
-- MUST RUN AS THE OWNER ROLE. refinery_artifact has FORCE row-level security;
-- a role that cannot bypass it would update zero rows and report success. The
-- guard below refuses instead.
--
-- ROLLBACK: UPDATE refinery_artifact SET is_demo = false WHERE id IN (<the kept id list>);

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION '074 must run as the owner role; as % row-level security would hide every row and nothing would be marked', current_user;
  END IF;
END $$;

UPDATE refinery_artifact
   SET is_demo = true
 WHERE is_demo = false
   AND artifact_type IN ('resume', 'cover_letter')
   AND (
        regexp_replace(COALESCE(content->'contact'->>'phone', ''), '[^0-9]', '', 'g') ~ '^1?[0-9]{3}55501[0-9]{2}$'
     OR btrim(lower(COALESCE(content->'contact'->>'email', ''))) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$'
     OR (artifact_type = 'cover_letter' AND (
            COALESCE(content->>'text', '') ~ '\m555[-. ]01[0-9]{2}\M'
         OR lower(COALESCE(content->>'text', '')) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))(?![a-z0-9-]|\.[a-z0-9])'
        ))
   )
   -- DEMO ACCOUNTS ARE LEFT ALONE (pending Troy's decision; drop this clause
   -- if he decides demo accounts should start with everything under "Show
   -- examples"). An account whose own sign-in email is itself a reserved
   -- example address (the demo cohort, the personas) exists to show its
   -- resumes, so they stay visible there. "Examples" here means samples left
   -- inside a real person's account.
   AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = refinery_artifact.user_id
           AND btrim(lower(COALESCE(u.email, ''))) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$'
   );
