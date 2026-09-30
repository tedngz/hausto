-- Offers stay inside what the renter asked for (the offer checks after S7.1).
--
-- An agent asked about a 2-bedroom under 20m will pitch a 3-bedroom at 35m.
-- INQUIRY_OFFER_UNITS now refuses any unit outside the brief; the renter
-- widens it by saying so on the thread, and the operator records that as
-- BRIEF_CHANGED against the renter's message. This migration:
--
--   1. allows BRIEF_CHANGED in inquiry_events;
--   2. rebuilds ops_inquiry_detail so "on file that fits" uses the brief in
--      force (the latest BRIEF_CHANGED, else the form) with the offer's 10%
--      budget tolerance, rather than the form's strict one, and lists the
--      renter's other recent requests ('siblings': ids and building names
--      only) so one offer can cover several buildings;
--   3. lets one WhatsApp message sit on several threads - that offer - by
--      making whatsapp_message_id unique per thread rather than overall.
--
-- Replay-safe: the constraint and index are dropped and re-added, the
-- function replaced.

ALTER TABLE public.inquiry_events DROP CONSTRAINT IF EXISTS inquiry_events_type_check;
ALTER TABLE public.inquiry_events ADD CONSTRAINT inquiry_events_type_check CHECK (type IN (
  'SUBMITTED', 'CONFIRMED', 'AGENT_ASKED', 'AGENT_ANSWERED', 'UNIT_CAPTURED', 'UNITS_OFFERED',
  'BRIEF_CHANGED', 'CLOSED', 'REOPENED'
));

-- Still a no-op for a redelivered message on the same thread, which is what
-- recordInquiryMessage relies on; now the same message may be on two.
DROP INDEX IF EXISTS public.idx_complex_inquiry_messages_whatsapp;
CREATE UNIQUE INDEX IF NOT EXISTS idx_complex_inquiry_messages_whatsapp
  ON public.complex_inquiry_messages (inquiry_id, whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ops_inquiry_detail(_inquiry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _i record;
  _renter record;
  _last_in timestamptz;
  _consecutive int := 0;
  _beds int[];
  _budget bigint;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _i FROM public.complex_inquiries WHERE id = _inquiry_id AND channel = 'WHATSAPP';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- What may be offered: the form's brief, unless the renter has since changed
  -- it on the thread (BRIEF_CHANGED, the latest stands) - the same rule as
  -- briefOf() in offer.ts.
  SELECT array(SELECT jsonb_array_elements_text(e.payload->'bedrooms')::int),
         (e.payload->>'budget_max_vnd')::bigint
    INTO _beds, _budget
    FROM public.inquiry_events e
   WHERE e.inquiry_id = _i.id AND e.type = 'BRIEF_CHANGED'
   ORDER BY e.occurred_at DESC, e.id DESC
   LIMIT 1;
  IF _beds IS NULL OR cardinality(_beds) = 0 THEN
    _beds := ARRAY[least(_i.bedrooms_needed, 4)];
    _budget := _i.budget_max_vnd;
  END IF;

  SELECT phone_e164, service_window_expires_at, opted_out_at INTO _renter
    FROM public.renters WHERE id = _i.renter_id;

  IF _renter.phone_e164 IS NOT NULL THEN
    -- Counted per person, as send.ts counts it.
    SELECT max(created_at) INTO _last_in FROM public.messages
     WHERE to_phone = _renter.phone_e164 AND direction = 'IN';
    SELECT count(*) INTO _consecutive FROM public.messages
     WHERE to_phone = _renter.phone_e164 AND direction = 'OUT'
       AND created_at > coalesce(_last_in, '-infinity'::timestamptz);
  END IF;

  RETURN jsonb_build_object(
    'id', _i.id,
    'complex', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'district', c.district,
                                          'management_company', c.management_company)
                FROM public.complexes c WHERE c.id = _i.complex_id),
    'bedrooms', _i.bedrooms_needed, 'budget_max_vnd', _i.budget_max_vnd,
    'move_in', _i.target_move_in_date, 'lease_months', _i.lease_duration_months, 'has_pets', _i.has_pets,
    'notes', public.mask_phone_numbers(_i.additional_notes, _renter.phone_e164),
    'created_at', _i.created_at, 'confirmed_at', _i.whatsapp_confirmed_at,
    'window_expires_at', _renter.service_window_expires_at,
    'opted_out', _renter.opted_out_at IS NOT NULL,
    'consecutive_outbound', _consecutive,
    -- The same renter's other requests from the last 30 days, so one offer
    -- can cover them. Ids and building names only - nothing about the renter.
    'siblings', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'complex_name', c.name)
                ORDER BY s.whatsapp_confirmed_at DESC)
              FROM public.complex_inquiries s
              JOIN public.complexes c ON c.id = s.complex_id
              WHERE s.renter_id = _i.renter_id AND s.id <> _i.id AND s.channel = 'WHATSAPP'
                AND s.whatsapp_confirmed_at > now() - interval '30 days'), '[]'::jsonb),
    'thread', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', m.id, 'direction', m.direction, 'source', m.source, 'channel', m.channel,
                'body', public.mask_phone_numbers(m.body, _renter.phone_e164),
                'created_at', m.created_at) ORDER BY m.created_at)
              FROM public.complex_inquiry_messages m WHERE m.inquiry_id = _i.id), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'inquiry_id', e.inquiry_id, 'type', e.type, 'payload', e.payload,
                'actor', e.actor, 'occurred_at', e.occurred_at) ORDER BY e.occurred_at, e.id)
              FROM public.inquiry_events e WHERE e.inquiry_id = _i.id), '[]'::jsonb),
    'units', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'title', e.title, 'price_vnd', e.price_vnd, 'bedrooms', e.bedrooms,
                'area_sqm', e.area_sqm, 'images', e.images, 'is_active', e.is_active,
                'last_verified_at', e.last_verified_at, 'realtor_id', e.realtor_id, 'realtor_name', r.display_name
              ) ORDER BY e.created_at)
              FROM public.external_properties e
              LEFT JOIN public.realtors r ON r.id = e.realtor_id
              WHERE e.source = 'concierge' AND e.external_id LIKE 'concierge:' || _i.id::text || ':%'
             ), '[]'::jsonb),
    'on_file', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'title', e.title, 'price_vnd', e.price_vnd, 'bedrooms', e.bedrooms,
                'area_sqm', e.area_sqm, 'source', e.source, 'source_url', e.source_url,
                'listed_at', coalesce(e.crawled_at, e.created_at),
                'realtor_id', e.realtor_id, 'realtor_name', r.display_name, 'realtor_phone', r.phone_e164
              ) ORDER BY e.price_vnd)
              FROM public.external_properties e
              LEFT JOIN public.realtors r ON r.id = e.realtor_id
              WHERE e.id IN (SELECT public.complex_listing_ids(_i.complex_id, '-infinity'::timestamptz))
                AND e.external_id NOT LIKE 'concierge:' || _i.id::text || ':%'
                AND e.price_vnd IS NOT NULL AND e.bedrooms IS NOT NULL AND e.area_sqm IS NOT NULL
                AND e.district_code IS NOT NULL AND coalesce(e.price_confidence, '') <> 'LOW'
                -- BUDGET_TOLERANCE in offer.ts: 10% over still fits.
                AND (_budget IS NULL OR e.price_vnd <= round(_budget * 1.1))
                AND least(e.bedrooms, 4) = ANY(_beds)
             ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_inquiry_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_inquiry_detail(uuid) TO authenticated;
