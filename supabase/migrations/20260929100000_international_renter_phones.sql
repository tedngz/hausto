-- Renters on any country's WhatsApp number (SPEC §1, §6).
--
-- Renters are often expats on their home number, and the +84-only check meant
-- their first message could not even create a renter row. Agents stay +84:
-- nothing here touches realtors. Replay-safe.

-- ── The column ──────────────────────────────────────────────────────────────
ALTER TABLE public.renters DROP CONSTRAINT IF EXISTS renters_phone_e164_format;
ALTER TABLE public.renters
  ADD CONSTRAINT renters_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$');

-- ── Invariant 4 in the ops thread ───────────────────────────────────────────
-- ops_request_thread() hides any number a renter types in a message, so an
-- operator (or the AI operator) cannot paste it into an agent's chat. It only
-- knew Vietnamese shapes. These two mirror privacy.ts and inbound.ts.

-- The number without its country code: +447700900123 -> 7700900123.
-- E.164 country codes are prefix-free: 1 and 7 are one digit, the listed ones
-- two, every other three. Mirrors nationalNumber() in _shared/whatsapp/inbound.ts.
CREATE OR REPLACE FUNCTION public.renter_national_number(_e164 text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _e164 IS NULL OR _e164 !~ '^\+[1-9][0-9]{6,14}$' THEN NULL
    WHEN substr(_e164, 2, 1) IN ('1', '7') THEN substr(_e164, 3)
    WHEN substr(_e164, 2, 2) IN (
      '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
      '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
      '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98'
    ) THEN substr(_e164, 4)
    ELSE substr(_e164, 5)
  END
$$;

-- Hide phone numbers in a renter's message: Vietnamese shapes (as before), any
-- number written with a country code, and the renter's own number however
-- they wrote it. Mirrors PHONE_SHAPED and INTERNATIONAL_SHAPED in privacy.ts.
CREATE OR REPLACE FUNCTION public.mask_phone_numbers(_body text, _renter_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _out text := coalesce(_body, '');
  _national text := public.renter_national_number(_renter_phone);
BEGIN
  _out := regexp_replace(_out, '(?<![0-9])(\+?84|0)[ .-]?[35789]([ .-]?[0-9]){8}(?![0-9])', '[number hidden]', 'g');
  _out := regexp_replace(_out, '(?<![0-9.,])(\+|00)[1-9]([ .-]?[0-9]){6,14}(?![0-9])', '[number hidden]', 'g');
  IF _national IS NOT NULL AND length(_national) >= 7 THEN
    -- Its digits with separators allowed between each, and the trunk 0 a
    -- renter dials at home: 07700 900123, 7700-900-123, (415) 555-0100.
    _out := regexp_replace(
      _out,
      '(?<![0-9])[(]?(0[ ().-]{0,2})?' || regexp_replace(_national, '([0-9])(?!$)', '\1[ ().-]{0,2}', 'g') || '(?![0-9])',
      '[number hidden]', 'g');
  END IF;
  RETURN _out;
END;
$$;

-- The live definition (20260925100000), with its mask moved into the helper.
CREATE OR REPLACE FUNCTION public.ops_request_thread(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _renter record;
  _last_in timestamptz;
  _consecutive int;
  _messages jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  SELECT r.phone_e164, r.service_window_expires_at, r.opted_out_at
    INTO _renter
    FROM public.viewing_requests vr
    JOIN public.renters r ON r.id = vr.renter_id
   WHERE vr.id = _request_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Counted per person, across requests, exactly as send.ts counts it.
  SELECT max(created_at) INTO _last_in
    FROM public.messages
   WHERE to_phone = _renter.phone_e164 AND direction = 'IN';

  SELECT count(*) INTO _consecutive
    FROM public.messages
   WHERE to_phone = _renter.phone_e164
     AND direction = 'OUT'
     AND created_at > coalesce(_last_in, '-infinity'::timestamptz);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'direction', m.direction,
           'body', public.mask_phone_numbers(m.body, _renter.phone_e164),
           'template_name', m.template_name,
           'status', m.status,
           'created_at', m.created_at,
           'sent_at', m.sent_at
         ) ORDER BY m.created_at), '[]'::jsonb)
    INTO _messages
    FROM public.messages m
   WHERE m.request_id = _request_id;

  RETURN jsonb_build_object(
    'window_expires_at', _renter.service_window_expires_at,
    'opted_out', _renter.opted_out_at IS NOT NULL,
    'consecutive_outbound', _consecutive,
    'messages', _messages
  );
END;
$function$;
