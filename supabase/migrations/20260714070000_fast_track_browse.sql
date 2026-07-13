-- Fast-Track from the public browse table: requests no longer require a chat
-- conversation or a matched realtor (external listings have neither). Ops
-- coordinates viewings and writes availability back to the listing record.

ALTER TABLE public.fast_track_requests
  ALTER COLUMN conversation_id DROP NOT NULL,
  ALTER COLUMN realtor_id DROP NOT NULL;

ALTER TABLE public.fast_track_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat';

-- Ops (admin role) works the queue
DROP POLICY IF EXISTS "Admins can view all fast track requests" ON public.fast_track_requests;
DROP POLICY IF EXISTS "Admins can update all fast track requests" ON public.fast_track_requests;
CREATE POLICY "Admins can view all fast track requests"
ON public.fast_track_requests
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all fast track requests"
ON public.fast_track_requests
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Availability write-back (admin UPDATE/SELECT policies on external_properties
-- already exist in prod; ops confirms a unit live/rented and that updates the
-- listing's verification state directly).
