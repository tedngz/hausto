-- A bought pass granted its viewings twice.
--
-- Two independent mechanisms counted the same three coordinations:
--
--   base_viewing_allowance_remaining  a windowed allowance - "3 per 30 days",
--                                     measured by counting fast_track_requests
--                                     since the period began
--   pass_viewing_credits_remaining    the passes ledger, where the row carries
--                                     viewings_included = 3
--
-- can_create_fast_track_request adds them, so a $25 Pass sold as 3 viewing
-- coordination actually permitted 6. Not a display bug: the consume trigger
-- spends the windowed allowance first, so bookings 1-3 left the ledger
-- untouched and 4-6 drained it. Six real coordinator hours for a three-viewing
-- product.
--
-- The windowed allowance is a leftover from the subscription era, when a
-- Premium cycle conferred 3 viewings and no ledger existed. The Pass migration
-- added the ledger but left the allowance firing for pass holders too - its
-- condition was only "a live pass exists", which a bought pass satisfies.
--
-- So the ledger becomes the single source for a bought pass. The windowed
-- allowance survives only where there is no ledger row to spend from:
--
--   - Complimentary (admin) cover, which writes no passes row at all.
--   - The free tier's one trial viewing.
--
-- The retired $10/mo Premium branch goes with it: subscribers holds no live
-- rows, nothing sells into that plan, and the code that read it is deleted.

CREATE OR REPLACE FUNCTION public.base_viewing_allowance_remaining(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Complimentary cover has no ledger to draw on, so its allowance can only
    -- come from here. Still metered - each booking is a coordinator's hour.
    WHEN public.has_complimentary_pass(_user_id)
      THEN GREATEST(0, 3 - (
        SELECT COALESCE(SUM(GREATEST(1, COALESCE(cardinality(f.property_ids), 1))), 0)::int
        FROM public.fast_track_requests f
        WHERE f.renter_id = _user_id
          AND f.status <> 'cancelled'::fast_track_status
          AND f.created_at >= now() - interval '30 days'
      ))
    -- A bought pass carries its viewings in the passes ledger, which
    -- pass_viewing_credits_remaining already counts. Returning 0 here is what
    -- stops them being handed out twice.
    --
    -- It must be an explicit 0 rather than falling through: a pass holder who
    -- never spent their free trial would otherwise pick up the branch below
    -- and get four.
    WHEN EXISTS (
      SELECT 1 FROM public.passes p
      WHERE p.renter_id = _user_id
        AND p.kind = 'pass'
        AND p.expires_at > now()
    ) THEN 0
    -- Free tier: one coordinated viewing per account, ever, once earned.
    WHEN NOT EXISTS (SELECT 1 FROM public.viewing_trials t WHERE t.renter_id = _user_id)
         AND public.free_viewing_trial_unlocked(_user_id) THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.base_viewing_allowance_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_viewing_allowance_remaining(uuid) TO authenticated;
