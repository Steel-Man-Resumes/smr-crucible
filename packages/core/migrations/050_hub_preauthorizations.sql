-- hub_preauthorizations, as a migration instead of runtime DDL.
--
-- /api/hub-unlock ran CREATE TABLE IF NOT EXISTS from inside the request, and
-- SELECTed from the table BEFORE creating it. The table never existed in
-- production, so the "email not registered yet" branch has always thrown. It
-- would also be refused outright under the application role, which cannot
-- create objects -- and should not be able to.
--
-- KNOWN GAP, not closed here: nothing consumes these rows at sign-up. A hub
-- user who registers later does not receive the access this records.
CREATE TABLE IF NOT EXISTS hub_preauthorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  hub_user_id text NOT NULL,
  access_code_id uuid NOT NULL REFERENCES access_code(id),
  unlock_level text NOT NULL,
  created_at timestamptz DEFAULT now(),
  redeemed_at timestamptz,
  UNIQUE(email, access_code_id)
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hub_preauthorizations TO smr_app;
  END IF;
END $$;
