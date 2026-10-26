-- Applied directly to production at 2026-10-24 15:40 UTC, outside any branch;
-- this file records it so `supabase db push` stops failing with "Remote migration
-- versions not found in local migrations directory" (run 40301647834, the merge
-- of #227). The statements are the ones stored in
-- supabase_migrations.schema_migrations for this version, unchanged: IF NOT
-- EXISTS and CREATE OR REPLACE throughout, so a replay is harmless.
--
-- auto_link_name_matches() here replaces the one in
-- 20261022094721_auto_link_name_matches_fix_ambiguity.sql, adding the aliases
-- to the names it matches on; the live definition reads realtor_aliases.

SET lock_timeout = '20s';

-- Other names a realtor signs listings with ("Trung Dương" is also
-- "Chuyên trang cho thuê căn hộ của Bình"). Filled from Ted's sheet notes.
CREATE TABLE IF NOT EXISTS public.realtor_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realtor_id uuid NOT NULL REFERENCES public.realtors(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (length(btrim(alias)) BETWEEN 1 AND 200),
  added_by text NOT NULL DEFAULT 'TED_SHEET',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS realtor_aliases_realtor_alias_uniq
  ON public.realtor_aliases (realtor_id, lower(btrim(alias)));
ALTER TABLE public.realtor_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.realtor_aliases FROM anon, authenticated;

-- Adds a name to a realtor: fills display_name if it is empty or generic,
-- otherwise records it as an alias. Ignores blanks, masks and generic words.
CREATE OR REPLACE FUNCTION public.add_realtor_name(_realtor_id uuid, _name text, _added_by text DEFAULT 'TED_SHEET')
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _n text := nullif(btrim(_name), '');
  _generic text[] := ARRAY['unknown','hotline','anh chị','anh chi','chính chủ','chinh chu','môi giới','moi gioi','owner','chủ nhà','chu nha'];
  _cur text;
BEGIN
  IF _realtor_id IS NULL OR _n IS NULL OR _n ~ '[*]' OR _n !~ '[[:alpha:]]' OR lower(_n) = ANY(_generic) THEN
    RETURN 'skipped';
  END IF;
  SELECT display_name INTO _cur FROM public.realtors WHERE id = _realtor_id;
  IF NOT FOUND THEN RETURN 'unknown_realtor'; END IF;
  IF _cur IS NULL OR btrim(_cur) = '' OR lower(btrim(_cur)) = ANY(_generic) OR _cur ~ '[*]' THEN
    UPDATE public.realtors SET display_name = _n, updated_at = now() WHERE id = _realtor_id;
    RETURN 'display_name';
  END IF;
  IF lower(btrim(_cur)) = lower(_n) THEN RETURN 'same_as_display'; END IF;
  INSERT INTO public.realtor_aliases (realtor_id, alias, added_by) VALUES (_realtor_id, _n, coalesce(_added_by,'TED_SHEET'))
  ON CONFLICT DO NOTHING;
  RETURN 'alias';
END;
$function$;
REVOKE ALL ON FUNCTION public.add_realtor_name(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Name matching now also accepts any recorded alias.
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
        UNION
        SELECT a.alias FROM public.realtor_aliases a WHERE a.realtor_id = u.rid
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
