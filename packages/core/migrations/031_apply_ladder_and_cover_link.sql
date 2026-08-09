-- 031_apply_ladder_and_cover_link.sql
-- Completes the "Apply" loop (Wave R: R8 + R1). Additive + inert to prod code
-- that never reads these columns, so it can ship ahead of the UI.
--
-- employer_website: second rung of the Apply ladder (after apply_url from 021).
--   Snapshotted on the saved job the same way apply_url is, so a saved job keeps
--   a real place to apply even when JSearch gave us no direct apply link.
-- cover_letter_artifact_id: lets the Applications "pending work" view show a
--   cover-letter status badge, mirroring resume_artifact_id / disclosure_plan_id.
--   The cover-letter save already carries applicationId, so wiring this column
--   into APPLICATION_LINK_COLUMN links it automatically.

ALTER TABLE job_application
  ADD COLUMN IF NOT EXISTS employer_website TEXT;

ALTER TABLE job_application
  ADD COLUMN IF NOT EXISTS cover_letter_artifact_id UUID REFERENCES refinery_artifact(id);
