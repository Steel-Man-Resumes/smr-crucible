-- 040_help_feedback.sql
-- Phase 8: Help & Feedback. This EVOLVES the existing support_request table
-- (from 025) -- it does NOT create a parallel table. All additive and
-- idempotent, style-matched to 039. Prod code that predates these columns
-- reads none of them, so this is inert until the Phase 8 UI ships.
--
-- support_request started as a single freeform "Message Troy" box. Phase 8
-- turns the same row into the backing store for the whole Help center: a
-- category, an admin reply that surfaces in the user's Help center, lifecycle
-- timestamps, and an OPT-IN captured-context blob.
--
-- category   : which of the five Help modes filed this row. NULL for every row
--              created before Phase 8 (old "Message Troy" rows) -- kept
--              nullable so those rows stay valid. New rows always set it.
--              ('bug' | 'confusing' | 'help' | 'idea' | 'message')
-- admin_reply: Troy's written reply. Its presence is what surfaces the reply in
--              the user's Help center (there is no separate notification table).
-- replied_at / seen_at / fixed_at : lifecycle timestamps set on the matching
--              status transition. All NULL until that transition happens.
-- context    : the OPT-IN captured debug context, server-derived, never trusted
--              from the client for anything sensitive. Shape:
--              { page, tier, decisionIds: string[], filedByAssistant?: bool }.
--              Empty object {} when the user did not opt in.
--
-- STATUS SUPERSET + DISPLAY MAPPING
--   The 025 CHECK allowed ('new','read','replied','closed'). Phase 8 needs a
--   richer lifecycle, so the CHECK is dropped and recreated (guarded) to the
--   superset ('new','received','seen','read','fixed','replied','closed').
--   Existing rows are NOT rewritten. Going forward 'received' is the default
--   for new rows; legacy 'new' DISPLAYS as "received" and legacy 'read'
--   DISPLAYS as "seen" (see DISPLAY_SUPPORT_STATUS in supportRequest.ts). The
--   stored value is left untouched so no history is lost.

ALTER TABLE support_request
  ADD COLUMN IF NOT EXISTS category    TEXT,
  ADD COLUMN IF NOT EXISTS admin_reply TEXT,
  ADD COLUMN IF NOT EXISTS replied_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seen_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fixed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS context     JSONB NOT NULL DEFAULT '{}';

-- category: nullable, but any non-null value must be one of the five modes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_request_category_check'
  ) THEN
    ALTER TABLE support_request ADD CONSTRAINT support_request_category_check
      CHECK (category IS NULL OR category IN ('bug', 'confusing', 'help', 'idea', 'message'));
  END IF;
END $$;

-- Expand the status CHECK to the Phase 8 superset. The 025 inline CHECK is
-- auto-named support_request_status_check; drop it (guarded) and recreate.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_request_status_check'
  ) THEN
    ALTER TABLE support_request DROP CONSTRAINT support_request_status_check;
  END IF;
END $$;

ALTER TABLE support_request
  ADD CONSTRAINT support_request_status_check
  CHECK (status IN ('new', 'received', 'seen', 'read', 'fixed', 'replied', 'closed'));

-- The user's own Help center reads their submissions newest-first.
CREATE INDEX IF NOT EXISTS idx_support_request_user
  ON support_request (user_id, created_at DESC);
