-- The receipt for a renter's request (agent-act.ts REQUEST_RECEIVED, 2026-10-08)
-- answers their own first WhatsApp message at once, so send.ts does not count
-- it towards three messages in a row (ACKNOWLEDGEMENT_PURPOSES). The console's
-- count has to agree, or it would block a reply the send service allows.
--
-- Identical to the live definition apart from the one condition marked below.

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
     AND created_at > coalesce(_last_in, '-infinity'::timestamptz)
     -- An acknowledgement answers the renter's message; not one of ours in a row.
     AND split_part(idempotency_key, ':', 2) <> 'REQUEST_RECEIVED';

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
