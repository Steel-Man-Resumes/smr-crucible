-- Stage 1: Proof Spine
-- Adds outcome tracking, consent scopes for publishing, and hired status.

-- 1A: Add hired status and hired_at to job_application
ALTER TABLE job_application
  ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ;

-- Add a named CHECK constraint that includes the full valid status set.
-- Drop the old unnamed one first (Postgres auto-names it job_application_status_check
-- if one existed, but the original schema has no CHECK on status -- safe to just add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'job_application'
      AND column_name = 'status'
      AND constraint_name = 'job_application_status_values'
  ) THEN
    ALTER TABLE job_application
      ADD CONSTRAINT job_application_status_values
      CHECK (status IN (
        'saved', 'applied', 'heard_back', 'interviewing',
        'offered', 'declined', 'rejected',
        'hired', 'started_work'
      ));
  END IF;
END $$;

-- 1B: Add outcome publish consent scopes to consumer_consent.
-- The original inline CHECK is auto-named consumer_consent_consent_layer_check.
-- Drop it and replace with an explicit-named constraint that includes new scopes.
ALTER TABLE consumer_consent
  DROP CONSTRAINT IF EXISTS consumer_consent_consent_layer_check;

ALTER TABLE consumer_consent
  ADD CONSTRAINT consumer_consent_consent_layer_check
  CHECK (consent_layer IN (
    'core',
    'enhanced',
    'research',
    'sharing',
    'outcome_anonymous',
    'outcome_named'
  ));
