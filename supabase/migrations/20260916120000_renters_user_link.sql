-- Link a renter to the account that created their requests.
--
-- `renters` is keyed to a phone number, because the WhatsApp side has nothing
-- else to key on: a message arrives with a number and no session. That was
-- right, and it stays the identity for everything inbound.
--
-- What it cannot do is answer "show me my viewing requests" on the website.
-- The hub needs a tab where a signed-in renter sees their own requests, and
-- with no link between auth.users and renters the only way to find them would
-- be to ask the browser which phone number to trust - which is not a check,
-- it is a request to be lied to.
--
-- So: an optional column. Optional because a renter who came in over WhatsApp
-- and never signed up is still a renter, and making this NOT NULL would make
-- the inbound path depend on an account that does not exist.

ALTER TABLE public.renters
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- One account, one renter row. Two rows claiming the same account would make
-- "my requests" ambiguous in a way no query could resolve.
CREATE UNIQUE INDEX IF NOT EXISTS renters_user_id_key
  ON public.renters (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS viewing_requests_renter_created_idx
  ON public.viewing_requests (renter_id, created_at DESC);

-- ── Reading your own requests ───────────────────────────────────────────────
--
-- SELECT only. Everything that writes to this domain goes through an edge
-- function with the service role, because status is derived from the event log
-- by a reducer and never written directly (invariant 1). A renter with INSERT
-- on viewing_requests could file a request whose items and events do not
-- exist, which reduces to a state no reader can make sense of.

ALTER TABLE public.renters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Renters read their own renter row" ON public.renters;
CREATE POLICY "Renters read their own renter row"
ON public.renters FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Renters read their own viewing requests" ON public.viewing_requests;
CREATE POLICY "Renters read their own viewing requests"
ON public.viewing_requests FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.renters r
  WHERE r.id = viewing_requests.renter_id AND r.user_id = auth.uid()
));

DROP POLICY IF EXISTS "Renters read their own request items" ON public.request_items;
CREATE POLICY "Renters read their own request items"
ON public.request_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.viewing_requests vr
  JOIN public.renters r ON r.id = vr.renter_id
  WHERE vr.id = request_items.request_id AND r.user_id = auth.uid()
));
