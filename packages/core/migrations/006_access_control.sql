-- 006_access_control.sql
-- Access control: partner codes, rate limiting, usage tracking
-- Part of Hybrid access model (free for all + partner codes for higher limits)

-- Partner-distributable access codes
CREATE TABLE IF NOT EXISTS access_code (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  partner_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'partner' CHECK (tier IN ('partner', 'unlimited', 'admin')),
  daily_limit INT,  -- NULL = unlimited
  max_redemptions INT,
  times_redeemed INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,  -- NULL = never expires
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user-per-day AI usage counters (replaces Redis)
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  ip_address TEXT,
  endpoint TEXT NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  call_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per user+endpoint+day (Refinery: user-based)
  CONSTRAINT uq_ai_usage_user UNIQUE (user_id, endpoint, usage_date),
  -- One row per IP+endpoint+day (Forge: IP-based)
  CONSTRAINT uq_ai_usage_ip UNIQUE (ip_address, endpoint, usage_date)
);

-- Junction: which user redeemed which code
CREATE TABLE IF NOT EXISTS access_code_redemption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  access_code_id UUID NOT NULL REFERENCES access_code(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_code UNIQUE (user_id, access_code_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage (user_id, usage_date) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_ip_date ON ai_usage (ip_address, usage_date) WHERE ip_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_code_active ON access_code (code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_access_code_redemption_user ON access_code_redemption (user_id);
