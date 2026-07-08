
-- 1. Fast-track requests: require active premium subscription for UPDATE
DROP POLICY IF EXISTS "Renters can update their own pending requests" ON public.fast_track_requests;
CREATE POLICY "Renters can update their own pending requests"
ON public.fast_track_requests
FOR UPDATE
TO authenticated
USING (
  auth.uid() = renter_id
  AND status = 'pending'::fast_track_status
  AND EXISTS (
    SELECT 1 FROM public.subscribers s
    WHERE s.user_id = auth.uid()
      AND s.subscribed = true
      AND s.subscription_tier = 'premium'
      AND (s.subscription_end IS NULL OR s.subscription_end > now())
  )
)
WITH CHECK (
  auth.uid() = renter_id
  AND EXISTS (
    SELECT 1 FROM public.subscribers s
    WHERE s.user_id = auth.uid()
      AND s.subscribed = true
      AND s.subscription_tier = 'premium'
      AND (s.subscription_end IS NULL OR s.subscription_end > now())
  )
);

-- 2. Realtime broadcast/presence: app uses postgres_changes only, so deny
-- all broadcast/presence traffic for anon and authenticated. postgres_changes
-- subscriptions are enforced by RLS on the underlying public.* tables and are
-- unaffected by policies on realtime.messages.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all broadcast/presence for end users" ON realtime.messages;
CREATE POLICY "Deny all broadcast/presence for end users"
ON realtime.messages
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
