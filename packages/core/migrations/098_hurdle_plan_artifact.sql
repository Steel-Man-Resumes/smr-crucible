-- 098_hurdle_plan_artifact.sql
-- A hurdle plan with no record section gets its own artifact type (fix for the
-- 2026-10-24 B5 regression).
--
-- WHY. The hurdle planner (Plan what to say) saved every plan as a
-- disclosure_plan, even a plan for transport or schedule only. That row became
-- the newest disclosure plan, so /api/user/context showed an empty script and
-- hid the person's record conversation plan from the day before. From this
-- release a plan without the record hurdle saves as 'hurdle_plan'. Only a plan
-- that includes the record conversation saves as 'disclosure_plan' (it still
-- stores no record content, per the B5 ruling).
--
-- WHAT THIS ADDS
--   refinery_artifact.artifact_type   one more value: 'hurdle_plan'.
--
-- ADD ONLY. Never narrows the CHECK (same widen helper as 076, 078, 095).
-- NO DATA CHANGE. Re-typing the rows saved on 2026-10-24 is a separate,
-- count-guarded owner data fix (todash smr/neon-runs/magnum-2026-10-24/), run
-- after this file.
-- LOCKS. One CHECK swap on refinery_artifact scans the table once under the
-- lock it takes. lock_timeout gives up after 5 seconds; re-run on timeout
-- (idempotent).
--
-- APPLY in ONE transaction BEFORE the code that writes 'hurdle_plan' deploys.
-- If the code ships first, a plan without the record hurdle fails the CHECK
-- and the planner shows "didn't save" with a retry (nothing is lost on screen).
-- Production apply waits for Troy.
--
-- ROLLBACK, in this order:
--   1. Revert the code and deploy that.
--   2. Optional, as the owner role, in one transaction:
--        UPDATE refinery_artifact SET artifact_type = 'disclosure_plan' WHERE artifact_type = 'hurdle_plan';
--        DELETE FROM _migrations WHERE filename = '098_hurdle_plan_artifact.sql';
--      Leave the widened CHECK in place. The UPDATE brings the regression
--      back; without it the old code simply does not list hurdle_plan rows
--      in the Library (they stay in the account and in the data export).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check(tbl regclass, col text, cname text, want text[])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
  have text[] := '{}';
  allv text[];
  n int := 0;
  pat text := '\(' || col || ' = ANY|' || col || ' IN';
BEGIN
  FOR c IN SELECT oid FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    have := have || ARRAY(SELECT replace(m[1], '''''', '''') FROM regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')*)''', 'g') m);
    n := n + 1;
  END LOOP;
  allv := ARRAY(SELECT DISTINCT v FROM unnest(have || want) v ORDER BY v);
  IF n = 1 AND have @> want THEN
    RETURN;
  END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I IN (%s))', tbl, cname, col,
                 (SELECT string_agg(quote_literal(v), ', ') FROM unnest(allv) v));
END
$fn$;

SELECT pg_temp.smr_widen_list_check('refinery_artifact', 'artifact_type', 'refinery_artifact_artifact_type_check', ARRAY[
  'resume', 'cover_letter', 'follow_up', 'disclosure_plan', 'interview_prep', 'resource_list', 'job_match',
  'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv', 'performer_resume', 'hurdle_plan']);
DROP FUNCTION pg_temp.smr_widen_list_check(regclass, text, text, text[]);
