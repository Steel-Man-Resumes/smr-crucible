-- Store the employer's application URL on saved jobs so the Applications
-- pipeline can offer a real "apply" action instead of dead-ending after Save.
ALTER TABLE job_application ADD COLUMN IF NOT EXISTS apply_url TEXT;
