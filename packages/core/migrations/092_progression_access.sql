-- Guided access is separate from account roles and paid entitlements.
-- Existing accounts retain access. Apply before the corresponding app release.
SET LOCAL lock_timeout = '5s';
CREATE TABLE progression_policy (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 starter_calls integer NOT NULL DEFAULT 8 CHECK(starter_calls BETWEEN 1 AND 100),
 tailored_calls integer NOT NULL DEFAULT 10 CHECK(tailored_calls BETWEEN 1 AND 100),
 applied_calls integer NOT NULL DEFAULT 12 CHECK(applied_calls BETWEEN 1 AND 100),
 bonus_calls integer NOT NULL DEFAULT 2 CHECK(bonus_calls BETWEEN 1 AND 10),
 bonus_daily_cap integer NOT NULL DEFAULT 4 CHECK(bonus_daily_cap BETWEEN 0 AND 20),
 bonus_monthly_cap integer NOT NULL DEFAULT 12 CHECK(bonus_monthly_cap BETWEEN 0 AND 100),
 daily_usd numeric NOT NULL DEFAULT 1 CHECK(daily_usd BETWEEN 0.1 AND 20),
 reserve_usd numeric NOT NULL DEFAULT 0.20 CHECK(reserve_usd BETWEEN 0.01 AND 2),
 launched_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 change_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(starter_calls <= tailored_calls AND tailored_calls <= applied_calls),
 CHECK(reserve_usd <= daily_usd)
);
INSERT INTO progression_policy(id) VALUES(true);
CREATE TABLE progression_account (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 existing_access boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO progression_account(user_id,existing_access) SELECT id,true FROM users;
CREATE TABLE progression_grant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_key text CHECK(request_key IS NULL OR length(request_key) BETWEEN 8 AND 100),
 grant_key text NOT NULL CHECK(length(grant_key) BETWEEN 1 AND 180),
 kind text NOT NULL CHECK(kind IN ('unlock','milestone','bonus')),
 step_id text NOT NULL CHECK(step_id IN ('foundation','direction','tailor','apply','interview','offer')),
 calls integer NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 10),
 label text NOT NULL CHECK(length(label) <= 200),
 expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,grant_key),
 UNIQUE(user_id,request_key)
);
CREATE TABLE progression_request (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 100),
 kind text NOT NULL CHECK(kind IN ('unlock','ai_bonus','feedback','bug')),
 step_id text NOT NULL CHECK(step_id IN ('foundation','direction','tailor','apply','interview','offer')),
 summary_encrypted jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','question')),
 decision_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 decision_note text CHECK(length(decision_note) <= 1000),
 decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX progression_request_queue ON progression_request(status,created_at);
CREATE INDEX progression_grant_user_date ON progression_grant(user_id,created_at);
ALTER TABLE ai_operation ADD COLUMN provider_not_called boolean NOT NULL DEFAULT false;
ALTER TABLE ai_operation ADD COLUMN progression_counted boolean NOT NULL DEFAULT false;
ALTER TABLE ai_operation ADD COLUMN progression_bonus_used boolean NOT NULL DEFAULT false;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['progression_policy','progression_account','progression_grant','progression_request'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (EXISTS (SELECT 1 FROM platform_admin WHERE user_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM platform_admin WHERE user_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid))',t||'_admin',t);
  IF t <> 'progression_policy' THEN
   EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (user_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid)',t||'_owner',t);
  ELSE
   EXECUTE 'CREATE POLICY progression_policy_read ON progression_policy FOR SELECT USING (NULLIF(current_setting(''app.user_id'',true),'''') IS NOT NULL)';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='smr_app') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO smr_app',t);
  END IF;
 END LOOP;
END $$;
