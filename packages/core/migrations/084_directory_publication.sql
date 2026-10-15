-- Versioned, narrow public projections. No service is activated by this migration.
-- Install with an owner after preview isolation/security verification.
-- Rollback: remove the three *_publication_v views and their *_publication_rows
-- functions, then directory_publication_alias (only after preserving reviewed mappings).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN
  RAISE EXCEPTION 'publication projections require a BYPASSRLS owner';
 END IF;
END $$;

-- Explicit mappings only. Owner reviews source IDs; names never establish identity.
CREATE TABLE directory_publication_alias (
 source_system text NOT NULL CHECK (source_system IN ('website','airtable','employer_intel')),
 external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 160),
 place_id uuid NOT NULL REFERENCES employer_place(id),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_system, external_id)
);
REVOKE ALL ON directory_publication_alias FROM PUBLIC;
ALTER TABLE directory_publication_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_publication_alias FORCE ROW LEVEL SECURITY;

CREATE FUNCTION public.employer_publication_rows()
RETURNS TABLE(id uuid, name text, industry text, state text, city text, location text,
 apply_url text, role_types text, evidence text, caveats text, checked_at date,
 expires_at date, source_url text, relationship_tier text, scope text, standing text, version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT p.place_id, p.canonical_name, p.industry, p.state, p.city,
 concat_ws(', ',coalesce(p.city,p.county),p.state), coalesce(p.careers_url,p.website),
 ev.role_title, ev.excerpt, ev.limitations, ev.observed_on, ev.expires_on, ev.source_url,
 CASE WHEN t.tier IN (1,2,3) THEN 'T'||t.tier::text END, p.place_kind, p.standing,
 md5(concat_ws('|',p.place_id::text,p.canonical_name,p.industry,p.state,p.city,p.county,
 p.careers_url,p.website,p.standing,t.tier::text,ev.id::text,ev.observed_on::text,
 ev.expires_on::text,ev.source_url,ev.excerpt,ev.limitations,ev.role_title))
 FROM public.directory_public_v p
 LEFT JOIN public.directory_tier_v t ON t.place_id=p.place_id
 JOIN LATERAL (
  SELECT e.* FROM public.directory_public_evidence_v e
  WHERE e.org_id=p.org_id AND EXISTS (SELECT 1 FROM public.directory_place_evidence pe WHERE pe.target_place_id=p.place_id AND pe.id=e.id)
    AND e.polarity='yes' AND e.expires_on > (now() AT TIME ZONE 'UTC')::date
    AND e.source_url IS NOT NULL AND e.source_kind <> 'casework_aggregate'
  ORDER BY e.observed_on DESC,e.id LIMIT 1
 ) ev ON true
 WHERE p.earns_mark OR p.standing='says_yes_for_roles';
END;
CREATE VIEW employer_publication_v WITH (security_barrier=true) AS SELECT * FROM public.employer_publication_rows();

CREATE FUNCTION public.resource_publication_rows()
RETURNS TABLE(service_id uuid, org_name text, service_name text, description text, eligibility text,
 area_id text, area_label text, geo_scope text, state text, county text, counties text[],city text,
 address text,zip text,phone text,hours text,website text,source_url text,last_checked date,
 fees text,what_to_bring text,limits text,expires_on date,verification_tier text,version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT p.service_id,p.org_name,p.service_name,p.description,p.eligibility,p.area_id,a.label,
 p.geo_scope,p.state,p.county,p.counties,p.city,p.address,p.zip,p.phone,p.hours,p.website,
 p.source_url,p.verified_on,p.fees,p.what_to_bring,p.limits,p.expires_on,t.tier,
 md5(row(p.service_id,p.org_name,p.service_name,p.description,p.eligibility,p.area_id,
 p.geo_scope,p.state,p.county,p.counties,p.city,p.address,p.zip,p.phone,p.hours,p.website,
 p.source_url,p.verified_on,p.fees,p.what_to_bring,p.limits,p.expires_on,t.tier)::text)
 FROM public.resource_public_v p JOIN public.resource_area a ON a.area_id=p.area_id
 JOIN public.resource_service_tier_v t ON t.service_id=p.service_id
 WHERE p.expires_on > (now() AT TIME ZONE 'UTC')::date;
END;
CREATE VIEW resource_publication_v WITH (security_barrier=true) AS SELECT * FROM public.resource_publication_rows();

CREATE FUNCTION public.resource_chain_publication_rows()
RETURNS TABLE(chain_key text,state text,goal text,unlocks text[],verified_on date,expires_on date,
 n integer,action text,agency text,requires text[],cost text,wait_time text,where_how text,url text,
 phone text,no_docs_fallback text,fee_waiver text,source_url text,step_verified_on date,version text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT p.chain_key,p.state,p.goal,p.unlocks,p.verified_on,p.expires_on,p.n,p.action,p.agency,
 p.requires,p.cost,p.wait_time,p.where_how,p.url,p.phone,p.no_docs_fallback,p.fee_waiver,
 p.source_url,p.step_verified_on,md5(row(p.*)::text)
 FROM public.resource_chain_public_v p
 WHERE p.expires_on > (now() AT TIME ZONE 'UTC')::date;
END;
CREATE VIEW resource_chain_publication_v WITH (security_barrier=true) AS SELECT * FROM public.resource_chain_publication_rows();

CREATE FUNCTION public.resolve_employer_publication_alias(source text, external text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
BEGIN ATOMIC
 SELECT a.place_id FROM public.directory_publication_alias a
 JOIN public.employer_publication_v p ON p.id=a.place_id
 WHERE a.source_system=source AND a.external_id=external;
END;
REVOKE ALL ON employer_publication_v,resource_publication_v,resource_chain_publication_v FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employer_publication_rows(),public.resource_publication_rows(),
 public.resource_chain_publication_rows(),public.resolve_employer_publication_alias(text,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='smr_app') THEN
  REVOKE ALL ON directory_publication_alias FROM smr_app;
  GRANT SELECT ON employer_publication_v,resource_publication_v,resource_chain_publication_v TO smr_app;
  GRANT EXECUTE ON FUNCTION public.employer_publication_rows(),public.resource_publication_rows(),
   public.resource_chain_publication_rows(),public.resolve_employer_publication_alias(text,text) TO smr_app;
 END IF;
END $$;
