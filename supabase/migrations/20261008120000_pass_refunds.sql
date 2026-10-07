-- A refund ends the Pass it refunds (the refund policy, 2026-10-08). Additive
-- and replay-safe.
--
-- Polar is the merchant of record, and may refund an order itself - within 60
-- days, whatever our policy says - to head off a chargeback. Until now a refund
-- reached nothing here: handle-polar-webhooks acted on order.paid alone, so a
-- refunded Pass went on covering viewings until its 30 days ran out. A refund
-- in full now calls record_pass_refund, which ends that purchase's cover at the
-- moment of the refund.
--
-- Cover is `expires_at > now()` everywhere it is read - has_active_pass,
-- active_pass_expires_at, usePass in the renter app - so ending it means
-- bringing expires_at forward, and refunded_at says why it moved.

ALTER TABLE public.passes ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

COMMENT ON COLUMN public.passes.refunded_at IS
  'When the purchase was refunded in full (order.refunded, record_pass_refund). expires_at was brought forward to it.';

CREATE OR REPLACE FUNCTION public.record_pass_refund(
  _provider_order_id text,
  _refunded_at timestamptz,
  _pass_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Polar's clock and ours can disagree; a refund is never in the future.
  _at      timestamptz := LEAST(COALESCE(_refunded_at, now()), now());
  _p       public.passes%ROWTYPE;
  _unused  interval;
  _pulled  integer := 0;
BEGIN
  SELECT * INTO _p FROM public.passes
  WHERE provider_order_id = _provider_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;
  IF _p.refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already', 'pass_id', _p.id, 'refunded_at', _p.refunded_at);
  END IF;

  -- The days this purchase still had to give. A pass bought while another was
  -- live was chained onto its end (polar-pass.ts), so its own days are at most
  -- the ones it was sold with; any before them belong to the pass it followed.
  _unused := LEAST(GREATEST(_p.expires_at - _at, interval '0'), make_interval(days => _pass_days));

  UPDATE public.passes
  SET refunded_at = _at, expires_at = LEAST(expires_at, _at)
  WHERE id = _p.id;

  -- Whatever was chained on after it starts where it ended, so it loses the
  -- refunded days too - otherwise refunding the first of two passes would keep
  -- days nobody paid for. A top-up rides on the pass it was bought against and
  -- moves with it. Only a Pass extends cover, so only a Pass pulls anything.
  IF _p.kind = 'pass' AND _unused > interval '0' THEN
    UPDATE public.passes q
    SET expires_at = q.expires_at - _unused
    WHERE q.renter_id = _p.renter_id
      AND q.id <> _p.id
      AND q.refunded_at IS NULL
      AND q.expires_at > _p.expires_at;
    GET DIAGNOSTICS _pulled = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'refunded',
    'pass_id', _p.id,
    'kind', _p.kind,
    'expires_at', LEAST(_p.expires_at, _at),
    'later_pulled_back', _pulled
  );
END;
$function$;

-- The webhook's, which runs as the service role. Never a renter's.
REVOKE ALL ON FUNCTION public.record_pass_refund(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pass_refund(text, timestamptz, integer) TO service_role;
