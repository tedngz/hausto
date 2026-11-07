-- An agent an operator found must not reach a renter through a listing
-- (CLAUDE.md invariant 4, SPEC §6).
--
-- sync_listing_phones_from_realtors() copied any linked realtor's number onto
-- the listing's contact_phone, and reveal_listing_contact() serves that column
-- to "Call the agent yourself". RECORD_CONTACT links the listing it was saved
-- on (ops-actions.ts, recordContact), so a number an operator got on Zalo
-- became the ad's number. auto_link_name_matches() then spread it to the same
-- agent's other ads. On 2026-11-07 that was 6 live listings across 2 agents,
-- none of them revealed yet.
--
-- The rule both now share: a realtor's number is publishable when it was seen
-- on an ad, or when no operator path ever touched that realtor before it was
-- on file. Everything else stays with Hausto.

SET lock_timeout = '20s';

CREATE OR REPLACE FUNCTION public.realtor_number_is_public(_realtor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT id, phone_e164, created_at FROM public.realtors WHERE id = _realtor_id
  ),
  -- The first time an operator path met this realtor: "Save contact" on a
  -- request, a building roster, or a building / Priority search step.
  touched AS (
    SELECT least(
      (SELECT min(e.occurred_at) FROM public.events e
        WHERE e.type = 'REALTOR_RESOLVED' AND e.payload->>'realtor_id' = _realtor_id::text),
      (SELECT min(ca.created_at) FROM public.complex_agents ca WHERE ca.realtor_id = _realtor_id),
      (SELECT min(ie.occurred_at) FROM public.inquiry_events ie
        WHERE ie.payload->>'realtor_id' = _realtor_id::text)
    ) AS at
  )
  SELECT
    -- Seen on an ad: revealed, printed or found beside the ad's own digits.
    -- NAME_MATCH is not evidence; it is a guess built on another number.
    EXISTS (
      SELECT 1 FROM public.contact_checks c, r
      WHERE c.phone_e164 = r.phone_e164 AND c.result = 'FOUND'
        AND c.found_via IN ('REVEAL', 'PUBLISHED', 'WEB_SEARCH')
    )
    -- Imported only where it starts with the ad's mask.
    OR EXISTS (
      SELECT 1 FROM public.realtor_contact_imports i, r WHERE i.phone_e164 = r.phone_e164
    )
    -- Never touched by an operator, or on file (from a crawl) before the first
    -- touch. upsertRealtor keeps created_at on an existing row; the minute
    -- covers an insert and its event landing a few milliseconds apart.
    OR EXISTS (
      SELECT 1 FROM r, touched t
      WHERE t.at IS NULL OR r.created_at < t.at - interval '1 minute'
    );
$function$;

REVOKE ALL ON FUNCTION public.realtor_number_is_public(uuid) FROM PUBLIC, anon, authenticated;

-- Replaces 20261022104629_sync_listing_phones_from_realtors.sql: the same copy,
-- for public numbers only.
CREATE OR REPLACE FUNCTION public.sync_listing_phones_from_realtors()
RETURNS TABLE(listing_id uuid, phone_e164 text)
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  UPDATE public.external_properties ep
  SET contact_phone = '0' || substring(r.phone_e164 from 4),
      updated_at = now()
  FROM public.realtors r
  WHERE ep.realtor_id = r.id
    AND ep.contact_phone_e164 IS NULL
    AND r.phone_e164 ~ '^\+84[0-9]{9}$'
    AND public.realtor_number_is_public(r.id)
  RETURNING ep.id, r.phone_e164;
$function$;

REVOKE ALL ON FUNCTION public.sync_listing_phones_from_realtors() FROM PUBLIC, anon, authenticated;

-- Replaces the definition in 20261024154023_realtor_aliases.sql: candidates
-- are realtors whose number is public, so a private one is not linked onto
-- more ads and then copied by the sync above.
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
      WHERE public.realtor_number_is_public(r.id)
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
