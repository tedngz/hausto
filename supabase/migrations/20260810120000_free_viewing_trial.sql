-- Free-tier trial: every account gets one coordinated viewing on the house.
--
-- Until now creating a fast_track_request required an active premium
-- subscription, so free renters never got to feel what coordination actually
-- does for them. The gate now admits three cases:
--   1. premium subscribers (3 included bookings per cycle, capped in the app),
--   2. holders of the $20 unlimited-month add-on, which is sold standalone and
--      was already treated as sufficient by the client but blocked here,
--   3. free renters who have never spent their trial.
--
-- The trial is tracked in its own ledger rather than by counting requests:
-- renters can cancel AND delete their own pending/cancelled requests, so any
-- count over fast_track_requests could be reset at will, and every request
-- costs a human coordinator real work. Ops can re-grant a trial by deleting the
-- renter's viewing_trials row.

CREATE TABLE IF NOT EXISTS public.viewing_trials (
  renter_id UUID PRIMARY KEY,
  used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  request_id UUID
);

ALTER TABLE public.viewing_trials ENABLE ROW LEVEL SECURITY;

-- Renters can see whether they've spent their trial (quota display).
DROP POLICY IF EXISTS "Renters can view their own viewing trial" ON public.viewing_trials;
CREATE POLICY "Renters can view their own viewing trial"
ON public.viewing_trials
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

DROP POLICY IF EXISTS "Admins can manage viewing trials" ON public.viewing_trials;
CREATE POLICY "Admins can manage viewing trials"
ON public.viewing_trials
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- No renter INSERT/UPDATE/DELETE policy on purpose: rows are stamped by the
-- trigger below, which is the only thing that may spend a trial.
REVOKE INSERT, UPDATE, DELETE ON public.viewing_trials FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.mark_viewing_trial_used()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.viewing_trials (renter_id, request_id)
  VALUES (NEW.renter_id, NEW.id)
  ON CONFLICT (renter_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_viewing_trial ON public.fast_track_requests;
CREATE TRIGGER stamp_viewing_trial
AFTER INSERT ON public.fast_track_requests
FOR EACH ROW
EXECUTE FUNCTION public.mark_viewing_trial_used();

-- Existing renters who already had a request coordinated have effectively used
-- theirs - don't hand a free one to accounts that have been booking all along.
INSERT INTO public.viewing_trials (renter_id, used_at, request_id)
SELECT DISTINCT ON (f.renter_id) f.renter_id, f.created_at, f.id
FROM public.fast_track_requests f
ORDER BY f.renter_id, f.created_at ASC
ON CONFLICT (renter_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.subscribers s
      WHERE s.user_id = _user_id
        AND s.subscribed = true
        AND s.subscription_tier = 'premium'
        AND (s.subscription_end IS NULL OR s.subscription_end > now())
    )
    OR EXISTS (
      SELECT 1 FROM public.viewing_addons a
      WHERE a.renter_id = _user_id
        AND a.expires_at > now()
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.viewing_trials t
      WHERE t.renter_id = _user_id
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_fast_track_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_fast_track_request(uuid) TO authenticated;

DROP POLICY IF EXISTS "Renters can create their own fast track requests" ON public.fast_track_requests;
CREATE POLICY "Renters can create their own fast track requests"
ON public.fast_track_requests
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = renter_id
  AND public.can_create_fast_track_request(auth.uid())
);

-- A trial request is only useful if the renter can also change or withdraw it,
-- so editing a pending request no longer depends on billing state - same
-- reasoning as the DELETE policy. WITH CHECK keeps renters from promoting their
-- own request past 'pending' (only ops/realtors schedule and complete).
DROP POLICY IF EXISTS "Renters can update their own pending requests" ON public.fast_track_requests;
CREATE POLICY "Renters can update their own pending requests"
ON public.fast_track_requests
FOR UPDATE
TO authenticated
USING (
  auth.uid() = renter_id
  AND status = 'pending'::fast_track_status
)
WITH CHECK (
  auth.uid() = renter_id
  AND status IN ('pending'::fast_track_status, 'cancelled'::fast_track_status)
);
