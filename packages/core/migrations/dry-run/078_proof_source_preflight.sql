-- 078_proof_source_preflight.sql
-- READ-ONLY. Makes no writes. Run on preview and on production BEFORE 078.
--
-- 078 part 3 marks an account's email proof as 'recorded' only when 068's
-- ledger time is a real backfill instant (security review 3a Part 2 r2, N1).
-- This shows which case this database is in, and how many accounts 078 would
-- mark. Counts and timestamps only: no names, no addresses.
--
-- Read it like this:
--   ledger_is_backfill_instant = true   078 will mark `would_mark` accounts;
--                                        `at_backfill_instant` should equal the
--                                        number of accounts that existed at 068
--                                        (41 on production, 5 on preview), and
--                                        `most_common_instant` should equal
--                                        `applied_at`.
--   ledger_is_backfill_instant = false  078 marks nobody (fail-safe): every
--                                        account is asked to confirm once.
--   no row / applied_at missing          078 marks nobody.
-- Stop and ask before applying 078 if `would_mark` looks larger than the
-- number of people who signed in by email link or Google since 068.
--
-- If _migrations has no applied_at column, this file fails on purpose
-- (column does not exist): then 078 marks nobody, and nothing needs checking.

SELECT m.filename,
       m.applied_at,
       pg_typeof(m.applied_at)::text AS applied_at_type,
       (SELECT count(*) FROM users) AS accounts_now,
       (SELECT count(*) FROM users WHERE email_proven_at IS NOT NULL) AS proven_at_set,
       (SELECT count(*) FROM users WHERE email_proven_at = m.applied_at) AS at_backfill_instant,
       EXISTS (SELECT 1 FROM users WHERE email_proven_at = m.applied_at) AS ledger_is_backfill_instant,
       (SELECT email_proven_at FROM users WHERE email_proven_at IS NOT NULL
         GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) AS most_common_instant,
       (SELECT count(*) FROM users WHERE email_proven_at IS NOT NULL
         GROUP BY email_proven_at ORDER BY count(*) DESC LIMIT 1) AS most_common_instant_count,
       CASE WHEN EXISTS (SELECT 1 FROM users WHERE email_proven_at = m.applied_at)
            THEN (SELECT count(*) FROM users WHERE email_proven_at > m.applied_at + interval '1 minute')
            ELSE 0 END AS would_mark
  FROM _migrations m
 WHERE m.filename = '068_email_proven.sql';
