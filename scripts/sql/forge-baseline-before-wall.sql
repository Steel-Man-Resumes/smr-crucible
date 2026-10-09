-- Forge and Refinery baseline, BEFORE the Forge sign-in wall goes up.
--
-- READ ONLY. Runs inside a read-only transaction and ends with ROLLBACK, so it
-- cannot write even by mistake. Run it as a role that can read every row (the
-- owner role, not the row-level-security app role, which sees only its own
-- rows and would undercount). Save the output with the date it was run.
--
-- One row per week (weeks start Monday, UTC), the last 12 weeks, the current
-- week last and marked partial.
--
-- What each column is, and what it is not:
--
--   resume_uploads_read   Resumes uploaded to the Forge and read by the parser
--                         (ai_token_usage rows, endpoint 'parse'; one per
--                         successful read, signed in or not). The closest thing
--                         to "Forge starts" the database holds: a start in this
--                         browser with no upload (the guided builder) is not
--                         recorded anywhere on the server. A person who uploads
--                         twice counts twice. Rush uploads are included.
--   forge_builds          Forge runs that reached the build screen and finished
--                         the analysis (decision_log rows, context 'analyze').
--   forge_finishes        Forge runs that reached the finish page and got their
--                         documents written (decision_log rows, context
--                         'generate-docs': one per run; a reload reuses them).
--   rush_runs             Rush rewrites (decision_log, context 'rush-resume').
--   downloads             Word downloads from the Forge (ai_usage counter,
--                         endpoint 'forge-download'). ai_usage keeps 30 days
--                         only: weeks wholly before downloads_kept_from are
--                         blank (NULL), not zero, and the one week the window
--                         cuts through is marked downloads_full_week = false.
--   packages_emailed      "Email me my package" sends (ai_usage counter,
--                         endpoint 'email-package'); same 30-day window.
--   signed_in_forge_runs  Forge runs saved to an account (forge_session, by
--                         started_at). Before the wall most runs are anonymous
--                         and never appear here.
--   refinery_signups      Accounts first seen that week. users has no created
--                         column, so "first seen" is the earliest of: the
--                         registration consent event, the first sign-in event,
--                         the first device session, the profile row. Accounts
--                         made before those tables existed show at their first
--                         later sign-in, so the oldest weeks can run high.
--   test_account_signups  Of refinery_signups, accounts on test and example
--                         domains (left in the total; shown so they can be
--                         taken out).
--
-- Team test traffic with the live-test key is counted in the AI rows above
-- (it does not carry an account). Treat these as counts of activity, not of
-- people.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

WITH weeks AS (
  SELECT generate_series(
           date_trunc('week', now() AT TIME ZONE 'UTC') - interval '11 weeks',
           date_trunc('week', now() AT TIME ZONE 'UTC'),
           interval '1 week'
         ) AS week_start
),
uploads AS (
  SELECT date_trunc('week', created_at AT TIME ZONE 'UTC') AS week_start, count(*) AS n
    FROM ai_token_usage
   WHERE endpoint = 'parse'
     AND created_at >= (SELECT min(week_start) FROM weeks) AT TIME ZONE 'UTC'
   GROUP BY 1
),
decisions AS (
  SELECT date_trunc('week', ts AT TIME ZONE 'UTC') AS week_start,
         count(*) FILTER (WHERE context_page = 'analyze')       AS builds,
         count(*) FILTER (WHERE context_page = 'generate-docs') AS finishes,
         count(*) FILTER (WHERE context_page = 'rush-resume')   AS rush
    FROM decision_log
   WHERE context_page IN ('analyze', 'generate-docs', 'rush-resume')
     AND ts >= (SELECT min(week_start) FROM weeks) AT TIME ZONE 'UTC'
   GROUP BY 1
),
usage_counts AS (
  SELECT date_trunc('week', usage_date::timestamp) AS week_start,
         sum(call_count) FILTER (WHERE endpoint = 'forge-download') AS downloads,
         sum(call_count) FILTER (WHERE endpoint = 'email-package')  AS emailed
    FROM ai_usage
   WHERE endpoint IN ('forge-download', 'email-package')
   GROUP BY 1
),
usage_window AS (
  SELECT min(usage_date) AS kept_from FROM ai_usage
),
signed_in_runs AS (
  SELECT date_trunc('week', started_at AT TIME ZONE 'UTC') AS week_start, count(*) AS n
    FROM forge_session
   WHERE user_id IS NOT NULL
     AND started_at >= (SELECT min(week_start) FROM weeks) AT TIME ZONE 'UTC'
   GROUP BY 1
),
first_seen AS (
  SELECT u.id,
         lower(coalesce(u.email, '')) AS email,
         least(
           (SELECT min(e.created_at) FROM consumer_consent_event e
             WHERE e.user_id = u.id AND e.collection_method = 'registration'),
           (SELECT min(l.created_at) FROM user_login_event l
             WHERE l.user_id = u.id AND l.event = 'sign_in'),
           (SELECT min(s.created_at) FROM user_session s WHERE s.user_id = u.id),
           (SELECT p.created_at FROM consumer_profile p WHERE p.user_id = u.id)
         ) AS seen_at
    FROM users u
),
signups AS (
  SELECT date_trunc('week', seen_at AT TIME ZONE 'UTC') AS week_start,
         count(*) AS n,
         count(*) FILTER (
           WHERE email LIKE '%@steelman.dev'
              OR email LIKE '%@test.com'
              OR email LIKE '%@example.com'
              OR email LIKE '%@example.org'
              OR email LIKE '%@example.net'
         ) AS test_n
    FROM first_seen
   WHERE seen_at IS NOT NULL
   GROUP BY 1
)
SELECT w.week_start::date                                       AS week_start,
       (w.week_start = date_trunc('week', now() AT TIME ZONE 'UTC')) AS partial_week,
       coalesce(up.n, 0)                                        AS resume_uploads_read,
       coalesce(d.builds, 0)                                    AS forge_builds,
       coalesce(d.finishes, 0)                                  AS forge_finishes,
       coalesce(d.rush, 0)                                      AS rush_runs,
       CASE WHEN w.week_start::date + 6 >= uw.kept_from THEN coalesce(uc.downloads, 0) END AS downloads,
       CASE WHEN w.week_start::date + 6 >= uw.kept_from THEN coalesce(uc.emailed, 0) END   AS packages_emailed,
       (w.week_start::date >= uw.kept_from)                     AS downloads_full_week,
       uw.kept_from                                             AS downloads_kept_from,
       coalesce(sr.n, 0)                                        AS signed_in_forge_runs,
       coalesce(su.n, 0)                                        AS refinery_signups,
       coalesce(su.test_n, 0)                                   AS test_account_signups
  FROM weeks w
  CROSS JOIN usage_window uw
  LEFT JOIN uploads up        ON up.week_start = w.week_start
  LEFT JOIN decisions d       ON d.week_start = w.week_start
  LEFT JOIN usage_counts uc   ON uc.week_start = w.week_start
  LEFT JOIN signed_in_runs sr ON sr.week_start = w.week_start
  LEFT JOIN signups su        ON su.week_start = w.week_start
 ORDER BY w.week_start;

ROLLBACK;
