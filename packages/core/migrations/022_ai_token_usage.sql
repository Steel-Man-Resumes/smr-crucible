-- Exact AI token accounting (Troy, 2026-08-02: "exact tokens from day one").
-- One row per AI call, with real input/output token counts from the provider
-- response and the computed cost. Feeds the per-user AI cost calculator
-- (admin view, sponsoring-org view, solo-user view).
CREATE TABLE IF NOT EXISTS ai_token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  endpoint TEXT NOT NULL DEFAULT 'unknown',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_creation_input_tokens INT NOT NULL DEFAULT 0,
  cache_read_input_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user ON ai_token_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created ON ai_token_usage(created_at);
