-- DRY RUN for 074_mark_demo_resumes.sql. READ ONLY: counts only, no names,
-- no contact details, no content. Not a migration (this folder is not read by
-- the migration runner). Run as the owner role (FORCE row-level security
-- hides every row from the app role).
--
-- One row per (owner_is_demo_account, artifact_type):
--   owner_is_demo_account = false  -> rows 074 WILL mark (samples inside real
--                                     people's accounts). Look at this count
--                                     before applying anywhere real.
--   owner_is_demo_account = true   -> rows 074 SKIPS (demo cohort and persona
--                                     accounts keep their resumes visible).
-- The predicate below is 074's, word for word, without the account clause.

BEGIN TRANSACTION READ ONLY;

SELECT (btrim(lower(COALESCE(u.email, ''))) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$') AS owner_is_demo_account,
       ra.artifact_type,
       count(*) AS rows,
       count(DISTINCT ra.user_id) AS accounts
  FROM refinery_artifact ra
  JOIN users u ON u.id = ra.user_id
 WHERE ra.is_demo = false
   AND ra.artifact_type IN ('resume', 'cover_letter')
   AND (
        regexp_replace(COALESCE(ra.content->'contact'->>'phone', ''), '[^0-9]', '', 'g') ~ '^1?[0-9]{3}55501[0-9]{2}$'
     OR btrim(lower(COALESCE(ra.content->'contact'->>'email', ''))) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$'
     OR (ra.artifact_type = 'cover_letter' AND (
            COALESCE(ra.content->>'text', '') ~ '\m555[-. ]01[0-9]{2}\M'
         OR lower(COALESCE(ra.content->>'text', '')) ~ '@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))(?![a-z0-9-]|\.[a-z0-9])'
        ))
   )
 GROUP BY 1, 2
 ORDER BY 1, 2;

ROLLBACK;
