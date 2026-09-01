-- Admins hold a Hausto Pass by default.
--
-- The people running Hausto have to be able to walk the renter product the way
-- a paying renter sees it - deep vibe analysis, coordinated viewings, the
-- unlocked Hub - without buying a $25 pass every 30 days or hand-inserting
-- ledger rows that lapse silently mid-support-call.
--
-- It is granted by role rather than by email so it follows the admin seat: an
-- admin added tomorrow is covered, and an admin revoked tomorrow is not. No
-- passes row is written - a complimentary pass is an entitlement, not a
-- purchase, and putting it in the ledger would show up as revenue and be
-- refundable.

/** True when cover comes from the admin seat rather than a purchase. */
CREATE OR REPLACE FUNCTION public.has_complimentary_pass(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND public.has_role(_user_id, 'admin');
$$;

REVOKE ALL ON FUNCTION public.has_complimentary_pass(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_complimentary_pass(uuid) TO authenticated;

-- The entitlement test now answers yes for a complimentary pass too.
CREATE OR REPLACE FUNCTION public.has_active_pass(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_complimentary_pass(_user_id) OR EXISTS (
    SELECT 1 FROM public.passes p
    WHERE p.renter_id = _user_id
      AND p.kind = 'pass'
      AND p.expires_at > now()
  );
$$;

-- A complimentary pass has no end date. NULL says "covered, no deadline"
-- rather than a rolling date that would have the UI count down forever.
CREATE OR REPLACE FUNCTION public.active_pass_expires_at(_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.has_complimentary_pass(_user_id) THEN NULL ELSE (
    SELECT MAX(p.expires_at) FROM public.passes p
    WHERE p.renter_id = _user_id
      AND p.kind = 'pass'
      AND p.expires_at > now()
  ) END;
$$;

-- Viewing coordination: an admin gets the pass's three per 30 days, on the same
-- rolling window a paid pass uses. It stays a finite allowance on purpose -
-- every booking is a real coordinator hour, so unmetered internal bookings
-- would land on the ops queue with nothing showing where they came from.
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
    WHEN EXISTS (SELECT 1 FROM prem) OR public.has_complimentary_pass(_user_id)
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

-- The founding admin account. Idempotent, and a no-op on any environment where
-- that address has not signed up (local, preview) rather than an error.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'ted.ngz@gmail.com'
ON CONFLICT DO NOTHING;
