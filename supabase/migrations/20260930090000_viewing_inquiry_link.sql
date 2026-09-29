-- A viewing request made from an availability request's offer points back at
-- it (PLAN-v3 S7.1c, SPEC §1 and §11): the conversion the offer existed for.
-- Additive, replay-safe. Set by viewing-request-create through
-- linkViewingToInquiry() only when both belong to the same renter.

ALTER TABLE public.viewing_requests
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.complex_inquiries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_viewing_requests_inquiry
  ON public.viewing_requests (inquiry_id) WHERE inquiry_id IS NOT NULL;
