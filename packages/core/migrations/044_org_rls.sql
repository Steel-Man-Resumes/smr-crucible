-- Row-level security on the organization boundary.
--
-- WHAT THIS CHANGES. Until now "one organization cannot see another's people"
-- was a property of every query remembering a WHERE clause, verified by tests.
-- Now the database refuses. A query that forgets its scope returns zero rows
-- instead of somebody else's.
--
-- WHY THESE TWO TABLES FIRST. Every cross-org defect found this week lived in
-- exactly here: a staff-assignment join without an org predicate leaked a
-- foreign org's staff name; assignClientStaff accepted any user id in the
-- system; addOrgStaff let an admin recruit a stranger and read their identity
-- back. org_staff and client_staff_assignment ARE the "whose caseload is
-- whose" boundary.
--
-- access_code_redemption is deliberately NOT included yet. It is read from a
-- dozen participant paths that legitimately have no organization scope, and a
-- policy there would break code redemption and tier resolution. Half-protecting
-- it would be worse than not yet: it would let us claim more than is true.
--
-- THE POLICY SHAPE, and the NULLIF is load-bearing. `current_setting(x, true)`
-- returns NULL when the setting was never set, but an EMPTY STRING once it has
-- been set and released -- which is what happens on a pooled connection after
-- any scoped request. Casting '' to uuid raises rather than returning no rows,
-- so without NULLIF an unscoped query ERRORS instead of coming back empty.
-- Caught by testing it; it is not visible by reading the policy.
--
-- With NULLIF the comparison is NULL, which is not TRUE, which denies. Default
-- deny comes free: a forgotten scope is an empty result, never a leak.
--
-- FORCE ROW LEVEL SECURITY is the line that matters. Without it the table
-- OWNER bypasses its own policies, and the app connects as a table owner in
-- every environment where the role cutover has not happened yet.

ALTER TABLE org_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_staff FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_staff_org_scope ON org_staff;
-- Two ways in, and the second is not a loophole.
--   1. Scoped to this organization -- the normal path.
--   2. Your OWN staff row, by user id. Membership resolution has to read this
--      table to discover which organization you belong to, which it cannot do
--      while already scoped to that organization. Seeing only your own row is
--      exactly enough to answer "where do I work", and nothing more.
CREATE POLICY org_staff_org_scope ON org_staff
  USING (
    access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  -- WRITES ARE ORG-SCOPED ONLY. Reading your own row is fine; creating or
  -- changing one for yourself is how somebody grants themselves access.
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE client_staff_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_staff_assignment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS csa_org_scope ON client_staff_assignment;
CREATE POLICY csa_org_scope ON client_staff_assignment
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The app role needs the same grants on these as everywhere else; RLS narrows
-- WHICH ROWS, it does not grant access to the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON org_staff TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_staff_assignment TO smr_app;
  END IF;
END $$;
