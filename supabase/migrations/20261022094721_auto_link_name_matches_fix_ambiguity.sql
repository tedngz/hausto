-- Applied directly to production at 2026-10-22 09:47 UTC, outside any branch;
-- this file records it (see 20261022094703_auto_link_name_matches.sql). The
-- statements are the ones stored in supabase_migrations.schema_migrations for
-- this version, and match pg_get_functiondef of the live function.
--
-- Renames the CTE columns (sig, shw, pfx) and qualifies realtors/external_properties
-- references so they no longer clash with the function's OUT parameters
-- (signed_as, shows, realtor_id, ...), which made PL/pgSQL report them ambiguous.

CREATE OR REPLACE FUNCTION public.auto_link_name_matches(_dry_run boolean DEFAULT true)
RETURNS TABLE(listing_id uuid, signed_as text, shows text, realtor_id uuid, phone_e164 text, realtor_name text, applied boolean)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
BEGIN
  FOR _r IN
    WITH l AS (
      SELECT e.id, e.source, e.source_agent_id, e.source_url,
             nullif(btrim(e.contact_name), '') AS sig,
             e.contact_phone AS shw,
             public.phone_mask_prefix(e.contact_phone) AS pfx
      FROM public.external_properties e
      WHERE e.is_active AND e.realtor_id IS NULL AND e.contact_phone_e164 IS NULL
    ),
    usable AS (
      SELECT * FROM l
      WHERE l.pfx IS NOT NULL AND length(l.pfx) >= 6
        AND l.sig IS NOT NULL AND l.sig !~ '[0-9*]'
        AND lower(l.sig) NOT IN ('unknown','hotline','anh chị','anh chi','chính chủ','chinh chu','môi giới','moi gioi','owner','chủ nhà','chu nha')
    ),
    cand AS (
      SELECT u.*, r.id AS rid, r.phone_e164 AS rphone, r.display_name AS rname
      FROM usable u
      JOIN public.realtors r ON ('0' || substring(r.phone_e164 from 4)) LIKE u.pfx || '%'
    ),
    uniq AS (
      SELECT c.* FROM cand c
      WHERE (SELECT count(*) FROM cand c2 WHERE c2.id = c.id) = 1
    )
    SELECT u.* FROM uniq u
    WHERE EXISTS (
      SELECT 1 FROM (
        SELECT r2.display_name AS n FROM public.realtors r2 WHERE r2.id = u.rid
        UNION
        SELECT ep.contact_name FROM public.external_properties ep WHERE ep.realtor_id = u.rid
      ) names
      WHERE names.n IS NOT NULL AND names.n !~ '[0-9*]'
        AND lower(btrim(names.n)) = lower(u.sig)
    )
  LOOP
    IF NOT _dry_run THEN
      UPDATE public.external_properties ep SET realtor_id = _r.rid
      WHERE ep.id = _r.id AND ep.realtor_id IS NULL;

      IF _r.source_agent_id IS NOT NULL THEN
        INSERT INTO public.realtor_identities (realtor_id, source, source_agent_id)
        VALUES (_r.rid, _r.source, _r.source_agent_id)
        ON CONFLICT (source, source_agent_id) DO NOTHING;
      END IF;

      INSERT INTO public.contact_checks (listing_id, result, phone_e164, found_via, evidence_url, note, checked_by)
      VALUES (_r.id, 'FOUND', _r.rphone, 'NAME_MATCH', _r.source_url,
              left('Same name "' || _r.sig || '" and visible digits ' || _r.pfx || ' match a known realtor', 500),
              'AUTO_NAME_MATCH');
    END IF;

    listing_id := _r.id; signed_as := _r.sig; shows := _r.shw;
    realtor_id := _r.rid; phone_e164 := _r.rphone; realtor_name := _r.rname;
    applied := NOT _dry_run;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_name_matches(boolean) FROM PUBLIC, anon, authenticated;
