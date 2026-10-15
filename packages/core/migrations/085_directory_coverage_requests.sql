-- Minimal deduplicated owner research intake. No person, transcript, or resume.
-- Existing proposals and their decisions remain untouched. No research is launched.
CREATE UNIQUE INDEX directory_coverage_pending_key ON directory_proposal ((payload->>'coverage_key'))
 WHERE kind='geo_ticket' AND status='pending' AND payload->>'coverage_key' IS NOT NULL;
CREATE FUNCTION public.request_directory_coverage(p_state text,p_place text,p_category text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k text; result uuid; normalized text;
BEGIN
 IF nullif(current_setting('app.user_id',true),'') IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_state IS NULL OR p_category IS NULL OR p_reason IS NULL OR p_state !~ '^[A-Z]{2}$' OR p_place IS NULL OR length(trim(p_place)) NOT BETWEEN 1 AND 80 OR length(p_place)>80
    OR p_category NOT IN ('employers','shelter','food','clothing','safety','physical','mental','recovery','id_documents','legal_aid','expungement','courts','jobs','training','education','financial','community','faith','veterans','youth','transportation')
    OR p_reason NOT IN ('new_area','low_coverage','stale_listing','missing_prerequisite') THEN
  RAISE EXCEPTION 'Invalid coverage request';
 END IF;
 normalized := lower(regexp_replace(trim(p_place),'\s+',' ','g'));
 k := md5(p_state||'|'||normalized||'|'||p_category);
 INSERT INTO public.directory_proposal(kind,payload,proposed_by,reason)
 VALUES('geo_ticket',jsonb_build_object('coverage_key',k,'state',p_state,'place',normalized,'category',p_category,'gap',p_reason,'priority','normal'),'product_coverage',p_reason)
 ON CONFLICT ((payload->>'coverage_key')) WHERE kind='geo_ticket' AND status='pending' AND payload->>'coverage_key' IS NOT NULL
 DO UPDATE SET payload=directory_proposal.payload
 RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.request_directory_coverage(text,text,text,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='smr_app') THEN
 GRANT EXECUTE ON FUNCTION public.request_directory_coverage(text,text,text,text) TO smr_app;
 END IF;
END $$;
-- Rollback preserves requests: DROP FUNCTION public.request_directory_coverage(text,text,text,text);
-- DROP INDEX directory_coverage_pending_key;
