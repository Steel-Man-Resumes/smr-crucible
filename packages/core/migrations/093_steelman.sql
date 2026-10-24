-- Steel Man meter: the allowance step-up for Steel Man status.
-- Additive only. Ships OFF (0 extra calls); Troy sets the number later with
--   UPDATE progression_policy SET steel_man_bonus_calls = <n> WHERE id = true;
-- Meter moments reuse progression_grant (kind 'milestone', calls 0) and its
-- UNIQUE(user_id, grant_key), so no new table is needed.
-- ROLLBACK: ALTER TABLE progression_policy DROP COLUMN IF EXISTS steel_man_bonus_calls;
SET LOCAL lock_timeout = '5s';
ALTER TABLE progression_policy
  ADD COLUMN IF NOT EXISTS steel_man_bonus_calls integer NOT NULL DEFAULT 0
  CHECK (steel_man_bonus_calls BETWEEN 0 AND 20);
