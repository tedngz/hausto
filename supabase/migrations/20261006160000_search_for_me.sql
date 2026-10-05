-- Search for me (pricing rework, build step 5; SPEC §11). Additive and
-- replay-safe.
--
-- An availability request was always for one building. A Pass holder can now
-- ask for an area - districts, budget, bedrooms, move-in, pets - and a person
-- searches agents' circles for it. Same table, same thread, same typed steps,
-- same offer; what changes is the place: a set of district codes and a label
-- instead of a complex. A watch can follow an area the same way.

-- ── Requests ────────────────────────────────────────────────────────────────
ALTER TABLE public.complex_inquiries ALTER COLUMN complex_id DROP NOT NULL;
ALTER TABLE public.complex_inquiries
  ADD COLUMN IF NOT EXISTS area_district_codes text[],
  ADD COLUMN IF NOT EXISTS area_label text;

DO $$
BEGIN
  ALTER TABLE public.complex_inquiries ADD CONSTRAINT complex_inquiries_building_or_area CHECK (
    (complex_id IS NOT NULL AND area_district_codes IS NULL)
    OR (complex_id IS NULL AND cardinality(area_district_codes) BETWEEN 1 AND 4 AND area_label IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.complex_inquiries.area_district_codes IS
  'Search for me: the districts asked about (district_code values), when the request is for an area rather than one building.';

-- ── Watches ─────────────────────────────────────────────────────────────────
ALTER TABLE public.complex_watches ALTER COLUMN complex_id DROP NOT NULL;
ALTER TABLE public.complex_watches
  ADD COLUMN IF NOT EXISTS area_district_codes text[],
  ADD COLUMN IF NOT EXISTS area_label text;

DO $$
BEGIN
  ALTER TABLE public.complex_watches ADD CONSTRAINT complex_watches_building_or_area CHECK (
    (complex_id IS NOT NULL AND area_district_codes IS NULL)
    OR (complex_id IS NULL AND cardinality(area_district_codes) BETWEEN 1 AND 4 AND area_label IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The console ─────────────────────────────────────────────────────────────
-- The queue joined complexes, which an area request has none of: a LEFT JOIN
-- and the area's label in the building's place, so both are worked the same.
CREATE OR REPLACE FUNCTION public.ops_inquiries()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'complex_id', i.complex_id, 'complex_name', coalesce(c.name, i.area_label), 'district', c.district,
    'area_district_codes', i.area_district_codes,
    'bedrooms', i.bedrooms_needed, 'budget_max_vnd', i.budget_max_vnd,
    'move_in', i.target_move_in_date, 'lease_months', i.lease_duration_months, 'has_pets', i.has_pets,
    'created_at', i.created_at, 'confirmed_at', i.whatsapp_confirmed_at, 'last_inbound_at', i.last_inbound_at,
    'last_renter_at', (SELECT max(m.created_at) FROM public.complex_inquiry_messages m
                        WHERE m.inquiry_id = i.id AND m.direction = 'inbound'),
    'last_ours_at', (SELECT max(m.created_at) FROM public.complex_inquiry_messages m
                      WHERE m.inquiry_id = i.id AND m.direction = 'outbound'),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'inquiry_id', e.inquiry_id, 'type', e.type, 'payload', e.payload,
                'actor', e.actor, 'occurred_at', e.occurred_at) ORDER BY e.occurred_at, e.id)
              FROM public.inquiry_events e WHERE e.inquiry_id = i.id), '[]'::jsonb)
  ) ORDER BY i.created_at DESC), '[]'::jsonb)
  INTO _out
  FROM (SELECT * FROM public.complex_inquiries WHERE channel = 'WHATSAPP' ORDER BY created_at DESC LIMIT 200) i
  LEFT JOIN public.complexes c ON c.id = i.complex_id;

  RETURN _out;
END;
$function$;

-- The request's detail. For an area: `complex` is the area in the building's
-- shape (name = the label, no id), `area_district_codes` says which, and the
-- listings on file are those in its districts rather than at a building.
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
    'complex', CASE WHEN _i.complex_id IS NOT NULL
      THEN (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'district', c.district,
                                      'management_company', c.management_company)
            FROM public.complexes c WHERE c.id = _i.complex_id)
      ELSE jsonb_build_object('id', NULL, 'name', _i.area_label, 'slug', NULL, 'district', NULL,
                              'management_company', NULL)
    END,
    'area_district_codes', _i.area_district_codes,
    'bedrooms', _i.bedrooms_needed, 'budget_max_vnd', _i.budget_max_vnd,
    'move_in', _i.target_move_in_date, 'lease_months', _i.lease_duration_months, 'has_pets', _i.has_pets,
    'notes', public.mask_phone_numbers(_i.additional_notes, _renter.phone_e164),
    'created_at', _i.created_at, 'confirmed_at', _i.whatsapp_confirmed_at,
    'window_expires_at', _renter.service_window_expires_at,
    'opted_out', _renter.opted_out_at IS NOT NULL,
    'consecutive_outbound', _consecutive,
    -- The same renter's other requests from the last 30 days, so one offer
    -- can cover them. Ids and place names only - nothing about the renter.
    'siblings', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'complex_name', coalesce(c.name, s.area_label))
                ORDER BY s.whatsapp_confirmed_at DESC)
              FROM public.complex_inquiries s
              LEFT JOIN public.complexes c ON c.id = s.complex_id
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
              WHERE (
                  (_i.complex_id IS NOT NULL
                    AND e.id IN (SELECT public.complex_listing_ids(_i.complex_id, '-infinity'::timestamptz)))
                  OR (_i.complex_id IS NULL AND e.is_active AND e.raw_only = false
                    AND e.district_code = ANY(_i.area_district_codes))
                )
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

-- Who to ask about an area: agents with live listings in its districts, the
-- ones who answer us first. The building roster's shape, so the console's
-- ask-an-agent list reads it unchanged.
CREATE OR REPLACE FUNCTION public.ops_area_roster(_district_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  WITH listed AS (
    SELECT e.realtor_id, count(DISTINCT e.id) AS listings,
           max(coalesce(e.crawled_at, e.created_at)) AS last_listed_at
    FROM public.external_properties e
    WHERE e.raw_only = false AND e.realtor_id IS NOT NULL AND e.district_code = ANY(_district_codes)
    GROUP BY e.realtor_id
  ), citywide AS (
    SELECT realtor_id, count(*) AS listings_total
    FROM public.external_properties WHERE realtor_id IS NOT NULL AND raw_only = false GROUP BY realtor_id
  ), replies AS (
    SELECT realtor_id, max(created_at) AS last_reply_at
    FROM public.realtor_messages WHERE direction = 'IN' AND realtor_id IS NOT NULL GROUP BY realtor_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'realtor_id', r.id, 'name', r.display_name, 'agency', r.agency, 'phone', r.phone_e164,
    'sources', ARRAY['LISTING'], 'note', NULL, 'added_at', NULL,
    'listings', l.listings, 'listings_total', coalesce(cw.listings_total, 0),
    'last_listed_at', l.last_listed_at, 'last_reply_at', rp.last_reply_at
  ) ORDER BY rp.last_reply_at DESC NULLS LAST, l.last_listed_at DESC NULLS LAST), '[]'::jsonb)
  INTO _out
  FROM listed l
  JOIN public.realtors r ON r.id = l.realtor_id
  LEFT JOIN citywide cw ON cw.realtor_id = l.realtor_id
  LEFT JOIN replies rp ON rp.realtor_id = l.realtor_id;

  RETURN _out;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_area_roster(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_area_roster(text[]) TO authenticated;
