-- Job search result caching
-- Reduces JSearch API calls by caching identical queries for 6 hours.
-- Multiple users searching "warehouse milwaukee" share the same fresh results.

CREATE TABLE IF NOT EXISTS job_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash TEXT NOT NULL,
  query_params JSONB NOT NULL,
  results JSONB NOT NULL,
  result_count INT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(query_hash)
);

CREATE INDEX IF NOT EXISTS idx_job_cache_hash ON job_search_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_job_cache_expires ON job_search_cache(expires_at);
