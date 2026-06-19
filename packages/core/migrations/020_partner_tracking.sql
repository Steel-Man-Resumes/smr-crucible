-- 020: partner usage ledger for funder / compliance / governance tracking.
--
-- Every rate-limited tool call attributed to an organization's access code --
-- whether the caller has an account yet or is in the anonymous code-carrying
-- Forge front door. Per-org isolation is a strict filter on `code`, so one
-- org's numbers can never be polluted by another's. No PII lives here: only the
-- code, an optional user id, the tool endpoint, and a timestamp.
--
-- This is the "number of times they used it" + "from day one" spine. Outcomes
-- (forge completed / refinery / applications / hires / success rate) keep coming
-- from the existing tables joined through access_code_redemption (attribution),
-- which registration + first-tool-call now populate automatically.

CREATE TABLE IF NOT EXISTS partner_usage_event (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  user_id UUID,            -- nullable: anonymous front-door Forge use; no FK on purpose (ledger, not relation)
  endpoint TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_usage_code ON partner_usage_event (code);
CREATE INDEX IF NOT EXISTS idx_partner_usage_code_time ON partner_usage_event (code, occurred_at);

-- Fast "is this user already attributed to an org?" check (isolation: first code wins).
CREATE INDEX IF NOT EXISTS idx_acr_user ON access_code_redemption (user_id);
