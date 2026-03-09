-- 007: Add password_hash and tier columns to users table
-- Enables: password login (return path), tiered dashboard access

-- Password hash (nullable — most users use magic link only)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Tier column cached on user for fast session reads
-- Source of truth for code-based upgrades remains access_code_redemption
-- Values: client (default), partner, observer, admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'client';

-- Add check constraint (separate statement for IF NOT EXISTS compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_tier_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_tier_check
      CHECK (tier IN ('client', 'partner', 'observer', 'admin'));
  END IF;
END$$;

-- Index for tier-based queries
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
