-- 070: a relationship can run through a named outside partner.
--
-- Tier 2 ("a person validated it, and a relationship formed") mostly arrives
-- through people who place many workers: a workforce office, a reentry job
-- developer, a partner organization. 061 let those avenues name only a contact
-- at the employer or an access_code (a Refinery login code for a partner
-- organization). Recording a vouch from a workforce board that has no login
-- would have meant issuing one. 070 adds `via_org_id`: the partner, as a row in
-- employer_org (an ecosystem partner or a government body), so the vouch names
-- who gave it without creating any access.
--
-- Additive: existing rows and avenues are unchanged. A via-partner relationship
-- is live by the same rule as any other (active, confirmed within its cadence
-- plus 14 days); evidence on it is Certain only while it is live.

ALTER TABLE employer_relationship ADD COLUMN IF NOT EXISTS via_org_id UUID REFERENCES employer_org(id);
CREATE INDEX IF NOT EXISTS employer_relationship_via ON employer_relationship (via_org_id) WHERE via_org_id IS NOT NULL;

ALTER TABLE employer_relationship DROP CONSTRAINT IF EXISTS relationship_avenue_named;
ALTER TABLE employer_relationship ADD CONSTRAINT relationship_avenue_named CHECK (
     (avenue IN ('employer_contact', 'employer_signup') AND contact_id IS NOT NULL)
  OR (avenue = 'partner_org' AND (partner_org_id IS NOT NULL OR via_org_id IS NOT NULL))
  OR (avenue IN ('job_developer', 'workforce_office')
      AND (contact_id IS NOT NULL OR partner_org_id IS NOT NULL OR via_org_id IS NOT NULL)));

ALTER TABLE employer_relationship DROP CONSTRAINT IF EXISTS relationship_via_not_self;
ALTER TABLE employer_relationship ADD CONSTRAINT relationship_via_not_self CHECK (via_org_id IS NULL OR via_org_id <> org_id);

-- The partner must be an ecosystem partner or a government body, never another employer.
CREATE OR REPLACE FUNCTION public.employer_relationship_via_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.via_org_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM employer_org o WHERE o.id = NEW.via_org_id AND o.org_kind IN ('ecosystem_partner', 'government')) THEN
    RAISE EXCEPTION 'a relationship runs through an ecosystem partner or a government body, not another employer'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employer_relationship_via ON employer_relationship;
CREATE TRIGGER employer_relationship_via BEFORE INSERT OR UPDATE OF via_org_id ON employer_relationship
  FOR EACH ROW EXECUTE FUNCTION public.employer_relationship_via_guard();
