-- Apply before the operation-accounting code. No policy rows are seeded: this
-- migration changes measurement, not anybody's allowances. Revert code before
-- rollback; retain these accounting rows until the normal retention decision.
ALTER TABLE ai_token_usage ALTER COLUMN cost_usd DROP NOT NULL;
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS cost_status text NOT NULL DEFAULT 'legacy'
  CHECK (cost_status IN ('priced', 'estimated', 'unpriced', 'legacy'));
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS cost_basis text;
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS operation_id uuid;
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'succeeded'
  CHECK (outcome IN ('succeeded', 'failed', 'unknown'));
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS ai_token_usage_event_key ON ai_token_usage(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow text NOT NULL CHECK (length(workflow) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_operation_user_day ON ai_operation(user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_token_usage_operation ON ai_token_usage(operation_id);
CREATE TABLE IF NOT EXISTS ai_tool_policy (
  workflow text PRIMARY KEY CHECK (length(workflow) BETWEEN 1 AND 80),
  disabled boolean NOT NULL DEFAULT false,
  daily_calls integer CHECK (daily_calls >= 0),
  daily_usd numeric(12,6) CHECK (daily_usd >= 0),
  reserve_usd numeric(12,6) CHECK (reserve_usd > 0),
  premium_tool text CHECK (premium_tool IN ('resources','interview_coaching','one_click_apply')),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (daily_usd IS NULL OR reserve_usd IS NOT NULL)
);
ALTER TABLE ai_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_operation FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_operation_owner ON ai_operation;
CREATE POLICY ai_operation_owner ON ai_operation FOR ALL
  USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id',true),'')::uuid);
DROP POLICY IF EXISTS ai_operation_admin_read ON ai_operation;
CREATE POLICY ai_operation_admin_read ON ai_operation FOR SELECT USING (
  EXISTS (SELECT 1 FROM platform_admin WHERE user_id = nullif(current_setting('app.user_id',true),'')::uuid)
);
DROP POLICY IF EXISTS ai_tool_policy_read ON ai_tool_policy;
CREATE POLICY ai_tool_policy_read ON ai_tool_policy FOR SELECT USING (
  nullif(current_setting('app.user_id',true),'') IS NOT NULL
);
DROP POLICY IF EXISTS ai_tool_policy_admin ON ai_tool_policy;
CREATE POLICY ai_tool_policy_admin ON ai_tool_policy FOR ALL USING (
  EXISTS (SELECT 1 FROM platform_admin WHERE user_id = nullif(current_setting('app.user_id',true),'')::uuid)
) WITH CHECK (
  EXISTS (SELECT 1 FROM platform_admin WHERE user_id = nullif(current_setting('app.user_id',true),'')::uuid)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON ai_operation TO smr_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ai_tool_policy TO smr_app;
  END IF;
END $$;
