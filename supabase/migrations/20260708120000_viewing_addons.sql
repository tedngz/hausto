-- Viewing add-ons: one-time $20 purchases that unlock unlimited Fast-Track
-- viewing bookings for 30 days. Premium includes 3 bookings per subscription
-- cycle; this add-on lifts the cap while active.

CREATE TABLE public.viewing_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id UUID NOT NULL,
  paypal_order_id TEXT NOT NULL UNIQUE,
  amount_usd NUMERIC NOT NULL DEFAULT 20,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.viewing_addons ENABLE ROW LEVEL SECURITY;

-- Renters can see their own add-ons (quota display)
CREATE POLICY "Renters can view their own viewing addons"
ON public.viewing_addons
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

-- No INSERT/UPDATE policies on purpose: rows are created only by the
-- capture-viewing-addon-order edge function using the service role after
-- PayPal confirms the payment.

CREATE INDEX idx_viewing_addons_renter_expires ON public.viewing_addons(renter_id, expires_at);
