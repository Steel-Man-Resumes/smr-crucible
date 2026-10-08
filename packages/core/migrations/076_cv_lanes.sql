-- 076_cv_lanes.sql
-- CV lanes (slice 2 of the creative and CV build).
--
-- WHAT THIS ADDS
--   career_lane.kind       one more value: 'cv' (resume | creative | cv).
--   career_lane.cv_type    the CV sub-type, which sets the section order and
--                          the length rule: 'academic' (also research),
--                          'teaching', 'clinical', 'international'. Required on
--                          a CV lane, NULL on every other lane.
--   practice_entry.section more record entry kinds a CV reads: research,
--                          presentation, clinical (rotations), license
--                          (licensure and certification), service,
--                          appointment (appointments and employment),
--                          membership, reference.
--   refinery_artifact type 'cv' (a dated copy of a CV, written only through
--                          the creative document routes like the others).
--
-- ONE SET OF FACTS. A CV is assembled from the same practice record every
-- other lane reads. No fact is stored per lane. The lane keeps choices only.
--
-- OWNERSHIP. No new table. practice_entry and career_lane keep their forced,
-- owner-only row-level security from 073 and 075 unchanged.
--
-- POSTGRES 15 OR LATER, as for 075.
--
-- LOCKS. Each CHECK swap scans its table once under the lock it takes; the
-- new column is a metadata change. lock_timeout gives up after 5 seconds
-- instead of queueing requests behind a long query. If it times out, run it
-- again: every statement is idempotent.
--
-- APPLY: in ONE transaction (psql -1 -v ON_ERROR_STOP=1 -f 076_cv_lanes.sql,
-- or the runner's BEGIN): SET LOCAL lock_timeout only holds inside one.
-- Apply 075 first. Re-running either file later never narrows a list.
--
-- ROLLBACK, in this order:
--   1. Revert the CV lane CODE first and deploy that (it reads cv_type, the
--      new sections and the 'cv' type).
--   2. Rolling back LOSES every CV lane and every record entry of the new
--      kinds. Export first if anyone has used them.
--   3. Then, as the owner role, in one transaction:
--        UPDATE refinery_artifact SET lane_id = NULL WHERE lane_id IN (SELECT id FROM career_lane WHERE kind = 'cv');
--        DELETE FROM refinery_artifact WHERE artifact_type = 'cv';
--        DELETE FROM practice_entry WHERE section IN ('research', 'presentation',
--          'clinical', 'license', 'service', 'appointment', 'membership', 'reference');
--        DELETE FROM career_lane WHERE kind = 'cv';
--        ALTER TABLE career_lane DROP CONSTRAINT IF EXISTS career_lane_cv_type_shape;
--        ALTER TABLE career_lane DROP COLUMN IF EXISTS cv_type;
--        ALTER TABLE career_lane DROP CONSTRAINT IF EXISTS career_lane_kind_check;
--        ALTER TABLE career_lane ADD CONSTRAINT career_lane_kind_check CHECK (kind IN ('resume', 'creative'));
--        ALTER TABLE practice_entry DROP CONSTRAINT IF EXISTS practice_entry_section_check;
--        ALTER TABLE practice_entry ADD CONSTRAINT practice_entry_section_check CHECK (section IN (
--          'exhibition', 'performance', 'residency', 'commission', 'publication', 'press',
--          'collection', 'teaching', 'arts_program', 'award', 'education', 'work'));
--        ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_artifact_type_check;
--        ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_artifact_type_check
--          CHECK (artifact_type IN ('resume', 'cover_letter', 'follow_up', 'disclosure_plan',
--            'interview_prep', 'resource_list', 'job_match',
--            'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list'));
--        DELETE FROM _migrations WHERE filename = '076_cv_lanes.sql';

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------- lanes --

-- Widen a "column IN (list)" CHECK without ever narrowing it: read the
-- values every matching CHECK allows now, union them with this file's list,
-- and put back exactly one CHECK under the known name. Re-running an older
-- file after a newer one keeps the newer values (an unknown value is still
-- refused). Session-temporary: dropped again at the end of this file.
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
    have := have || ARRAY(SELECT m[1] FROM regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m);
    n := n + 1;
  END LOOP;
  allv := ARRAY(SELECT DISTINCT v FROM unnest(have || want) v ORDER BY v);
  IF n = 1 AND have @> want THEN
    RETURN; -- already allows every wanted value: change nothing
  END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I IN (%s))', tbl, cname, col,
                 (SELECT string_agg(quote_literal(v), ', ') FROM unnest(allv) v));
END
$fn$;

-- Never narrows (see the function above).
SELECT pg_temp.smr_widen_list_check('career_lane', 'kind', 'career_lane_kind_check', ARRAY['resume', 'creative', 'cv']);

ALTER TABLE career_lane ADD COLUMN IF NOT EXISTS cv_type TEXT;

DO $$
BEGIN
  -- A CV lane always has a sub-type; no other lane has one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'career_lane_cv_type_shape') THEN
    ALTER TABLE career_lane ADD CONSTRAINT career_lane_cv_type_shape
      -- cv_type IS NOT NULL is spelled out: NULL IN (...) is unknown, and a
      -- CHECK lets unknown through.
      CHECK ((kind = 'cv' AND cv_type IS NOT NULL AND cv_type IN ('academic', 'teaching', 'clinical', 'international'))
          OR (kind <> 'cv' AND cv_type IS NULL));
  END IF;
END $$;

-- ------------------------------------------------------ practice record --
SELECT pg_temp.smr_widen_list_check('practice_entry', 'section', 'practice_entry_section_check', ARRAY[
  'exhibition', 'performance', 'residency', 'commission', 'publication', 'press',
  'collection', 'teaching', 'arts_program', 'award', 'education', 'work',
  'research', 'presentation', 'clinical', 'license', 'service', 'appointment',
  'membership', 'reference']);

-- ------------------------------------------------- artifact type values --
SELECT pg_temp.smr_widen_list_check('refinery_artifact', 'artifact_type', 'refinery_artifact_artifact_type_check', ARRAY[
  'resume', 'cover_letter', 'follow_up', 'disclosure_plan', 'interview_prep', 'resource_list', 'job_match',
  'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv']);

DROP FUNCTION pg_temp.smr_widen_list_check(regclass, text, text, text[]);
