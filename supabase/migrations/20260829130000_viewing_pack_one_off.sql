-- The viewing pack becomes a one-off purchase instead of a 30-day window:
-- $20 buys 10 viewing coordination that sit on the account until they're spent,
-- and a renter who runs out simply buys another pack. Credits from several
-- packs stack, so viewing_addons turns from "is a window active?" into a
-- credit ledger with one row per purchase.

ALTER TABLE public.viewing_addons
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.viewing_addons
  DROP CONSTRAINT IF EXISTS viewing_addons_credits_used_range;
ALTER TABLE public.viewing_addons
  ADD CONSTRAINT viewing_addons_credits_used_range
  CHECK (credits_used >= 0 AND credits_used <= credits);

-- Anyone holding a pack bought under the old rules keeps 10 unspent credits;
-- their old window is left in place as a record of the purchase.
UPDATE public.viewing_addons SET credits = 10 WHERE credits IS DISTINCT FROM 10;

CREATE INDEX IF NOT EXISTS idx_viewing_addons_renter_unspent
  ON public.viewing_addons(renter_id, created_at)
  WHERE credits_used < credits;

-- What the renter's plan covers before any pack credit is touched: the free
-- tier's one lifetime trial, or Premium's 3 per billing cycle.
CREATE OR REPLACE FUNCTION public.base_viewing_allowance_remaining(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prem AS (
    SELECT s.subscription_end
    FROM public.subscribers s
    WHERE s.user_id = _user_id
      AND s.subscribed = true
      AND s.subscription_tier = 'premium'
      AND (s.subscription_end IS NULL OR s.subscription_end > now())
    LIMIT 1
  ),
  window_start AS (
    -- LEAST guards against a stale subscription_end putting the cycle in the future.
    SELECT LEAST(
      COALESCE((SELECT subscription_end - interval '1 month' FROM prem), now() - interval '30 days'),
      now() - interval '30 days'
    ) AS from_ts
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM prem) THEN GREATEST(0, 3 - (
      SELECT count(*)::int
      FROM public.fast_track_requests f
      WHERE f.renter_id = _user_id
        AND f.status <> 'cancelled'::fast_track_status
        AND f.created_at >= (SELECT from_ts FROM window_start)
    ))
    WHEN NOT EXISTS (SELECT 1 FROM public.viewing_trials t WHERE t.renter_id = _user_id) THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.base_viewing_allowance_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_viewing_allowance_remaining(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.viewing_pack_credits_remaining(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(a.credits - a.credits_used), 0)::int
  FROM public.viewing_addons a
  WHERE a.renter_id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.viewing_pack_credits_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewing_pack_credits_remaining(uuid) TO authenticated;

-- The INSERT gate now asks the same question the UI does: is anything left,
-- from the plan or from a pack?
CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.base_viewing_allowance_remaining(_user_id) > 0
      OR public.viewing_pack_credits_remaining(_user_id) > 0;
$$;

REVOKE ALL ON FUNCTION public.can_create_fast_track_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_fast_track_request(uuid) TO authenticated;

-- Spend a pack credit only when the plan doesn't already cover the booking.
-- BEFORE INSERT on purpose: the new row must not be counted yet, or the base
-- allowance would look spent by the very request being checked.
CREATE OR REPLACE FUNCTION public.consume_viewing_pack_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF public.base_viewing_allowance_remaining(NEW.renter_id) > 0 THEN
    RETURN NEW;
  END IF;

  -- Oldest pack first, so credits are spent in the order they were bought.
  SELECT a.id INTO target
  FROM public.viewing_addons a
  WHERE a.renter_id = NEW.renter_id
    AND a.credits_used < a.credits
  ORDER BY a.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF target IS NULL THEN
    RAISE EXCEPTION 'No viewing coordination left on this account';
  END IF;

  UPDATE public.viewing_addons
  SET credits_used = credits_used + 1
  WHERE id = target;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consume_viewing_pack_credit ON public.fast_track_requests;
CREATE TRIGGER consume_viewing_pack_credit
BEFORE INSERT ON public.fast_track_requests
FOR EACH ROW
EXECUTE FUNCTION public.consume_viewing_pack_credit();
