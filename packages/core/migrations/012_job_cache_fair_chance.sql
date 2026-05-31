-- Add fair_chance_info column to job_search_cache.
-- Cache hits previously returned empty string for fair_chance_info
-- even when the original enrichment produced jurisdiction-specific guidance.

ALTER TABLE job_search_cache
  ADD COLUMN IF NOT EXISTS fair_chance_info TEXT NOT NULL DEFAULT '';
