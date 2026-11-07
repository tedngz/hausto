-- A number the owner typed into the contact sheet is taken as given.
--
-- The mask check exists to catch a misread or the wrong tab in an unattended
-- run. When the owner has checked the agent directly - who may have changed the
-- number on an ad that still shows the old mask - refusing it only leaves the
-- listing without an agent. Same signature, so callers and grants are unchanged.
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
  -- the listing shows is not this agent's - a misread, or the wrong tab. The
  -- owner's own entry in the sheet is the exception: it has been checked.
  _prefix := public.phone_mask_prefix(_l.contact_phone);
  IF _prefix IS NOT NULL AND coalesce(_checked_by, 'COWORK') <> 'TED_SHEET'
     AND ('0' || substring(_e164 from 4)) NOT LIKE _prefix || '%' THEN
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

REVOKE ALL ON FUNCTION public.record_contact_check(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_check(uuid, text, text, text, text, text, text, text) TO service_role;
