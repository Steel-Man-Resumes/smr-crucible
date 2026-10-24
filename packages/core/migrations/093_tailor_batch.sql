-- Multi-job tailoring: one claim per job per batch, so a retry, a second tab
-- or a duplicated tab never runs (or charges) the generator twice for the same
-- job, and a finished job is found again without scanning resumes.
-- Additive only. Apply before the code that uses it (the route fails closed,
-- with a plain line, while the table is missing). Production apply waits for Troy.
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS tailor_batch_claim (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 batch_key text NOT NULL CHECK (batch_key ~ '^[0-9a-f-]{36}:[0-2]$'),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','failed','generated','saved')),
 attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 50),
 artifact_id uuid,
 application_id uuid,
 -- A finished generation whose save failed, encrypted in the app, kept only
 -- until the save lands (then cleared). Never read by anyone but the owner.
 pending_encrypted jsonb CHECK (pending_encrypted IS NULL OR octet_length(pending_encrypted::text) <= 1000000),
 claimed_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY (user_id, batch_key)
);
ALTER TABLE tailor_batch_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailor_batch_claim FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tailor_batch_claim_owner ON tailor_batch_claim;
CREATE POLICY tailor_batch_claim_owner ON tailor_batch_claim
 USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
REVOKE ALL ON tailor_batch_claim FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON tailor_batch_claim TO smr_app;
 END IF;
END $$;

-- Retention: a result that never saved (or a try that failed or was abandoned)
-- is kept at most 7 days, then deleted with its encrypted copy. Same owner-side
-- pattern as 087's purge_finished_ai_operations: the daily purge cron calls it,
-- the application role only chooses the age (7 days minimum). Saved claims hold
-- no document content and stay as the batch's idempotency record.
CREATE OR REPLACE FUNCTION public.purge_stale_tailor_claims(keep_days integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF keep_days IS NULL OR keep_days < 7 THEN RAISE EXCEPTION 'purge keeps at least 7 days'; END IF;
  DELETE FROM public.tailor_batch_claim WHERE status <> 'saved' AND claimed_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_stale_tailor_claims(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    GRANT EXECUTE ON FUNCTION public.purge_stale_tailor_claims(integer) TO smr_app;
  END IF;
END $$;
