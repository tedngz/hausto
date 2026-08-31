-- The one-argument can_create_fast_track_request was left behind by the Pass
-- migration: it still sums only the plan allowance and legacy pack credits, so
-- it answers "no" for a renter whose entire allowance is pass credits.
--
-- Nothing calls it today - the INSERT policy on fast_track_requests uses the
-- two-argument form - but a wrong answer sitting in the schema is a trap for
-- the next caller. It now delegates instead of keeping its own copy of the sum,
-- so the two forms cannot drift again.
CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_create_fast_track_request(_user_id, 1);
$$;

REVOKE ALL ON FUNCTION public.can_create_fast_track_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_fast_track_request(uuid) TO authenticated;
