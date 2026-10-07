-- 074_mark_demo_resumes.sql
-- Data migration: mark example and test resumes and letters as examples.
--
-- Demos and test runs left resumes for made-up people inside real accounts.
-- This marks them (is_demo = true) so the Refinery hides them behind "Show
-- examples". NOTHING IS DELETED, and nothing else on the row changes. A person
-- can bring one back with "Not an example".
--
-- HOW AN EXAMPLE IS RECOGNISED. Only by contact details that cannot belong to
-- a real person, because they are reserved for fiction and documentation:
--   * a US phone number 555-0100 through 555-0199 (set aside for fictional use);
--   * an email at example.com, example.org or example.net, or at any name under
--     the .test, .example or .invalid top-level names (reserved; no real inbox).
-- Every sample and persona in this codebase uses these. A real person's phone
-- or inbox cannot match. The one case that can: someone who typed a
-- placeholder address on purpose. Their resume is hidden, not lost, and comes
-- back with one tap.
--
-- MUST RUN AS THE OWNER ROLE. refinery_artifact has FORCE row-level security;
-- a role that cannot bypass it would update zero rows and report success. The
-- guard below refuses instead.
--
-- ROLLBACK: UPDATE refinery_artifact SET is_demo = false WHERE is_demo;
--   (before any person has used "Move to examples"; after that, restore from
--   the dry-run id list kept when this was applied).

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
     OR lower(COALESCE(content->'contact'->>'email', '')) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$'
     OR (artifact_type = 'cover_letter' AND (
            COALESCE(content->>'text', '') ~ '\m555[-. ]01[0-9]{2}\M'
         OR lower(COALESCE(content->>'text', '')) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))\M'
        ))
   );
