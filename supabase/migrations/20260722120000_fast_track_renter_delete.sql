-- Renters can delete their own Fast-Track requests once nothing is being
-- actively coordinated. Pending requests are theirs to withdraw, and cancelled
-- ones are just clutter in their profile list. Requests that are in_progress,
-- scheduled or completed stay put: the coordinator and the agents are already
-- working against them, and completed rows are the booking record.
--
-- Unlike the UPDATE policy this does not require an active premium
-- subscription: removing your own withdrawn request should not depend on
-- billing state.
DROP POLICY IF EXISTS "Renters can delete their own inactive requests" ON public.fast_track_requests;
CREATE POLICY "Renters can delete their own inactive requests"
ON public.fast_track_requests
FOR DELETE
TO authenticated
USING (
  auth.uid() = renter_id
  AND status IN ('pending'::fast_track_status, 'cancelled'::fast_track_status)
);
