-- 033_artifact_revisions.sql
-- Phase 1A: the immutable-revision model.
--
-- Doctrine: a LOCKED artifact is immutable. It is never edited in place again
-- (Phase 0.1's ARTIFACT_CONTENT_UPDATE_SQL already enforces that at the write
-- layer). A correction to a locked baseline, or a tailoring pass against it,
-- FORKS a new successor artifact instead -- the original stays exactly as it
-- was approved, and the fork carries lineage pointers back to it. This makes
-- "what did I actually send" and "what changed since I approved it" both
-- answerable from data instead of memory.
--
-- parent_artifact_id: the immediate artifact this one was forked from (one
--   hop up the chain). NULL for an artifact that was never forked.
-- origin_artifact_id: the ROOT of the whole lineage (the very first artifact
--   in the chain). Set once at fork time to COALESCE(parent.origin, parent.id)
--   so every artifact in a lineage -- no matter how many forks deep -- points
--   straight at the root without walking parent_artifact_id repeatedly.
-- content_hash: identity fingerprint of `content` at fork/write time, used for
--   fork dedupe and change detection. See forkArtifact()'s comment in
--   refineryArtifact.ts for why this is a SQL-computed md5, not app-level sha256.
-- approved_at: when the artifact was approved (locked). Locking IS the approval
--   act (see lockBaseline in refineryArtifact.ts); unlocking does not clear it,
--   so approval history survives an unlock/relock cycle.
-- creation_reason: free-text note on why this artifact/fork was created, e.g.
--   "tailor", "correction", "initial". Human-facing provenance, not a CHECK'd
--   enum -- reasons are expected to grow without a migration.
-- operation_key: caller-supplied idempotency key for a fork operation (e.g. a
--   request id). Paired with the partial unique index below, a concurrent
--   duplicate fork request for the same (user, parent, key) returns the first
--   fork instead of creating a second one.

ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS parent_artifact_id UUID REFERENCES refinery_artifact(id);
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS origin_artifact_id UUID REFERENCES refinery_artifact(id);
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS creation_reason TEXT;
ALTER TABLE refinery_artifact ADD COLUMN IF NOT EXISTS operation_key TEXT;

-- Concurrent-fork dedupe: at most one fork per (user, parent, operation_key)
-- when an operation_key is supplied. Rows with operation_key IS NULL (the
-- common case -- most forks have no idempotency key) are unconstrained.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uq_refinery_artifact_fork_op'
  ) THEN
    CREATE UNIQUE INDEX uq_refinery_artifact_fork_op
      ON refinery_artifact (user_id, parent_artifact_id, operation_key)
      WHERE operation_key IS NOT NULL;
  END IF;
END $$;

-- application_document: immutable "what did I actually send" snapshots. Each
-- row is a point-in-time copy of a document's content at the moment it was
-- attached to an application -- independent of whatever the source artifact
-- does afterward (fork, edit-if-unlocked, delete). artifact_id is a soft
-- pointer back to the source for provenance display only; ON DELETE SET NULL
-- so deleting an artifact never deletes the historical record of what was sent.
CREATE TABLE IF NOT EXISTS application_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES job_application(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES refinery_artifact(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  provenance TEXT NOT NULL,
  content_snapshot JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT application_document_type_values
    CHECK (document_type IN ('resume', 'cover_letter', 'disclosure_plan')),
  CONSTRAINT application_document_provenance_values
    CHECK (provenance IN ('baseline_as_is', 'fine_tuned', 'tailored'))
);

CREATE INDEX IF NOT EXISTS idx_application_document_application
  ON application_document (application_id);
CREATE INDEX IF NOT EXISTS idx_application_document_user
  ON application_document (user_id);

-- application_status_event: append-only status ledger. job_application.status
-- stays the current-state column; this table is the history of how it got
-- there, which countApplicationsSent() (and future funnel reporting) reads
-- instead of guessing from status alone.
CREATE TABLE IF NOT EXISTS application_status_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES job_application(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_status_event_application
  ON application_status_event (application_id);
CREATE INDEX IF NOT EXISTS idx_application_status_event_user_status
  ON application_status_event (user_id, to_status);
