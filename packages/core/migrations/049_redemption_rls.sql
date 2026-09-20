-- Row-level security on access_code_redemption: who belongs to which org.
--
-- APPLY ONLY AFTER 048's callers are live. Every application read of this
-- table was converted to a scoped helper FIRST, while this was still off, so
-- that deploy changed nothing. This file is the moment an unconverted read
-- would start returning nothing -- and several of them would not fail, they
-- would ACT: a tier re-sync would demote someone, the rate limiter would hand
-- every participant the anonymous allowance, first-code-wins would rebind a
-- person to a second org. The isolation suite asserts each of those by name.
--
-- ROLLBACK, no deploy needed:
--   ALTER TABLE access_code_redemption DISABLE ROW LEVEL SECURITY;
-- That is a SECURITY rollback, not a neutral one. Say so when you do it.

ALTER TABLE access_code_redemption ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_code_redemption FORCE ROW LEVEL SECURITY;

-- SELECT: your own memberships, or the members of the org you are scoped to.
DROP POLICY IF EXISTS acr_select ON access_code_redemption;
CREATE POLICY acr_select ON access_code_redemption FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  );

-- DELETE: an org releasing one of ITS OWN seats (revoking a pending invite).
-- A person leaving goes through smr_leave_all_orgs, which also clears their
-- assignments; a bare self-DELETE policy would have skipped that.
DROP POLICY IF EXISTS acr_delete ON access_code_redemption;
CREATE POLICY acr_delete ON access_code_redemption FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- NO INSERT POLICY AND NO UPDATE POLICY, and the grants go too. Membership is
-- created by smr_redeem_code or not at all, and a row can never be edited into
-- a different person or a different organization.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON access_code_redemption FROM smr_app;
    GRANT SELECT, DELETE ON access_code_redemption TO smr_app;
  END IF;
END $$;
