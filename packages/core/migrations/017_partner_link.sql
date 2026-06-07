-- 017_partner_link.sql
-- Link a monitoring partner (a user account) to the access codes they own, so
-- the partner dashboard can resolve their cohort = the users who redeemed their
-- codes. Tier 'partner' alone is ambiguous (redeeming a partner code also makes
-- the redeemer tier 'partner'); code OWNERSHIP is the unambiguous signal for
-- "this user monitors this cohort."

ALTER TABLE access_code
  ADD COLUMN IF NOT EXISTS partner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_access_code_partner_user ON access_code(partner_user_id);
