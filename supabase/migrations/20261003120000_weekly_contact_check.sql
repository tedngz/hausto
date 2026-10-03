-- The weekly realtor contact check (SPEC §1). Additive, replay-safe.
--
-- extract-phone reveals numbers with a remote browser, and batdongsan refuses
-- it: on 2026-10-03 every agent in `realtors` still dated from the 2026-09-11
-- backfill, and 96 of 184 active listings had no agent. A person's own
-- browser is not refused. So once a week a Claude Cowork scheduled task opens
-- the listings that still have no agent in the owner's Chrome, presses each
-- one's show-number button, and records what it finds through the two
-- functions below.
--
-- They are the whole of its write path, on purpose. A number goes through the
-- same checks every week rather than through SQL composed fresh each run: it
-- must be a Vietnamese mobile, it must start with the digits the listing's
-- mask shows, and it links an agent to the listing and nothing else. Request
-- state is untouched - an item in a live request is resolved by a person in
-- the console (RECORD_CONTACT), which is what the intake email asks for.

-- The digits a masked number shows, local form ("0775 924 ***" -> "0775924"),
-- or NULL when it shows fewer than six or is not masked.
CREATE OR REPLACE FUNCTION public.phone_mask_prefix(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH c AS (
    SELECT regexp_replace(split_part(coalesce(raw, ''), '*', 1), '[^0-9]', '', 'g') AS d,
           strpos(coalesce(raw, ''), '*') > 0 AS masked
  ), l AS (
    SELECT masked, CASE WHEN d LIKE '84%' THEN '0' || substring(d from 3) ELSE d END AS d FROM c
  )
  SELECT CASE WHEN masked AND d ~ '^0[35789][0-9]{4,7}$' THEN d END FROM l;
$$;

-- Every check, found or not. A listing that turned up nothing is left alone
-- for four weeks; one that was blocked is tried again next week.
CREATE TABLE IF NOT EXISTS public.contact_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES public.external_properties(id) ON DELETE CASCADE,
  -- FOUND: a number, linked. NOT_FOUND: the page had none. BLOCKED: a login,
  -- a bot check or an error stood in the way. GONE: the listing is down.
  result       text NOT NULL CHECK (result IN ('FOUND', 'NOT_FOUND', 'BLOCKED', 'GONE')),
  phone_e164   text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+84[35789][0-9]{8}$'),
  -- REVEAL: the listing's show-number button. PUBLISHED: printed on the
  -- listing. WEB_SEARCH: published in full elsewhere.
  found_via    text CHECK (found_via IS NULL OR found_via IN ('REVEAL', 'PUBLISHED', 'WEB_SEARCH')),
  evidence_url text,
  note         text CHECK (note IS NULL OR length(note) <= 500),
  checked_by   text NOT NULL,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((result = 'FOUND') = (phone_e164 IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_contact_checks_listing ON public.contact_checks (listing_id, checked_at DESC);

-- Agents' numbers. Written and read only through the functions below, which
-- the service role and the SQL connector reach; nobody else.
ALTER TABLE public.contact_checks ENABLE ROW LEVEL SECURITY;

-- What to check this week: active listings with no agent, places a renter has
-- asked for first, then the newest. Skips a listing checked in the last four
-- weeks that had no number or was gone.
CREATE OR REPLACE FUNCTION public.listings_missing_contact(_limit integer DEFAULT 40)
RETURNS TABLE (
  listing_id     uuid,
  source         text,
  source_url     text,
  title          text,
  signed_as      text,
  shows          text,
  visible_digits text,
  requested      boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT e.id,
         e.source,
         e.source_url,
         e.title,
         nullif(btrim(e.contact_name), ''),
         nullif(btrim(e.contact_phone), ''),
         public.phone_mask_prefix(e.contact_phone),
         EXISTS (SELECT 1 FROM public.request_items ri WHERE ri.listing_id = e.id AND ri.realtor_id IS NULL)
  FROM public.external_properties e
  WHERE e.is_active
    AND e.realtor_id IS NULL
    AND e.contact_phone_e164 IS NULL
    AND e.source_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.contact_checks c
      WHERE c.listing_id = e.id
        AND c.result IN ('NOT_FOUND', 'GONE')
        AND c.checked_at > now() - interval '28 days'
    )
  ORDER BY 8 DESC, e.created_at DESC
  LIMIT greatest(1, least(coalesce(_limit, 40), 100));
$$;

-- Record one check. Returns {ok, ...}; a refusal says why and writes nothing.
--
-- A found number links the agent to the listing (creating the agent if new,
-- filling a blank name, never overwriting one) and, where the source gave an
-- agent id, to that id - so every future listing from them resolves at
-- ingest. `in_live_request` tells the caller a renter is waiting on this
-- listing and a person must save the number on the request too.
CREATE OR REPLACE FUNCTION public.record_contact_check(
  _listing_id   uuid,
  _result       text,
  _phone        text DEFAULT NULL,
  _name         text DEFAULT NULL,
  _found_via    text DEFAULT NULL,
  _evidence_url text DEFAULT NULL,
  _note         text DEFAULT NULL,
  _checked_by   text DEFAULT 'COWORK'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _l       record;
  _e164    text;
  _prefix  text;
  _realtor uuid;
  _clean   text;
BEGIN
  SELECT id, source, source_agent_id, contact_phone, realtor_id INTO _l
  FROM public.external_properties WHERE id = _listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_listing');
  END IF;
  IF _result IS NULL OR _result NOT IN ('FOUND', 'NOT_FOUND', 'BLOCKED', 'GONE') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result must be FOUND, NOT_FOUND, BLOCKED or GONE');
  END IF;

  IF _result <> 'FOUND' THEN
    INSERT INTO public.contact_checks (listing_id, result, evidence_url, note, checked_by)
    VALUES (_listing_id, _result, _evidence_url, left(_note, 500), coalesce(_checked_by, 'COWORK'));
    RETURN jsonb_build_object('ok', true, 'recorded', _result);
  END IF;

  _e164 := public.normalize_vn_phone(_phone);
  IF _e164 IS NULL OR _e164 !~ '^\+84[35789][0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_vietnamese_mobile', 'phone', _phone);
  END IF;
  IF _found_via IS NULL OR _found_via NOT IN ('REVEAL', 'PUBLISHED', 'WEB_SEARCH') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'found_via must be REVEAL, PUBLISHED or WEB_SEARCH');
  END IF;

  -- The mask is a free validator: a number that does not start with the digits
  -- the listing shows is not this agent's - a misread, or the wrong tab.
  _prefix := public.phone_mask_prefix(_l.contact_phone);
  IF _prefix IS NOT NULL AND ('0' || substring(_e164 from 4)) NOT LIKE _prefix || '%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'does_not_fit_mask', 'listing_shows', _l.contact_phone);
  END IF;
  -- Off the listing itself, a number with no digits to check it against is a
  -- guess, and a wrong number is dialled from every listing that agent has.
  IF _prefix IS NULL AND _found_via = 'WEB_SEARCH' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'web_search_needs_visible_digits');
  END IF;
  IF _l.realtor_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_linked');
  END IF;

  -- A signature that names nobody is not a name.
  _clean := nullif(btrim(_name), '');
  IF lower(_clean) IN ('unknown', 'hotline', 'anh chị', 'anh chi', 'chính chủ', 'chinh chu', 'môi giới', 'moi gioi') THEN
    _clean := NULL;
  END IF;

  INSERT INTO public.realtors (phone_e164, display_name)
  VALUES (_e164, _clean)
  ON CONFLICT (phone_e164) DO UPDATE
    SET display_name = coalesce(public.realtors.display_name, EXCLUDED.display_name),
        updated_at = now()
  RETURNING id INTO _realtor;

  UPDATE public.external_properties SET realtor_id = _realtor
  WHERE id = _listing_id AND realtor_id IS NULL;

  IF _l.source_agent_id IS NOT NULL THEN
    INSERT INTO public.realtor_identities (realtor_id, source, source_agent_id)
    VALUES (_realtor, _l.source, _l.source_agent_id)
    ON CONFLICT (source, source_agent_id) DO NOTHING;
  END IF;

  INSERT INTO public.contact_checks (listing_id, result, phone_e164, found_via, evidence_url, note, checked_by)
  VALUES (_listing_id, 'FOUND', _e164, _found_via, _evidence_url, left(_note, 500), coalesce(_checked_by, 'COWORK'));

  RETURN jsonb_build_object(
    'ok', true,
    'recorded', 'FOUND',
    'phone_e164', _e164,
    'realtor_id', _realtor,
    'in_live_request', EXISTS (
      SELECT 1 FROM public.request_items ri WHERE ri.listing_id = _listing_id AND ri.realtor_id IS NULL
    )
  );
END;
$function$;

-- Not callable through the API by anyone signed in or not: these hand out and
-- write agents' numbers.
REVOKE ALL ON FUNCTION public.listings_missing_contact(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_contact_check(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listings_missing_contact(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_contact_check(uuid, text, text, text, text, text, text, text) TO service_role;
