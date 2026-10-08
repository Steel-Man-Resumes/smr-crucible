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
-- ROLLBACK, in this order:
--   1. Revert the CV lane CODE first and deploy that (it reads cv_type, the
--      new sections and the 'cv' type).
--   2. Rolling back LOSES every CV lane and every record entry of the new
--      kinds. Export first if anyone has used them.
--   3. Then, as the owner role, in one transaction:
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

ALTER TABLE career_lane DROP CONSTRAINT IF EXISTS career_lane_kind_check;
ALTER TABLE career_lane ADD CONSTRAINT career_lane_kind_check
  CHECK (kind IN ('resume', 'creative', 'cv'));

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
-- 075 made the section CHECK inline (practice_entry_section_check). Any CHECK
-- testing section against a list is dropped by its shape and the wider list
-- put back under the known name; it cannot fail on existing rows.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'practice_entry'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\(section = ANY|section IN'
  LOOP
    EXECUTE format('ALTER TABLE practice_entry DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE practice_entry ADD CONSTRAINT practice_entry_section_check
  CHECK (section IN (
    'exhibition', 'performance', 'residency', 'commission', 'publication', 'press',
    'collection', 'teaching', 'arts_program', 'award', 'education', 'work',
    'research', 'presentation', 'clinical', 'license', 'service', 'appointment',
    'membership', 'reference'
  ));

-- ------------------------------------------------- artifact type values --
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'refinery_artifact'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\(artifact_type = ANY|artifact_type IN'
  LOOP
    EXECUTE format('ALTER TABLE refinery_artifact DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_artifact_type_check
  CHECK (artifact_type IN (
    'resume', 'cover_letter', 'follow_up', 'disclosure_plan',
    'interview_prep', 'resource_list', 'job_match',
    'artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv'
  ));
