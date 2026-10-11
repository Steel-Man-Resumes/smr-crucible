-- 081_artifact_revision.sql
-- One saved revision of a finished (or draft) resume, on the server.
--
-- WHY. Until now the Forge finish page kept the finished resume, its letter
-- and the person's confirmations in the browser only. The account saved an
-- earlier, reconstructed resume; downloads, print, quick-apply and the
-- automatic email each took raw text from the page and trusted the page's
-- "finished" flag (Phase 5 lane R1; review items A1, A3, A5, A7). A revision
-- is the one record every one of those paths now reads: the server loads it,
-- checks it belongs to the person, and decides DRAFT from its stored status.
--
-- WHAT THIS ADDS
--   artifact_revision     one row per saved version of a resume artifact:
--                         the resume text and the letter text, the person's
--                         confirmations (skill terms they kept, credentials
--                         they confirmed in their own words, their defend
--                         answers, which include title and scope answers),
--                         the rest of the evidence the finish gate reads, the
--                         checker version, the status the SERVER computed
--                         (draft or finished), the page count the renderer
--                         measured and the page limit that applied.
--                         Rows are never edited: a change is a new revision.
--   refinery_artifact (id, user_id) UNIQUE
--                         the target of the composite foreign key below, so
--                         a revision can only ever hang off an artifact its
--                         own owner holds, whatever id a request sends.
--                         (Foreign-key checks do not go through row-level
--                         security, which is what makes the composite key
--                         the guard; same shape as 074's lane key.)
--
-- STATUS IN THE DATABASE. status is 'draft' or 'finished', written only by
-- the server after it re-ran the finish gate and measured the pages. A CHECK
-- refuses a 'finished' row whose page count is over its page limit, so an
-- over-long ordinary resume can never be stored as finished, whatever code
-- writes it. A NULL page_limit is the academic or clinical CV, which runs as
-- long as the true record (decision C1).
--
-- OWNERSHIP. Owner only, FORCE row-level security, the same policy shape as
-- 059 / 074 / 076 / 080, without UPDATE: a saved revision is never edited.
-- No staff path, no sharing scope, no view. The app role is REVOKEd first and
-- then given SELECT, INSERT, DELETE only; scripts/lib/restricted-grants.mjs
-- holds the same list so a later blanket grant cannot widen it. Deleting the
-- account cascades (users); deleting the artifact cascades (refinery_artifact).
-- "Delete my data" deletes the rows through the app, as the owner. The data
-- export includes every revision.
--
-- ADD ONLY and idempotent: one new table, one new UNIQUE constraint on
-- refinery_artifact. Nothing existing changes. Old code ignores both.
--
-- LOCKS. ALTER TABLE ... ADD CONSTRAINT ... UNIQUE takes an ACCESS EXCLUSIVE
-- lock on refinery_artifact (plus a SHARE lock while the index builds): reads
-- AND writes of that table wait until the transaction commits. The table is
-- small (one row per saved resume or letter), and the (uuid, uuid) index
-- builds in moments, so the block is brief. It cannot fail on data: id is the
-- primary key and user_id is NOT NULL, so no (id, user_id) pair can repeat.
-- lock_timeout bounds only the wait to GET the lock (5 seconds, then the file
-- gives up instead of queueing every resume request behind it; run it again).
-- If the table ever grows large, build the index first outside a transaction
-- (CREATE UNIQUE INDEX CONCURRENTLY refinery_artifact_id_user_key ON
-- refinery_artifact (id, user_id)) and this file then attaches it with
-- ADD CONSTRAINT ... UNIQUE USING INDEX, which holds the lock only briefly.
--
-- APPLY in ONE transaction (psql -1 -v ON_ERROR_STOP=1, or the runner's BEGIN),
-- BEFORE the code that reads artifact_revision deploys: /api/health/rls counts
-- this table and reports a problem while it is missing.
--
-- ROLLBACK, in this order:
--   1. Revert the revision CODE first and deploy that (the finish page, the
--      download route, quick-apply, the automatic email and the Refinery
--      workspace all read this table).
--   2. Rolling back LOSES every saved revision: the finished resume, its
--      letter and the confirmations behind them. Each person's latest Forge
--      run is still in forge_session, and the artifact itself is untouched.
--      Export first if anyone needs their revisions (Settings, export).
--   3. Then, as the owner role, in one transaction:
--        DROP TABLE IF EXISTS artifact_revision;
--        ALTER TABLE refinery_artifact DROP CONSTRAINT IF EXISTS refinery_artifact_id_user_key;
--        DELETE FROM _migrations WHERE filename = '081_artifact_revision.sql';
--   4. Data the code left behind (old code ignores all of it; tidy, not needed):
--        UPDATE refinery_artifact SET content = content - '_revision' WHERE content ? '_revision';
--      This removes the marker key the revision code writes into a resume's
--      content. Content the revision code REWROTE from a finished revision's
--      text (the account's Forge resume) stays as rewritten: there is no
--      earlier copy to go back to, and it holds the person's finished words.
--      Claims in forge_package_email_sent (079) for revisions that are gone
--      stay too; they are hashes only and stop nothing.

SET LOCAL lock_timeout = '5s';

-- Target of the composite foreign key (one row per id already: id is the PK).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refinery_artifact_id_user_key') THEN
    ALTER TABLE refinery_artifact ADD CONSTRAINT refinery_artifact_id_user_key UNIQUE (id, user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS artifact_revision (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id            UUID NOT NULL,
  -- 1, 2, 3 ... per artifact. Assigned by the insert itself (max + 1).
  revision_number        INTEGER NOT NULL CHECK (revision_number >= 1),
  -- Where it was saved from: the finish page, the import on sign-in, or an
  -- edit in the Refinery workspace.
  source                 TEXT NOT NULL CHECK (source IN ('forge_finish', 'forge_import', 'refinery_edit')),
  -- Which length rule applies (decision C1). Ordinary resumes are 'resume'.
  doc_kind               TEXT NOT NULL DEFAULT 'resume'
                           CHECK (doc_kind IN ('resume', 'cv_academic', 'cv_clinical', 'cv_international', 'artist_resume', 'performer_resume')),
  resume_text            TEXT NOT NULL CHECK (length(btrim(resume_text)) >= 1 AND length(resume_text) <= 60000),
  letter_text            TEXT NOT NULL DEFAULT '' CHECK (length(letter_text) <= 60000),
  -- The person's confirmations, exactly as the finish gate reads them.
  kept_terms             JSONB NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(kept_terms) = 'array' AND octet_length(kept_terms::text) <= 20000),
  confirmed_credentials  JSONB NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(confirmed_credentials) = 'array' AND octet_length(confirmed_credentials::text) <= 60000),
  -- Defend answers: "true as written", rewrites, cuts, and the title and
  -- scope answers ("Yes, that was my title", "Yes, I did this").
  defend_answers         JSONB NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(defend_answers) = 'array' AND octet_length(defend_answers::text) <= 400000),
  -- The rest of what the gate reads: the person's own words, the writer's
  -- documents as delivered, the second check's grounding, the licenses
  -- answer and rows, what a cut left behind, the inside-lines choice.
  evidence               JSONB NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 600000),
  checker_version        TEXT NOT NULL CHECK (length(checker_version) BETWEEN 1 AND 64),
  status                 TEXT NOT NULL CHECK (status IN ('draft', 'finished')),
  page_count             INTEGER NOT NULL CHECK (page_count BETWEEN 0 AND 99),
  -- The most pages this kind may run (1 or 2 for a resume, by the person's
  -- choice). NULL: no limit (academic and clinical CVs).
  page_limit             INTEGER CHECK (page_limit IS NULL OR page_limit BETWEEN 1 AND 99),
  length_choice          TEXT NOT NULL DEFAULT 'auto' CHECK (length_choice IN ('auto', 'one_page', 'two_pages')),
  -- What is left to fix, in plain words, as the server worked it out (the
  -- DRAFT file's to-do page). Empty when finished.
  open_items             JSONB NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(open_items) = 'array' AND octet_length(open_items::text) <= 40000),
  -- SHA-256 hex of everything above that defines the version. Saving the
  -- same thing twice returns the existing revision instead of a new one.
  content_hash           TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT artifact_revision_artifact_owner_fk
    FOREIGN KEY (artifact_id, user_id) REFERENCES refinery_artifact (id, user_id) ON DELETE CASCADE,
  CONSTRAINT artifact_revision_number_uniq UNIQUE (artifact_id, revision_number),
  -- Never "finished" over the page limit, and never "finished" with no page.
  CONSTRAINT artifact_revision_finished_fits
    CHECK (status <> 'finished' OR (page_count >= 1 AND (page_limit IS NULL OR page_count <= page_limit))),
  -- Finished means nothing left to fix.
  CONSTRAINT artifact_revision_finished_no_open
    CHECK (status <> 'finished' OR open_items = '[]'::jsonb),
  -- The page limit follows the kind (decisions D8 and C1), whatever code writes:
  -- a resume or international CV is 1 or 2 pages, a performer resume 1, an
  -- artist resume 1, 2 or 4, an academic or clinical CV has no limit.
  -- COALESCE, because a CHECK that evaluates to NULL would pass.
  CONSTRAINT artifact_revision_limit_by_kind CHECK (
    (doc_kind IN ('resume', 'cv_international') AND COALESCE(page_limit, 0) IN (1, 2))
    OR (doc_kind = 'performer_resume' AND COALESCE(page_limit, 0) = 1)
    OR (doc_kind = 'artist_resume' AND COALESCE(page_limit, 0) IN (1, 2, 4))
    OR (doc_kind IN ('cv_academic', 'cv_clinical') AND page_limit IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_artifact_revision_user_artifact
  ON artifact_revision (user_id, artifact_id, revision_number DESC);

-- Owner only: read, add, delete. No UPDATE policy (a revision is never edited).
DO $$
DECLARE t text := 'artifact_revision';
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
  REVOKE ALL ON artifact_revision FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON artifact_revision FROM smr_app;
    GRANT SELECT, INSERT, DELETE ON artifact_revision TO smr_app;
  END IF;
END $$;
