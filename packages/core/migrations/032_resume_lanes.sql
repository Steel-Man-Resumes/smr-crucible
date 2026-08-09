-- 032_resume_lanes.sql
-- R6: locked per-lane BASELINE resumes. A user can keep several APPROVED baseline
-- resumes -- one per career lane (manufacturing, culinary, leadership, ...) --
-- lock them, and choose which one they are "searching as". The tailoring flow
-- then restructures the selected locked baseline (R5's trust + restructure)
-- rather than downgrading it. Additive + inert to code that never reads them.
--
-- lane: a short human label for the baseline's career lane (nullable).
-- is_locked: marks a resume as an approved, locked baseline. MULTIPLE are allowed
--   (unlike the single is_current pin), so a user can hold one baseline per lane.

ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS lane TEXT;
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
