-- Units an agent offered, and the one message that offers them (PLAN-v3 S7.1b).
-- Additive, replay-safe.

-- ── Two new steps in a request's log ────────────────────────────────────────
-- Mirrors INQUIRY_EVENT_TYPES in viewing-domain.ts.
ALTER TABLE public.inquiry_events DROP CONSTRAINT IF EXISTS inquiry_events_type_check;
ALTER TABLE public.inquiry_events ADD CONSTRAINT inquiry_events_type_check CHECK (type IN (
  'SUBMITTED', 'CONFIRMED', 'AGENT_ASKED', 'AGENT_ANSWERED', 'UNIT_CAPTURED', 'UNITS_OFFERED', 'CLOSED', 'REOPENED'
));

-- ── Photos ──────────────────────────────────────────────────────────────────
-- The console uploads an agent's photos into the public listing-images bucket,
-- under concierge/<inquiry>/ only. Crawlers write there with the service role
-- and need no policy; this is the one browser path in.
DO $$
BEGIN
  DROP POLICY IF EXISTS "Ops upload concierge unit photos" ON storage.objects;
  CREATE POLICY "Ops upload concierge unit photos" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'external-property-images'
      AND (storage.foldername(name))[1] = 'concierge'
      AND (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
    );
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'concierge photo upload policy not created: %', SQLERRM;
END $$;

-- ── Freshness ───────────────────────────────────────────────────────────────
-- An agent's "it is free" goes stale fast (UNIT_FRESH_DAYS in offer.ts). A
-- captured unit comes down 14 days after its agent last confirmed it, unless
-- reconfirmed. The listing verifier skips these rows - they have no page.
-- 02:30 in Ho Chi Minh City.
DO $$
BEGIN
  PERFORM cron.schedule(
    'concierge-units-expire',
    '30 19 * * *',
    $cmd$
  UPDATE public.external_properties
     SET is_active = false,
         deactivated_at = now(),
         last_verification_status = 'stale',
         last_verification_reason = 'concierge_unconfirmed_14d'
   WHERE source = 'concierge'
     AND is_active
     AND coalesce(last_verified_at, created_at) < now() - interval '14 days';
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'concierge-units-expire not scheduled: %', SQLERRM;
END $$;

-- ── The brief shows captured units ──────────────────────────────────────────
-- The live definition (20260929140000) with a 'units' list, and those units
-- taken out of 'on_file' so each appears once.
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
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _i FROM public.complex_inquiries WHERE id = _inquiry_id AND channel = 'WHATSAPP';
  IF NOT FOUND THEN
    RETURN NULL;
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
                AND (_i.budget_max_vnd IS NULL OR e.price_vnd <= _i.budget_max_vnd)
                AND (CASE WHEN _i.bedrooms_needed >= 4 THEN e.bedrooms >= 4 ELSE e.bedrooms = _i.bedrooms_needed END)
             ), '[]'::jsonb)
  );
END;
$function$;
