-- 038_jd_snapshot.sql
-- Phase 3.2: the JD as it was at save time, so interview auto-fill / fit-check /
-- reopened-job tailoring all read ONE snapshot instead of re-deriving a
-- different JD per flow. Results (fit-check, interview questions) key to
-- jd_hash + the resume revision hash, so a cached result stays valid exactly
-- as long as both the stored JD and the resume it was computed against are
-- unchanged. Additive, idempotent.
--
-- Provenance is stored alongside the text: where the JD came from
-- (jd_source_provider: 'jsearch','careeronestop','pasted','fetched_url', ...),
-- the URL it was read from (jd_source_url), and when (jd_fetched_at). The
-- board save previously persisted only a 200-char truncated description with no
-- provenance; the tailor flow persisted the full text but no source/hash. These
-- columns are the single canonical snapshot both write into.
ALTER TABLE job_application
  ADD COLUMN IF NOT EXISTS jd_full_text        TEXT,
  ADD COLUMN IF NOT EXISTS jd_excerpt          TEXT,
  ADD COLUMN IF NOT EXISTS jd_source_url       TEXT,
  ADD COLUMN IF NOT EXISTS jd_source_provider  TEXT,
  ADD COLUMN IF NOT EXISTS jd_fetched_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS jd_hash             TEXT,
  ADD COLUMN IF NOT EXISTS jd_truncated        BOOLEAN NOT NULL DEFAULT false;

-- jd_hash is the key fit-check / interview results bind to -- index it so a
-- "have we already computed for this exact JD?" lookup is cheap.
CREATE INDEX IF NOT EXISTS idx_job_application_jd_hash
  ON job_application (jd_hash);
