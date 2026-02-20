-- Allow artifacts to record generation failures (no file_object_id)
ALTER TABLE artifact ALTER COLUMN file_object_id DROP NOT NULL;

-- Expand review_status to include generation_failed
ALTER TABLE artifact DROP CONSTRAINT IF EXISTS artifact_review_status_check;
ALTER TABLE artifact ADD CONSTRAINT artifact_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected', 'generation_failed'));
