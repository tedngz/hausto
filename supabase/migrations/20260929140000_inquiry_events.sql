-- Availability requests worked in the ops console (PLAN-v3 S7.1a). Additive,
-- replay-safe.

-- ── The log ─────────────────────────────────────────────────────────────────
-- A request's state is derived from these by reduceInquiry() in
-- viewing-domain.ts (invariant 1); every operator step is one typed row
-- (invariant 2). Types mirror INQUIRY_EVENT_TYPES.
CREATE TABLE IF NOT EXISTS public.inquiry_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES public.complex_inquiries(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('SUBMITTED', 'CONFIRMED', 'AGENT_ASKED', 'AGENT_ANSWERED', 'CLOSED', 'REOPENED')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_events_inquiry ON public.inquiry_events (inquiry_id, occurred_at);

-- Append-only, as events is: a correction is a new row. The service role is
-- not exempt.
REVOKE UPDATE, DELETE, TRUNCATE ON public.inquiry_events FROM PUBLIC, anon, authenticated, service_role;

-- Read through the functions below; written through ops-record-outcome.
ALTER TABLE public.inquiry_events ENABLE ROW LEVEL SECURITY;

-- ── The queue ───────────────────────────────────────────────────────────────
-- WhatsApp requests only: email requests stay in Admin Tools. Never the
-- renter's name, phone, email or account (invariant 4) - whoever works the
-- queue, the AI operator included, cannot leak what it never sees.
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
    'complex_id', i.complex_id, 'complex_name', c.name, 'district', c.district,
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
  JOIN public.complexes c ON c.id = i.complex_id;

  RETURN _out;
END;
$function$;

-- ── One request's brief ─────────────────────────────────────────────────────
-- Criteria, the thread with numbers masked (mask_phone_numbers, as the viewing
-- thread), the log, the renter's window and consecutive-outbound count, and
-- the listings on file at the building that fit - with their agents, since
-- advertised is not available until an agent says so.
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
    'on_file', coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'title', e.title, 'price_vnd', e.price_vnd, 'bedrooms', e.bedrooms,
                'area_sqm', e.area_sqm, 'source', e.source, 'source_url', e.source_url,
                'listed_at', coalesce(e.crawled_at, e.created_at),
                'realtor_id', e.realtor_id, 'realtor_name', r.display_name, 'realtor_phone', r.phone_e164
              ) ORDER BY e.price_vnd)
              FROM public.external_properties e
              LEFT JOIN public.realtors r ON r.id = e.realtor_id
              WHERE e.id IN (SELECT public.complex_listing_ids(_i.complex_id, '-infinity'::timestamptz))
                AND e.price_vnd IS NOT NULL AND e.bedrooms IS NOT NULL AND e.area_sqm IS NOT NULL
                AND e.district_code IS NOT NULL AND coalesce(e.price_confidence, '') <> 'LOW'
                AND (_i.budget_max_vnd IS NULL OR e.price_vnd <= _i.budget_max_vnd)
                AND (CASE WHEN _i.bedrooms_needed >= 4 THEN e.bedrooms >= 4 ELSE e.bedrooms = _i.bedrooms_needed END)
             ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_inquiries() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_inquiry_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_inquiries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_inquiry_detail(uuid) TO authenticated;
