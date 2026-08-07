-- 027_artifact_is_current.sql
-- N4 vault redesign: let a user pin ONE current resume. The vault surfaces it at
-- the top and it is the default "grab my resume" target. Additive + inert to the
-- prod (main) code, which never reads the column.

ALTER TABLE refinery_artifact
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

-- At most one current artifact per user (only resumes are ever pinned, but this
-- guards the invariant regardless of type). Partial unique index over user_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refinery_artifact_current
  ON refinery_artifact (user_id) WHERE is_current;
