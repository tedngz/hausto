-- The free lifetime viewing coordination is now earned, not granted on signup.
--
-- It's the most expensive thing Hausto gives away - an hour of a coordinator's
-- time - and every account could claim one the moment it existed, including
-- accounts browsing from abroad with no move in sight. Gating it behind real
-- intent spends that hour on someone actually moving.
--
-- Two signals, both already collected: the preference quiz answered in a way
-- that can drive a search, and at least three listings matched. Paid allowance
-- is untouched - this only guards the trial branch.

/**
 * Whether the renter has shown enough intent to unlock the free trial viewing.
 *
 * The preference test mirrors hasMeaningfulPreferences() on the client
 * (src/lib/preferences.ts): any one of styles, location, must-haves or size is
 * enough, because a renter who answered any of those can be searched for.
 * Budget and move-in date are excluded on purpose - both have defaults, so
 * neither proves the quiz was actually taken.
 */
CREATE OR REPLACE FUNCTION public.free_viewing_trial_unlocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_preferences p
      WHERE p.user_id = _user_id
        AND (
          COALESCE(cardinality(p.styles), 0) > 0
          OR COALESCE(cardinality(p.location), 0) > 0
          OR COALESCE(cardinality(p.must_haves), 0) > 0
          OR COALESCE(NULLIF(btrim(p.size), ''), NULL) IS NOT NULL
        )
    )
    AND (
      SELECT COUNT(*) FROM public.property_matches m WHERE m.renter_id = _user_id
    ) >= 3;
$$;

REVOKE ALL ON FUNCTION public.free_viewing_trial_unlocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_viewing_trial_unlocked(uuid) TO authenticated;

-- Same allowance as before, with the trial branch now asking whether it's been
-- earned. Premium's per-cycle count is unchanged.
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
    WHEN NOT EXISTS (SELECT 1 FROM public.viewing_trials t WHERE t.renter_id = _user_id)
         AND public.free_viewing_trial_unlocked(_user_id) THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.base_viewing_allowance_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_viewing_allowance_remaining(uuid) TO authenticated;
