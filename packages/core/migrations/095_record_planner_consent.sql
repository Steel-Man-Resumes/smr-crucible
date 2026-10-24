-- 095_record_planner_consent.sql
-- The hurdle planner's own yes for record answers (Plan what to say, 2026-10-23).
--
-- WHAT THIS ADDS
--   consumer_consent / consumer_consent_event   one more consent layer value,
--                         'record_planner'. Granted only by the person on the
--                         planner screen ("Yes, use an AI service for this"),
--                         with a text version. Default is declined
--                         (consentDefaultFor in consent.ts). The wording route
--                         and practice refuse record answers unless this row is
--                         granted at the current text version.
--
-- WHAT IS NOT STORED. No record answer and no record sentence is stored
-- anywhere by the planner. This file only widens two CHECK lists.
--
-- ADD ONLY. Never narrows a CHECK (same widen helper as 076 and 080).
-- LOCKS. Small tables; lock_timeout 5s; idempotent, re-run on timeout.
-- APPLY in ONE transaction BEFORE the code that grants the layer deploys
-- (a grant before this runs fails the CHECK and the screen shows the error).
-- Production apply waits for Troy.
--
-- ROLLBACK, in this order:
--   1. Revert the planner code and deploy that.
--   2. As the owner role, in one transaction:
--        DELETE FROM consumer_consent_event WHERE consent_layer = 'record_planner';
--        DELETE FROM consumer_consent WHERE consent_layer = 'record_planner';
--        DELETE FROM _migrations WHERE filename = '095_record_planner_consent.sql';
--      (Leave the widened CHECKs in place.)

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

SELECT pg_temp.smr_widen_list_check('consumer_consent', 'consent_layer', 'consumer_consent_consent_layer_check',
  ARRAY['core', 'enhanced', 'research', 'sharing', 'outcome_anonymous', 'outcome_named',
        'disclosure_transcript', 'interview_transcript', 'record_check', 'record_planner']);
SELECT pg_temp.smr_widen_list_check('consumer_consent_event', 'consent_layer', 'consumer_consent_event_consent_layer_check',
  ARRAY['core', 'enhanced', 'research', 'sharing', 'outcome_anonymous', 'outcome_named',
        'disclosure_transcript', 'interview_transcript', 'record_check', 'record_planner']);
DROP FUNCTION pg_temp.smr_widen_list_check(regclass, text, text, text[]);
