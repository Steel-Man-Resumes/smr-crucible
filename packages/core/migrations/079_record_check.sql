-- 079_record_check.sql
-- The record check: a separate, consented step where t.ROY helps a person work
-- out which official sources to check for the job or license they want, using
-- the offense they choose to type (decision D11, 2026-10-07).
--
-- WHAT THIS ADDS
--   consumer_consent / consumer_consent_event   one more consent layer value,
--                         'record_check'. The yes is a ticked box with a
--                         timestamp (granted_at, plus the immutable event row).
--                         Default is declined (consentDefaultFor in consent.ts).
--   record_check_saved    one row per checklist the person chose to save.
--                         Owner only. Nothing is written here unless the
--                         person presses "Save this checklist".
--
-- WHAT IS NOT STORED. The checklist's words are never stored: every line is
-- rebuilt on read from the curated question bank and the dated source list,
-- so a saved check holds only ids (picks_sealed). The job and the record the
-- person typed live in the request and on their screen for the session, and
-- reach this table only when they save AND tick "Keep what I typed"
-- (typed_sealed); the default is NULL. Both sealed columns are encrypted in
-- the app (AES-256-GCM, the DOCUMENT_ENCRYPTION_KEY envelope in crypto.ts)
-- with the owner, row id and field in the binding. Plain columns hold only
-- the state code and the date.
--
-- OWNERSHIP. Owner only, FORCE row-level security (same policy shape as
-- 059 / 073 / 075, without UPDATE: a saved check is never edited). No staff
-- path, no sharing scope, no view. The app role is REVOKEd first and then
-- given SELECT, INSERT, DELETE only; scripts/lib/restricted-grants.mjs holds
-- the same list so a later blanket grant cannot widen it.
-- Deleting the account cascades. "Delete my data" and revoking the consent
-- delete the rows through the app (as the owner, under these policies).
--
-- ADD ONLY. This file creates one table and widens two CHECK lists. It never
-- narrows a CHECK: the widen helper reads the values every matching CHECK
-- allows now and unions them with this file's list, so a later migration's
-- values survive a re-run of this one.
--
-- LOCKS. The CHECK swap on consumer_consent and consumer_consent_event scans
-- each table once while holding a strong lock until commit. Both are small.
-- lock_timeout makes the file give up after 5 seconds instead of queueing; if
-- it times out, run it again. Every statement is idempotent.
--
-- APPLY in ONE transaction (psql -1 -v ON_ERROR_STOP=1, or the runner's BEGIN),
-- BEFORE the code that reads record_check_saved deploys: /api/health/rls counts
-- this table and reports a problem while it is missing.
--
-- ROLLBACK, in this order:
--   1. Revert the record check CODE first and deploy that.
--   2. Rolling back LOSES every saved record check. Export first if anyone has
--      saved one (Settings, export, "Saved record checks").
--   3. Then, as the owner role, in one transaction:
--        DROP TABLE IF EXISTS record_check_saved;
--        DELETE FROM consumer_consent_event WHERE consent_layer = 'record_check';
--        DELETE FROM consumer_consent WHERE consent_layer = 'record_check';
--        DELETE FROM _migrations WHERE filename = '079_record_check.sql';
--      (Leave the widened CHECKs in place. An extra allowed value refuses
--      nothing the app sends.)

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------- saved checklists --

CREATE TABLE IF NOT EXISTS record_check_saved (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Two-letter state code.
  state             TEXT NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  -- {ciphertext, iv, tag, keyVersion}: the picked source and question ids.
  picks_sealed      JSONB NOT NULL
                      CHECK (jsonb_typeof(picks_sealed) = 'object'
                             AND picks_sealed ? 'ciphertext'
                             AND octet_length(picks_sealed::text) <= 8000),
  -- The job and record they typed, sealed, ONLY when they ticked "Keep what
  -- I typed". NULL by default.
  typed_sealed      JSONB
                      CHECK (typed_sealed IS NULL
                             OR (jsonb_typeof(typed_sealed) = 'object'
                                 AND typed_sealed ? 'ciphertext'
                                 AND octet_length(typed_sealed::text) <= 4000)),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_record_check_saved_user
  ON record_check_saved (user_id, created_at DESC);

-- Owner only: read, add, delete. No UPDATE policy (a saved check is never edited).
DO $$
DECLARE t text := 'record_check_saved';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_select', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_insert', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_update', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_delete', t);
  EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_select', t);
  EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_insert', t);
  EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)$p$, t || '_owner_delete', t);
END $$;

-- REVOKE first, then grant exactly three privileges, so default privileges
-- or an earlier blanket grant cannot leave UPDATE or TRUNCATE behind.
DO $$
BEGIN
  REVOKE ALL ON record_check_saved FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON record_check_saved FROM smr_app;
    GRANT SELECT, INSERT, DELETE ON record_check_saved TO smr_app;
  END IF;
END $$;

-- -------------------------------------------------- consent layer values --
-- Widen a "column IN (list)" CHECK without ever narrowing it (same helper as
-- 075): read the values every matching CHECK allows now, union them with this
-- file's list, and put back exactly one CHECK under the known name.
-- Session-temporary: dropped again at the end of this file.
CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check(tbl regclass, col text, cname text, want text[])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
  have text[] := '{}';
  allv text[];
  n int := 0;
  pat text := '\(' || col || ' = ANY|' || col || ' IN';
BEGIN
  FOR c IN SELECT oid FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    have := have || ARRAY(SELECT replace(m[1], '''''', '''') FROM regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')*)''', 'g') m);
    n := n + 1;
  END LOOP;
  allv := ARRAY(SELECT DISTINCT v FROM unnest(have || want) v ORDER BY v);
  IF n = 1 AND have @> want THEN
    RETURN;
  END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) ~ pat LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I IN (%s))', tbl, cname, col,
                 (SELECT string_agg(quote_literal(v), ', ') FROM unnest(allv) v));
END
$fn$;

SELECT pg_temp.smr_widen_list_check('consumer_consent', 'consent_layer', 'consumer_consent_consent_layer_check',
  ARRAY['core', 'enhanced', 'research', 'sharing', 'outcome_anonymous', 'outcome_named',
        'disclosure_transcript', 'interview_transcript', 'record_check']);
SELECT pg_temp.smr_widen_list_check('consumer_consent_event', 'consent_layer', 'consumer_consent_event_consent_layer_check',
  ARRAY['core', 'enhanced', 'research', 'sharing', 'outcome_anonymous', 'outcome_named',
        'disclosure_transcript', 'interview_transcript', 'record_check']);
DROP FUNCTION pg_temp.smr_widen_list_check(regclass, text, text, text[]);
