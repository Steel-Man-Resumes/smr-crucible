-- 077_performer_lanes.sql
-- Performer lanes (slice 3 of the creative and CV build).
--
-- WHAT THIS ADDS
--   career_lane.kind       one more value: 'performer' (resume | creative | cv |
--                          performer). A performer lane makes one page: credits
--                          by medium in three columns, training, awards and
--                          confirmed special skills, on 8x10 and US Letter.
--   practice_entry.section three more record entry kinds: credit (a role in a
--                          production: medium, role and billing as credited,
--                          company, director if stated), training (where, with
--                          whom, how long) and union (union name and status as
--                          held: member, eligible or membership candidate).
--   refinery_artifact type 'performer_resume' (a dated copy, written only
--                          through the creative document routes).
--
-- YEARS (decision C2). Every credit carries a year in the record (year is NOT
-- NULL for every entry since 075). The page hides credit years by default;
-- the person can turn them on per lane. Training stays dated.
--
-- ONE SET OF FACTS. The performer page is assembled from the same practice
-- record every other lane reads. The lane keeps choices only (which credits,
-- years on or off, how a title that names a facility shows) and the lines
-- typed for the top of the page.
--
-- OWNERSHIP. No new table. practice_entry and career_lane keep their forced,
-- owner-only row-level security from 073 and 075 unchanged.
--
-- POSTGRES 15 OR LATER, as for 075.
--
-- LOCKS. Each CHECK swap scans its table once under the lock it takes.
-- lock_timeout gives up after 5 seconds instead of queueing requests behind a
-- long query. If it times out, run it again: every statement is idempotent.
--
-- APPLY: in ONE transaction (psql -1 -v ON_ERROR_STOP=1 -f 077_performer_lanes.sql,
-- or the runner's BEGIN): SET LOCAL lock_timeout only holds inside one.
-- Apply 075 and 076 first. Re-running any of them later never narrows a list.
--
-- ROLLBACK, in this order:
--   1. Revert the performer lane CODE first and deploy that (it reads the
--      new sections, the 'performer' kind and the new type).
--   2. Rolling back LOSES every performer lane and every credit, training and
--      union entry. Export first if anyone has used them.
--   3. Then, as the owner role, in one transaction (the first line makes the
--      pair check run at once, so deleting a paired lane leaves no pending
--      trigger event to block the ALTER TABLE lines):
--        SET CONSTRAINTS career_lane_pair_symmetric IMMEDIATE;
--        UPDATE refinery_artifact SET lane_id = NULL WHERE lane_id IN (SELECT id FROM career_lane WHERE kind = 'performer');
--        DELETE FROM refinery_artifact WHERE artifact_type = 'performer_resume';
--        DELETE FROM practice_entry WHERE section IN ('credit', 'training', 'union');
--        DELETE FROM career_lane WHERE kind = 'performer';
--        ALTER TABLE career_lane DROP CONSTRAINT IF EXISTS career_lane_kind_check;
--        ALTER TABLE career_lane ADD CONSTRAINT career_lane_kind_check CHECK (kind IN ('resume', 'creative', 'cv'));
--        ALTER TABLE practice_entry DROP CONSTRAINT IF EXISTS practice_entry_section_check;
--        ALTER TABLE practice_entry ADD CONSTRAINT practice_entry_section_check CHECK (section IN (
--          'exhibition', 'performance', 'residency', 'commission', 'publication', 'press',
--          'collection', 'teaching', 'arts_program', 'award', 'education', 'work',
--          'research', 'presentation', 'clinical', 'license', 'service', 'appointment',
--          'membership', 'reference'));
--        ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_artifact_type_check;
--        ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_artifact_type_check
--          CHECK (artifact_type IN ('resume', 'cover_letter', 'follow_up', 'disclosure_plan',
--            'interview_prep', 'resource_list', 'job_match',
--            'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv'));
--        DELETE FROM _migrations WHERE filename = '077_performer_lanes.sql';

SET LOCAL lock_timeout = '5s';

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
    -- Every quoted literal, kept exactly (case, digits, any character; '' is a quote).
    have := have || ARRAY(SELECT replace(m[1], '''''', '''') FROM regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')*)''', 'g') m);
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

-- ---------------------------------------------------------------- lanes --
SELECT pg_temp.smr_widen_list_check('career_lane', 'kind', 'career_lane_kind_check', ARRAY['resume', 'creative', 'cv', 'performer']);

-- ------------------------------------------------------ practice record --
SELECT pg_temp.smr_widen_list_check('practice_entry', 'section', 'practice_entry_section_check', ARRAY[
  'exhibition', 'performance', 'residency', 'commission', 'publication', 'press',
  'collection', 'teaching', 'arts_program', 'award', 'education', 'work',
  'research', 'presentation', 'clinical', 'license', 'service', 'appointment',
  'membership', 'reference', 'credit', 'training', 'union']);

-- ------------------------------------------------- artifact type values --
SELECT pg_temp.smr_widen_list_check('refinery_artifact', 'artifact_type', 'refinery_artifact_artifact_type_check', ARRAY[
  'resume', 'cover_letter', 'follow_up', 'disclosure_plan', 'interview_prep', 'resource_list', 'job_match',
  'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv', 'performer_resume']);

DROP FUNCTION pg_temp.smr_widen_list_check(regclass, text, text, text[]);
