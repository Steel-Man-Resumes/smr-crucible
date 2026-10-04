-- 071: Tier 3, working together to get people hired.
--
-- Troy's tiers (2026-10-02): Tier 1 is a public record. Tier 2 is a person
-- validating it with a relationship kept on schedule (Certain, 061 and 070).
-- Tier 3 is an active working agreement: the employer and Steel Man work
-- together to get people hired, and job seekers can apply through Steel Man.
--
-- A working agreement sits on top of a relationship: it needs a live Tier 2
-- relationship underneath, a receiving role channel at the employer (where
-- applications go), and activity inside its cadence. Activity is a dated,
-- never-edited record of what happened (a referral sent, a hire, a check-in),
-- counts only: it never holds anything about a person. Every tier fails
-- closed: no activity within cadence + 14 days, a lapsed relationship, a
-- receiving contact that opted out, or a place that no longer earns the mark,
-- and Tier 3 drops back by itself.
--
-- directory_tier_v gives each marked place its tier and the day it falls due,
-- for the public export. It is internal like employer_standing_v (the export
-- reads it as the owner); the app holds nothing on it.

CREATE TABLE IF NOT EXISTS employer_working_agreement (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES employer_org(id) ON DELETE CASCADE,
  place_id             UUID NOT NULL,
  relationship_id      UUID NOT NULL,
  receiving_contact_id UUID NOT NULL,
  started_on           DATE NOT NULL,
  cadence_days         INTEGER NOT NULL DEFAULT 90 CHECK (cadence_days BETWEEN 7 AND 365),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  terms_version        TEXT NOT NULL CHECK (length(btrim(terms_version)) >= 1),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, place_id) REFERENCES employer_place (org_id, id),
  FOREIGN KEY (org_id, relationship_id) REFERENCES employer_relationship (org_id, id),
  FOREIGN KEY (org_id, receiving_contact_id) REFERENCES employer_contact (org_id, id)
);
CREATE INDEX IF NOT EXISTS employer_working_agreement_place ON employer_working_agreement (place_id);

CREATE TABLE IF NOT EXISTS employer_agreement_activity (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  agreement_id UUID NOT NULL,
  occurred_on  DATE NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('referral_sent', 'application_sent', 'interview', 'hire', 'check_in')),
  item_count   INTEGER NOT NULL DEFAULT 1 CHECK (item_count BETWEEN 1 AND 1000),
  logged_by    TEXT NOT NULL CHECK (length(btrim(logged_by)) >= 2),
  note         TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, agreement_id) REFERENCES employer_working_agreement (org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS employer_agreement_activity_agreement ON employer_agreement_activity (agreement_id, occurred_on DESC);

-- Dates are never in the future (a trigger, as 061 does for evidence: a CHECK
-- may not depend on today's date), and an activity is written once. The
-- composite foreign keys already tie the relationship and the receiving
-- contact to the same employer as the place.
-- One function per table: PL/pgSQL resolves NEW.<field> even inside a branch
-- that does not run, so a shared function would fail on the other table.
CREATE OR REPLACE FUNCTION public.employer_working_agreement_date_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.started_on > current_date THEN
    RAISE EXCEPTION 'an agreement cannot start in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_working_agreement_dates ON employer_working_agreement;
CREATE TRIGGER employer_working_agreement_dates BEFORE INSERT OR UPDATE OF started_on ON employer_working_agreement
  FOR EACH ROW EXECUTE FUNCTION public.employer_working_agreement_date_guard();

CREATE OR REPLACE FUNCTION public.employer_agreement_activity_date_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.occurred_on > current_date THEN
    RAISE EXCEPTION 'activity cannot be dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_agreement_activity_dates ON employer_agreement_activity;
CREATE TRIGGER employer_agreement_activity_dates BEFORE INSERT ON employer_agreement_activity
  FOR EACH ROW EXECUTE FUNCTION public.employer_agreement_activity_date_guard();

CREATE OR REPLACE FUNCTION public.employer_agreement_activity_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'agreement activity is a dated record; it is never edited' USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS employer_agreement_activity_immutable ON employer_agreement_activity;
CREATE TRIGGER employer_agreement_activity_immutable BEFORE UPDATE ON employer_agreement_activity
  FOR EACH ROW EXECUTE FUNCTION public.employer_agreement_activity_guard();

-- Live = active, its relationship live (061/070), its receiving contact still
-- reachable, and activity within cadence + 14 days.
CREATE OR REPLACE FUNCTION public.directory_agreement_is_live(agr_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM employer_working_agreement a
      JOIN employer_contact c ON c.id = a.receiving_contact_id
     WHERE a.id = agr_id AND a.status = 'active' AND c.can_contact
       AND public.directory_relationship_is_live(a.relationship_id)
       AND (SELECT max(x.occurred_on) FROM employer_agreement_activity x WHERE x.agreement_id = a.id)
           + a.cadence_days + 14 >= current_date)
$$;

CREATE OR REPLACE VIEW directory_tier_v WITH (security_barrier = true) AS
WITH agr AS (
  SELECT a.place_id,
         max((SELECT max(x.occurred_on) FROM employer_agreement_activity x WHERE x.agreement_id = a.id) + a.cadence_days) AS tier3_due
    FROM employer_working_agreement a
   WHERE public.directory_agreement_is_live(a.id)
   GROUP BY a.place_id
), rel AS (
  SELECT r.place_id, max((SELECT max(c.confirmed_on) FROM employer_relationship_confirmation c WHERE c.relationship_id = r.id) + r.cadence_days) AS tier2_due
    FROM employer_relationship r
   WHERE r.place_id IS NOT NULL AND public.directory_relationship_is_live(r.id)
   GROUP BY r.place_id
)
SELECT s.place_id, s.org_id,
       CASE WHEN agr.place_id IS NOT NULL AND s.confidence = 'certain' THEN 3
            WHEN s.confidence = 'certain' THEN 2
            ELSE 1 END AS tier,
       CASE WHEN agr.place_id IS NOT NULL AND s.confidence = 'certain' THEN agr.tier3_due
            WHEN s.confidence = 'certain' THEN rel.tier2_due END AS tier_due
  FROM employer_standing_v s
  LEFT JOIN agr ON agr.place_id = s.place_id
  LEFT JOIN rel ON rel.place_id = s.place_id
 WHERE s.earns_mark;

-- Row-level security and grants, exactly as 061 does for the directory.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employer_working_agreement', 'employer_agreement_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE USING (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
                                                 WITH CHECK (EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))$p$, t || '_admin_update', t);
  END LOOP;
END $$;

DO $$
BEGIN
  REVOKE ALL ON employer_working_agreement, employer_agreement_activity, directory_tier_v FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smr_app') THEN
    REVOKE ALL ON employer_working_agreement, employer_agreement_activity, directory_tier_v FROM smr_app;
    GRANT SELECT, INSERT, UPDATE ON employer_working_agreement TO smr_app;
    -- An activity is a dated record of a fact; it is never edited.
    GRANT SELECT, INSERT ON employer_agreement_activity TO smr_app;
  END IF;
END $$;
