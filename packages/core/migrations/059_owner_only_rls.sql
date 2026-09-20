-- Row-level security on the first two PARTICIPANT-OWNED tables.
--
-- vault_document     what somebody stored: an ID, a certificate, a letter.
-- user_progress_event  their activity history.
--
-- Nobody but the owner has any business in either one. Staff never read them,
-- no program can require them, and no sharing scope covers them. So the policy
-- is the simplest one there is: the row's user_id is the person the request is
-- running as, for every command. A query that forgets its WHERE clause now sees
-- one person's rows instead of everyone's.
--
-- These two go first because they are the smallest (eight call sites between
-- them) and prove the method before it is applied to resumes and applications,
-- where staff DO read under a grant and the policy is not this simple.
--
-- Cascades from deleting a user or a secure_object are referential-integrity
-- actions and are not subject to these policies, so account deletion and vault
-- deletion keep working as they did.
--
-- ROLLBACK, no deploy needed (a SECURITY rollback; say so when you do it):
--   ALTER TABLE vault_document DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE user_progress_event DISABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vault_document', 'user_progress_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
                                                 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_delete', t);
  END LOOP;
END $$;
