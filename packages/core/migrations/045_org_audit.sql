-- Who changed what, recorded by the DATABASE rather than by the application.
--
-- WHY A TRIGGER AND NOT A FUNCTION CALL. An audit written by application code
-- is an audit somebody can forget, skip in a hotfix, or lose in a refactor --
-- and you only discover the gap when you need the record. A trigger fires on
-- every write through every path, including a migration script, a console
-- session, or a future route nobody has written yet.
--
-- IT ALSO SURVIVES BYPASSRLS, which policies do not. A role with BYPASSRLS
-- walks through row-level security untouched; it does NOT walk through a
-- trigger. So for the one thing an agency asks hardest about -- "can you tell
-- me who added that person to our team" -- this is stronger than the policies
-- built yesterday.
--
-- The actor comes from the same app.user_id GUC the policies read, falling
-- back to the database role when nothing set it. A row attributed to
-- 'neondb_owner' means a human or a script did it outside the app, which is
-- itself the useful signal.

CREATE TABLE IF NOT EXISTS org_audit (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  org_id UUID,
  subject_user_id UUID,
  actor TEXT NOT NULL,
  -- The row as it ended up, or as it was for a delete. Enough to answer
  -- "what changed", never enough to reconstruct participant content.
  row_summary JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org ON org_audit(org_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_subject ON org_audit(subject_user_id, at DESC);

CREATE OR REPLACE FUNCTION org_audit_write() RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY DEFINER so the audit row is written even though the app role has
-- only INSERT on this table and cannot read it back. An actor who can edit or
-- erase their own audit trail does not have an audit trail.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rec RECORD;
  actor TEXT;
BEGIN
  rec := COALESCE(NEW, OLD);
  actor := COALESCE(NULLIF(current_setting('app.user_id', true), ''), current_user);

  INSERT INTO org_audit (table_name, action, org_id, subject_user_id, actor, row_summary)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    (to_jsonb(rec) ->> 'access_code_id')::uuid,
    COALESCE(
      (to_jsonb(rec) ->> 'user_id')::uuid,
      (to_jsonb(rec) ->> 'client_user_id')::uuid
    ),
    actor,
    -- Named fields only. A blanket to_jsonb(rec) would quietly start logging
    -- any column added later, including one nobody intended to record.
    jsonb_strip_nulls(jsonb_build_object(
      'role', to_jsonb(rec) ->> 'role',
      'title', to_jsonb(rec) ->> 'title',
      'staff_user_id', to_jsonb(rec) ->> 'staff_user_id'
    ))
  );
  RETURN rec;
END;
$$;

DROP TRIGGER IF EXISTS org_staff_audit ON org_staff;
CREATE TRIGGER org_staff_audit
  AFTER INSERT OR UPDATE OR DELETE ON org_staff
  FOR EACH ROW EXECUTE FUNCTION org_audit_write();

DROP TRIGGER IF EXISTS csa_audit ON client_staff_assignment;
CREATE TRIGGER csa_audit
  AFTER INSERT OR UPDATE OR DELETE ON client_staff_assignment
  FOR EACH ROW EXECUTE FUNCTION org_audit_write();

-- APPEND ONLY, AND THE REVOKE IS THE LOAD-BEARING HALF.
--
-- Granting INSERT is not enough. The app role was granted DML on ALL tables in
-- this schema, and ALTER DEFAULT PRIVILEGES gives it the same on every table
-- created afterwards -- which includes this one. Tested: without the revokes
-- below the app could DELETE its own audit trail and UPDATE the actor on a row
-- to somebody else's name. An actor who can edit their own audit trail does
-- not have an audit trail.
--
-- SELECT stays: an org admin can legitimately be shown who changed what.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON org_audit FROM smr_app;
    GRANT SELECT, INSERT ON org_audit TO smr_app;
    GRANT USAGE, SELECT ON SEQUENCE org_audit_id_seq TO smr_app;
  END IF;
END $$;

-- And exclude it from the blanket default so a future re-grant cannot quietly
-- hand back UPDATE and DELETE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE, DELETE ON TABLES FROM smr_app;
