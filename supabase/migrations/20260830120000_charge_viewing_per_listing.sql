-- A viewing request costs one coordination per listing, not one per request.
--
-- The booking modal lets a renter pick several listings in one go and caps the
-- picker at what they have left, but the ledger still counted rows: three
-- listings filed together spent a single credit, and every visit past the first
-- came free. Each listing is its own visit for a human coordinator, so each
-- listing is charged.
--
-- A row with a null or empty property_ids still costs one - a request that
-- coordinates nothing is not free to file.

-- Premium's per-cycle allowance now counts listings booked, not requests filed.
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
      SELECT COALESCE(SUM(GREATEST(1, COALESCE(cardinality(f.property_ids), 1))), 0)::int
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

-- The INSERT gate asks whether the account covers this many listings. The
-- single-argument form stays for anything still asking "can they book at all?".
CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid, _needed integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.base_viewing_allowance_remaining(_user_id)
       + public.viewing_pack_credits_remaining(_user_id)
       >= GREATEST(1, COALESCE(_needed, 1));
$$;

REVOKE ALL ON FUNCTION public.can_create_fast_track_request(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_fast_track_request(uuid, integer) TO authenticated;

DROP POLICY IF EXISTS "Renters can create their own fast track requests" ON public.fast_track_requests;
CREATE POLICY "Renters can create their own fast track requests"
ON public.fast_track_requests
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = renter_id
  AND public.can_create_fast_track_request(
        auth.uid(),
        GREATEST(1, COALESCE(cardinality(property_ids), 1))
      )
);

-- Pack credits cover whatever the plan allowance doesn't, one per listing,
-- spending from the pack that lapses soonest so credits aren't stranded.
CREATE OR REPLACE FUNCTION public.consume_viewing_pack_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  needed integer;
  take integer;
  pack record;
BEGIN
  needed := GREATEST(1, COALESCE(cardinality(NEW.property_ids), 1));
  needed := needed - LEAST(needed, public.base_viewing_allowance_remaining(NEW.renter_id));

  IF needed <= 0 THEN
    RETURN NEW;
  END IF;

  FOR pack IN
    SELECT a.id, a.credits - a.credits_used AS available
    FROM public.viewing_addons a
    WHERE a.renter_id = NEW.renter_id
      AND a.credits_used < a.credits
      AND a.expires_at > now()
    ORDER BY a.expires_at ASC
    FOR UPDATE
  LOOP
    take := LEAST(needed, pack.available);
    UPDATE public.viewing_addons
    SET credits_used = credits_used + take
    WHERE id = pack.id;

    needed := needed - take;
    EXIT WHEN needed <= 0;
  END LOOP;

  IF needed > 0 THEN
    RAISE EXCEPTION 'Not enough viewing coordination left on this account';
  END IF;

  RETURN NEW;
END;
$$;
