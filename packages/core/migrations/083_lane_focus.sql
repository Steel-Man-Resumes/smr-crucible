-- 083_lane_focus.sql
-- Today's task, tied to the person's career lane (Phase 5 lane R2).
--
-- WHY. The first screen after sign-in now asks one question: "What do you
-- need today?" (a resume I can use, go after a job, get ready for an
-- interview, or something else). The answer decides which screens come next
-- and what the lane header says ("Working toward: warehouse work. Today:
-- your resume"). It is a small saved value on top of the lane the person is
-- already in, NOT a new silo: the lane (074) still holds the target, the
-- resumes and the settings; this row only says what today's job is.
--
-- WHAT THIS ADDS
--   lane_focus   one row per person (user_id is the key): the task they
--                picked, the lane it is for (NULL = the "main" lane, work
--                outside any named lane), and an optional target in their
--                own words for someone who has no named lane yet. Changing
--                the task updates this one row; nothing else moves.
--
-- OWNERSHIP. Owner only, FORCE row-level security, every command, the same
-- policy shape as 059 / 074. lane_id is a composite foreign key on
-- (lane_id, user_id) to career_lane (id, user_id), so a focus can only ever
-- point at a lane its own owner holds, whatever id a request sends (foreign-
-- key checks do not go through row-level security, which is what makes the
-- composite key the guard). The key is user_id itself, so an upsert can never
-- move a row to another person (the shape of review item A9 cannot happen).
-- "Delete my data" deletes the row AS the person, before the lanes. Deleting
-- the account cascades (users). The data export includes it.
--
-- ADD ONLY and idempotent: one new table. Nothing existing changes. Old code
-- ignores it; the new code treats a missing table as "no task picked yet"
-- and shows the first screen.
--
-- APPLY in ONE transaction (psql -1 -v ON_ERROR_STOP=1, or the runner's
-- BEGIN), BEFORE the code that reads lane_focus deploys: /api/health/rls
-- counts this table and reports a problem while it is missing.
--
-- ROLLBACK, in this order:
--   1. Revert the lane-first CODE first and deploy that (the first screen,
--      the lane header and /api/lane-focus read this table).
--   2. Rolling back loses each person's saved "today" pick. Nothing else:
--      their lanes, resumes and revisions are untouched, and the first
--      screen simply asks again.
--   3. Then, as the owner role, in one transaction:
--        DROP TABLE IF EXISTS lane_focus;
--        DELETE FROM _migrations WHERE filename = '083_lane_focus.sql';

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS lane_focus (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- The lane today's task is for. NULL = the main lane.
  lane_id     UUID,
  -- What the person picked on "What do you need today?".
  task        TEXT NOT NULL
                CHECK (task IN ('resume', 'job', 'interview', 'documents', 'explore', 'support')),
  -- The kind of work, in the person's words, when no named lane holds it.
  target      TEXT CHECK (target IS NULL OR (length(btrim(target)) BETWEEN 1 AND 200)),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NO ACTION (not RESTRICT): when an account is deleted, its lanes and this
  -- row go in the same cascade and the check passes at statement end. The app
  -- only ever archives lanes, never deletes them.
  CONSTRAINT lane_focus_lane_owner_fk
    FOREIGN KEY (lane_id, user_id) REFERENCES career_lane (id, user_id)
);

-- Owner only, every command (same shape as 059 / 074).
DO $$
DECLARE t text := 'lane_focus';
BEGIN
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
END $$;

-- REVOKE first, then grant exactly what the app needs (DELETE is for
-- "delete my data" only).
DO $$
BEGIN
  REVOKE ALL ON lane_focus FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON lane_focus FROM smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON lane_focus TO smr_app;
  END IF;
END $$;
