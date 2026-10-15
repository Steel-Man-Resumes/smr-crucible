-- Durable owner-only package delivery. Apply before code; no emails sent by migration.
-- Revert code first; dropping this queue cancels pending delivery, never documents.
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX IF NOT EXISTS artifact_revision_delivery_owner_key ON artifact_revision(id, user_id, artifact_id);
CREATE TABLE IF NOT EXISTS forge_package_delivery (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 artifact_id uuid NOT NULL,
 revision_id uuid NOT NULL,
 due_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
 attempts integer NOT NULL DEFAULT 0,
 last_result text,
 PRIMARY KEY(user_id, artifact_id),
 FOREIGN KEY(artifact_id, user_id) REFERENCES refinery_artifact(id, user_id) ON DELETE CASCADE,
 FOREIGN KEY(revision_id, user_id, artifact_id) REFERENCES artifact_revision(id, user_id, artifact_id) ON DELETE CASCADE
);
ALTER TABLE forge_package_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE forge_package_delivery FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS forge_package_delivery_owner ON forge_package_delivery;
CREATE POLICY forge_package_delivery_owner ON forge_package_delivery
 USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- Enqueue in the SAME transaction as every revision. A newer draft cancels a
-- pending finished delivery; any newer FINISHED version (Forge finish, import or
-- a finished Refinery edit) replaces the job without a browser, so the newest
-- finished document is what goes out.
CREATE OR REPLACE FUNCTION public.queue_finished_package() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF NEW.status = 'finished' THEN
  INSERT INTO public.forge_package_delivery(user_id, artifact_id, revision_id)
  VALUES(NEW.user_id, NEW.artifact_id, NEW.id)
  ON CONFLICT(user_id, artifact_id) DO UPDATE SET revision_id = EXCLUDED.revision_id,
   due_at = now() + interval '5 minutes', attempts = 0, last_result = NULL;
 ELSE
  DELETE FROM public.forge_package_delivery WHERE user_id = NEW.user_id AND artifact_id = NEW.artifact_id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS artifact_revision_queue_package ON artifact_revision;
CREATE TRIGGER artifact_revision_queue_package AFTER INSERT ON artifact_revision
 FOR EACH ROW EXECUTE FUNCTION public.queue_finished_package();
-- Cross-account scheduler sees identifiers only. Every document read and send
-- still runs through its owner and proven-address checks. No private content.
CREATE OR REPLACE FUNCTION public.package_delivery_due()
RETURNS TABLE(user_id uuid, artifact_id uuid, revision_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT user_id, artifact_id, revision_id FROM public.forge_package_delivery
 WHERE due_at <= now() ORDER BY due_at LIMIT 25 $$;
REVOKE ALL ON forge_package_delivery FROM PUBLIC;
REVOKE ALL ON FUNCTION public.package_delivery_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_finished_package() FROM PUBLIC;
-- Recover a crashed send only inside the provider's 24-hour idempotency window.
-- Historical claims remain delivered; new claims set delivered_at NULL.
ALTER TABLE forge_package_email_sent ADD COLUMN IF NOT EXISTS delivered_at timestamptz DEFAULT now();
ALTER TABLE forge_package_email_sent ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE forge_package_email_sent ADD COLUMN IF NOT EXISTS attempted_at timestamptz;
ALTER TABLE forge_package_email_sent ADD COLUMN IF NOT EXISTS payload_encrypted jsonb;
ALTER TABLE forge_package_email_sent DROP CONSTRAINT IF EXISTS package_payload_size;
ALTER TABLE forge_package_email_sent ADD CONSTRAINT package_payload_size CHECK (payload_encrypted IS NULL OR octet_length(payload_encrypted::text) <= 12000000);
DROP POLICY IF EXISTS forge_package_email_sent_update ON forge_package_email_sent;
CREATE POLICY forge_package_email_sent_update ON forge_package_email_sent FOR UPDATE
 USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
 WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON forge_package_delivery TO smr_app;
  GRANT UPDATE ON forge_package_email_sent TO smr_app;
  GRANT EXECUTE ON FUNCTION public.package_delivery_due() TO smr_app;
 END IF;
END $$;

-- Delete only expired transient payloads. Delivery history and uncertainty remain.
CREATE OR REPLACE FUNCTION public.purge_package_payloads() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ UPDATE public.forge_package_email_sent SET payload_encrypted = NULL
 WHERE payload_encrypted IS NOT NULL AND sent_at < now() - interval '24 hours' $$;
REVOKE ALL ON FUNCTION public.purge_package_payloads() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
  GRANT EXECUTE ON FUNCTION public.purge_package_payloads() TO smr_app;
 END IF;
END $$;
