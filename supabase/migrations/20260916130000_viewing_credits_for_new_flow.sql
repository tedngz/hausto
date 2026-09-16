-- Viewing credits follow the listing, whichever flow asked for it.
--
-- Fast-Track is retired as a renter surface: the cards now open the viewing
-- request modal, which writes viewing_requests + request_items. The ledger did
-- not follow, so every request through the new flow was free, and a
-- complimentary-cover account could have taken three coordinations from
-- fast_track_requests and another three from the new flow.
--
-- CLAUDE.md has one rule here above all others: **an entitlement is counted
-- once**. Granting a bought pass both a ledger row and a windowed allowance
-- once sold three viewings and permitted six. Two request tables are the same
-- hazard in a different shape, so the windowed allowance below now counts
-- listings across BOTH, and the credit-spending path is shared rather than
-- duplicated.
--
-- These definitions were read off the live database before being rewritten
-- (CLAUDE.md: what is deployed is the source of truth, not the migration
-- files). Everything not to do with counting the new flow is carried across
-- unchanged, including the explicit `THEN 0` for pass holders and the
-- free_viewing_trial_unlocked gate.

-- ── How many listings has this account already booked in the window? ────────
--
-- Split out so the two call sites cannot drift. Counts a listing once, in
-- whichever table it was requested through.
CREATE OR REPLACE FUNCTION public.viewing_listings_booked_since(
  _user_id uuid,
  _since timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Fast-Track: retired as a surface, but its rows are real history and the
    -- listings in them were really coordinated.
    COALESCE((
      SELECT SUM(GREATEST(1, COALESCE(cardinality(f.property_ids), 1)))::int
      FROM public.fast_track_requests f
      WHERE f.renter_id = _user_id
        AND f.status <> 'cancelled'::fast_track_status
        AND f.created_at >= _since
    ), 0)
    +
    -- The viewing flow: one row per listing already, so this is a plain count.
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.request_items ri
      JOIN public.viewing_requests vr ON vr.id = ri.request_id
      JOIN public.renters r ON r.id = vr.renter_id
      WHERE r.user_id = _user_id
        AND vr.created_at >= _since
    ), 0);
$$;

REVOKE ALL ON FUNCTION public.viewing_listings_booked_since(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewing_listings_booked_since(uuid, timestamptz) TO authenticated;

-- ── The windowed allowance, now aware of both flows ─────────────────────────
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
      THEN GREATEST(0, 3 - public.viewing_listings_booked_since(
             _user_id, now() - interval '30 days'))
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

-- ── Spending credits from the viewing flow ──────────────────────────────────
--
-- The Fast-Track trigger cannot be reused: it reads NEW.property_ids off the
-- row being inserted, and in this flow the listings arrive as request_items
-- AFTER the request row exists. So the intake function calls this explicitly,
-- once, with the number of items it actually wrote.
--
-- Same spending order as consume_viewing_pack_credit: the windowed allowance
-- first (it is derived from the count above, so it needs no decrementing),
-- then the passes ledger, soonest-lapsing first so credits are not stranded.
--
-- It raises rather than returning false when the account cannot cover the
-- request. The caller has already written rows at this point and must undo
-- them; a boolean would let a caller ignore it and hand out free coordination.
CREATE OR REPLACE FUNCTION public.consume_viewing_credits(
  _user_id uuid,
  _needed integer,
  _request_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  needed integer;
  from_base integer;
  take integer;
  entry record;
BEGIN
  needed := GREATEST(1, COALESCE(_needed, 1));

  -- What the windowed allowance covers. Note this is computed AFTER the items
  -- were written, so they are already inside the window's count - which is
  -- exactly right: it asks "is this account still within its three", not "may
  -- it spend three more".
  from_base := LEAST(needed, GREATEST(0, public.base_viewing_allowance_remaining(_user_id)));

  -- The free trial is a one-off and has to be stamped the moment it is spent,
  -- or it is infinite. Fast-Track does this with a trigger; this flow has no
  -- INSERT on that table to hang one off.
  IF from_base > 0
     AND NOT public.has_complimentary_pass(_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.passes p
       WHERE p.renter_id = _user_id AND p.kind = 'pass' AND p.expires_at > now()
     )
  THEN
    INSERT INTO public.viewing_trials (renter_id, request_id)
    VALUES (_user_id, _request_id)
    ON CONFLICT (renter_id) DO NOTHING;
  END IF;

  needed := needed - from_base;
  IF needed <= 0 THEN
    RETURN 0;
  END IF;

  FOR entry IN
    SELECT p.id, p.viewings_included - p.viewings_used AS available
    FROM public.passes p
    WHERE p.renter_id = _user_id
      AND p.viewings_used < p.viewings_included
      AND p.expires_at > now()
    ORDER BY p.expires_at ASC
    FOR UPDATE
  LOOP
    take := LEAST(needed, entry.available);
    UPDATE public.passes
    SET viewings_used = viewings_used + take
    WHERE id = entry.id;

    needed := needed - take;
    EXIT WHEN needed <= 0;
  END LOOP;

  IF needed > 0 THEN
    RAISE EXCEPTION 'Not enough viewing coordination left on this account';
  END IF;

  RETURN GREATEST(0, COALESCE(_needed, 1)) - from_base;
END;
$$;

-- Service role only. This spends money; nothing holding an anon or renter JWT
-- has any business calling it.
REVOKE ALL ON FUNCTION public.consume_viewing_credits(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
