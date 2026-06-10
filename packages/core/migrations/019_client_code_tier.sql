-- 019: allow 'client'-tier access codes (cohort seat codes).
--
-- Seats v1 (Fable, 2026-06-10): role != rate-tier. A client-tier code grants
-- its daily_limit and a seat-bounded shared Forge bucket WITHOUT elevating the
-- redeemer's role -- seat-holders keep the full client journey + onboarding.
-- Partner role stays with the code OWNER (partner_user_id), which is how the
-- partner dashboard already resolves cohorts (keyed on ownership, not tier).
-- max_redemptions IS the seat limit (a redemption = one durable seat).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_code_tier_check') THEN
    ALTER TABLE access_code DROP CONSTRAINT access_code_tier_check;
  END IF;
END $$;

ALTER TABLE access_code
  ADD CONSTRAINT access_code_tier_check
  CHECK (tier IN ('client', 'partner', 'unlimited', 'admin'));
