-- Applied directly to production at 2026-10-22 09:47 UTC, outside any branch;
-- this file records it so `supabase db push` stops failing with "Remote migration
-- versions not found in local migrations directory". The statements are the ones
-- stored in supabase_migrations.schema_migrations for this version, with the
-- constraint drop made IF EXISTS so a replay is harmless.
--
-- Adds NAME_MATCH to contact_checks.found_via, and auto_link_name_matches(), which
-- links listings with a masked phone to a known realtor by visible digits + name.
-- Its first version has OUT parameters that collide with column names;
-- 20261022094721_auto_link_name_matches_fix_ambiguity.sql replaces it.

ALTER TABLE public.contact_checks DROP CONSTRAINT IF EXISTS contact_checks_found_via_check;
ALTER TABLE public.contact_checks ADD CONSTRAINT contact_checks_found_via_check
  CHECK (found_via IS NULL OR found_via = ANY (ARRAY['REVEAL','PUBLISHED','WEB_SEARCH','NAME_MATCH']));

-- Links listings with a masked phone to an existing realtor when BOTH hold:
--  * the listing's visible digits (>= 6) are a prefix of exactly one known realtor number
--  * the listing is signed with a name that realtor already uses (display name or a
--    name on one of their linked listings), compared case-insensitively.
-- Names that are blank, generic, or contain digits / asterisks never count as a match.
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
             nullif(btrim(e.contact_name), '') AS signed_as,
             e.contact_phone AS shows,
             public.phone_mask_prefix(e.contact_phone) AS prefix
      FROM public.external_properties e
      WHERE e.is_active AND e.realtor_id IS NULL AND e.contact_phone_e164 IS NULL
    ),
    usable AS (
      SELECT * FROM l
      WHERE prefix IS NOT NULL AND length(prefix) >= 6
        AND signed_as IS NOT NULL AND signed_as !~ '[0-9*]'
        AND lower(signed_as) NOT IN ('unknown','hotline','anh chị','anh chi','chính chủ','chinh chu','môi giới','moi gioi','owner','chủ nhà','chu nha')
    ),
    cand AS (
      SELECT u.*, r.id AS rid, r.phone_e164 AS rphone, r.display_name AS rname
      FROM usable u
      JOIN public.realtors r ON ('0' || substring(r.phone_e164 from 4)) LIKE u.prefix || '%'
    ),
    uniq AS (
      SELECT c.* FROM cand c
      WHERE (SELECT count(*) FROM cand c2 WHERE c2.id = c.id) = 1
    )
    SELECT u.* FROM uniq u
    WHERE EXISTS (
      SELECT 1 FROM (
        SELECT r.display_name AS n FROM public.realtors r WHERE r.id = u.rid
        UNION
        SELECT ep.contact_name FROM public.external_properties ep WHERE ep.realtor_id = u.rid
      ) names
      WHERE names.n IS NOT NULL AND names.n !~ '[0-9*]'
        AND lower(btrim(names.n)) = lower(u.signed_as)
    )
  LOOP
    IF NOT _dry_run THEN
      UPDATE public.external_properties SET realtor_id = _r.rid
      WHERE id = _r.id AND realtor_id IS NULL;

      IF _r.source_agent_id IS NOT NULL THEN
        INSERT INTO public.realtor_identities (realtor_id, source, source_agent_id)
        VALUES (_r.rid, _r.source, _r.source_agent_id)
        ON CONFLICT (source, source_agent_id) DO NOTHING;
      END IF;

      INSERT INTO public.contact_checks (listing_id, result, phone_e164, found_via, evidence_url, note, checked_by)
      VALUES (_r.id, 'FOUND', _r.rphone, 'NAME_MATCH', _r.source_url,
              left('Same name "' || _r.signed_as || '" and visible digits ' || _r.prefix || ' match a known realtor', 500),
              'AUTO_NAME_MATCH');
    END IF;

    listing_id := _r.id; signed_as := _r.signed_as; shows := _r.shows;
    realtor_id := _r.rid; phone_e164 := _r.rphone; realtor_name := _r.rname;
    applied := NOT _dry_run;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_link_name_matches(boolean) FROM PUBLIC, anon, authenticated;
