-- Harden the org policies. Three defects found in review, all real.
--
-- 1. THE SELF-READ CLAUSE WAS NOT READ-ONLY. A policy with no FOR clause is
--    FOR ALL, and USING governs SELECT, UPDATE and DELETE alike -- WITH CHECK
--    only constrains the NEW row of an INSERT or UPDATE, never a deletion. So
--    "you may read your own membership row" also meant "you may DELETE your own
--    membership row with no org scope at all", and an UPDATE could move a row
--    from org B into org A: USING passed via the self clause, WITH CHECK passed
--    because the new row belonged to A. A boundary crossing, through the clause
--    added to let people discover which side of it they are on.
--
--    Split by command. Self-discovery is a SELECT privilege and nothing more.
--
-- 2. THE AUDIT TABLE WAS FORGEABLE AND WORLD-READABLE. The app was granted
--    INSERT so the trigger could write -- which was unnecessary, because a
--    SECURITY DEFINER trigger writes as its owner. That grant let the
--    application insert a fabricated event choosing its own actor, org, subject
--    and timestamp. Append-only is not the same as authentic. And with no RLS,
--    one organization could read every other organization's history.
--
-- 3. ATTRIBUTION FELL BACK TO THE WRONG IDENTITY. current_user inside a
--    SECURITY DEFINER function is the function OWNER, so an app write with no
--    actor set was recorded as neondb_owner -- indistinguishable from a human
--    running SQL by hand, which is exactly the distinction the column existed
--    to make. session_user is the connected role and is the honest fallback.

-- ---------------------------------------------------------------- policies --

DROP POLICY IF EXISTS org_staff_org_scope ON org_staff;

-- SELECT: your own row, or the org you are scoped to.
CREATE POLICY org_staff_select ON org_staff FOR SELECT
  USING (
    access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

-- INSERT / UPDATE / DELETE: org scope only. Note UPDATE needs BOTH sides --
-- USING picks which rows may be changed, WITH CHECK what they may become, so
-- a row cannot be read out of one org and written into another.
CREATE POLICY org_staff_insert ON org_staff FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY org_staff_update ON org_staff FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY org_staff_delete ON org_staff FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- client_staff_assignment never needed a self clause; keep it org-only but
-- split for the same reason -- an implicit FOR ALL is a footgun to leave lying.
DROP POLICY IF EXISTS csa_org_scope ON client_staff_assignment;

CREATE POLICY csa_select ON client_staff_assignment FOR SELECT
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY csa_insert ON client_staff_assignment FOR INSERT
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY csa_update ON client_staff_assignment FOR UPDATE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY csa_delete ON client_staff_assignment FOR DELETE
  USING (access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- ------------------------------------------------------------- audit trail --

-- Honest attribution. session_user is the role that actually connected;
-- current_user inside SECURITY DEFINER is the function owner and says nothing
-- about who acted.
CREATE OR REPLACE FUNCTION org_audit_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec RECORD;
BEGIN
  rec := COALESCE(NEW, OLD);
  INSERT INTO org_audit (table_name, action, org_id, subject_user_id, actor, db_role, row_summary)
  VALUES (
    TG_TABLE_NAME, TG_OP,
    (to_jsonb(rec) ->> 'access_code_id')::uuid,
    COALESCE((to_jsonb(rec) ->> 'user_id')::uuid, (to_jsonb(rec) ->> 'client_user_id')::uuid),
    -- NULL when the application did not say who acted. An empty actor is a
    -- known unknown; a wrong one is a lie the record cannot be questioned on.
    NULLIF(current_setting('app.user_id', true), ''),
    session_user,
    jsonb_strip_nulls(jsonb_build_object(
      'role', to_jsonb(rec) ->> 'role',
      'title', to_jsonb(rec) ->> 'title',
      'staff_user_id', to_jsonb(rec) ->> 'staff_user_id'
    ))
  );
  RETURN rec;
END;
$$;

ALTER TABLE org_audit ADD COLUMN IF NOT EXISTS db_role TEXT;
ALTER TABLE org_audit ALTER COLUMN actor DROP NOT NULL;

-- The trigger owner writes these rows. The application never does.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_audit FROM smr_app;
    GRANT SELECT ON org_audit TO smr_app;
  END IF;
END $$;

-- And an org can only read its own history.
ALTER TABLE org_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_audit_select ON org_audit;
CREATE POLICY org_audit_select ON org_audit FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
