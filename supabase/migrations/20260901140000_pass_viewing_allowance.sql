-- A bought Hausto Pass carries its own viewing allowance.
--
-- base_viewing_allowance_remaining granted the three coordinations to a legacy
-- Premium subscriber or to an admin's complimentary pass, and to nobody else.
-- A renter who actually paid $25 for a pass is neither: they fell through to
-- the free tier's single trial coordination, gated behind the trial unlock.
-- They were charged for three viewings and the ledger offered them one.
--
-- The window is the pass's own period rather than a rolling 30 days. A pass
-- runs 30 days to its expires_at, so counting from expires_at - 30 days charges
-- a booking to the pass that was live when it was made; a rolling window would
-- charge the free trial coordination someone spent last week to the pass they
-- bought today. LEAST against now() keeps the start out of the future when
-- passes have been extended past 30 days - cover stacks, the per-cycle
-- allowance does not.
--
-- Admins keep the rolling window: a complimentary pass writes no passes row, so
-- there is no period to count from.

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
  pass AS (
    -- Passes extend each other, so cover runs to the furthest one.
    SELECT MAX(p.expires_at) AS expires_at
    FROM public.passes p
    WHERE p.renter_id = _user_id
      AND p.kind = 'pass'
      AND p.expires_at > now()
  ),
  window_start AS (
    SELECT CASE
      -- A bought pass counts from when its current period began.
      WHEN (SELECT expires_at FROM pass) IS NOT NULL
        THEN LEAST((SELECT expires_at FROM pass) - interval '30 days', now())
      -- LEAST guards against a stale subscription_end putting the cycle in the future.
      ELSE LEAST(
        COALESCE((SELECT subscription_end - interval '1 month' FROM prem), now() - interval '30 days'),
        now() - interval '30 days'
      )
    END AS from_ts
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM prem)
      OR (SELECT expires_at FROM pass) IS NOT NULL
      OR public.has_complimentary_pass(_user_id)
      THEN GREATEST(0, 3 - (
        SELECT COALESCE(SUM(GREATEST(1, COALESCE(cardinality(f.property_ids), 1))), 0)::int
        FROM public.fast_track_requests f
        WHERE f.renter_id = _user_id
          AND f.status <> 'cancelled'::fast_track_status
          AND f.created_at >= (SELECT from_ts FROM window_start)
      ))
    WHEN NOT EXISTS (SELECT 1 FROM public.viewing_trials t WHERE t.renter_id = _user_id)
         AND public.free_viewing_trial_unlocked(_user_id) THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.base_viewing_allowance_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_viewing_allowance_remaining(uuid) TO authenticated;
