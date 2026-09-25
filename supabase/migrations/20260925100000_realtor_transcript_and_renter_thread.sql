-- AI operator plan, stage 0: the two things an operator - human now, AI later -
-- could not see.
--
-- 1. `realtor_messages`: what we said to each broker and what they said back.
--    Until now the only trace of a broker conversation was the operator's
--    note; the words themselves stayed on one person's phone. Those words,
--    paired with the typed outcome an operator picked for them, are the corpus
--    the realtor side gets automated from (SPEC §4), and they were being
--    thrown away on every request.
--
-- 2. `ops_request_thread()`: the renter's side of a request, minus the renter.
--    A reschedule, a question or a decline was classified, logged, and read by
--    nobody - no policy grants the console `messages`, because `to_phone` is
--    the renter's number (invariant 4). The 20260911190000 migration said this
--    day would come and that the answer was "a view that selects the body and
--    not the number - not a policy widened here". This is that, as a function.

-- ── realtor_messages ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.realtor_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.viewing_requests(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES public.request_items(id) ON DELETE CASCADE,
  realtor_id      uuid REFERENCES public.realtors(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('OUT', 'IN')),
  -- How it reached the broker. ZALO for nearly everything this quarter.
  medium          text NOT NULL CHECK (medium IN ('ZALO', 'PHONE', 'WHATSAPP', 'SMS')),
  purpose         text NOT NULL CHECK (purpose IN ('REQUEST_VIEWING', 'NUDGE', 'CONFIRM', 'RELEASE', 'REPLY')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status          text NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'RECEIVED')),
  -- OPS:<uuid> | AGENT:<version> | SYSTEM - the same vocabulary as events.actor.
  actor           text NOT NULL,
  -- Persist-then-send, as for `messages`: the same key twice is one message.
  idempotency_key text UNIQUE NOT NULL,
  provider_id     text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS realtor_messages_item_idx
  ON public.realtor_messages (item_id, created_at);
CREATE INDEX IF NOT EXISTS realtor_messages_request_idx
  ON public.realtor_messages (request_id, created_at);
CREATE INDEX IF NOT EXISTS realtor_messages_realtor_idx
  ON public.realtor_messages (realtor_id, created_at) WHERE realtor_id IS NOT NULL;

COMMENT ON TABLE public.realtor_messages IS
  'Broker transcript: every message to and from a realtor about a request item. Written only by edge functions '
  '(ops-record-outcome) through _shared/realtor/send.ts, which refuses renter identity in outbound bodies.';

-- Read-only for ops and admin, like the rest of the request graph. Writes go
-- through ops-record-outcome with the service role, never from a browser.
ALTER TABLE public.realtor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ops read realtor_messages" ON public.realtor_messages;
CREATE POLICY "Ops read realtor_messages" ON public.realtor_messages
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read realtor_messages" ON public.realtor_messages;
CREATE POLICY "Admins read realtor_messages" ON public.realtor_messages
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── the renter thread, without the renter ──────────────────────────────────
-- SECURITY DEFINER because the caller has no grant on `messages` or `renters`
-- and must not get one: a policy would expose `to_phone` to anything that can
-- select the table. The function selects the columns an operator needs and
-- nothing else, and masks phone-shaped text inside bodies, because a renter
-- who types their own number into a reply has not asked for an operator to
-- copy it into Zalo.
--
-- It also carries the two facts that decide whether the console may reply at
-- all: when the 24-hour window closes, and how many outbound messages have gone
-- since the renter last wrote (send.ts refuses a third).
CREATE OR REPLACE FUNCTION public.ops_request_thread(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
           'body', regexp_replace(
                     coalesce(m.body, ''),
                     '(?<![0-9])(\+?84|0)[ .-]?[35789]([ .-]?[0-9]){8}(?![0-9])',
                     '[number hidden]', 'g'),
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
$$;

REVOKE ALL ON FUNCTION public.ops_request_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_request_thread(uuid) TO authenticated;

COMMENT ON FUNCTION public.ops_request_thread(uuid) IS
  'Renter WhatsApp thread for one request, for the ops console. Never returns the renter''s phone or name '
  '(CLAUDE.md invariant 4); masks phone-shaped text in bodies. Ops or admin only.';
