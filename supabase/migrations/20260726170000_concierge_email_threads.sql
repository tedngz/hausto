-- Concierge availability requests turn into an email conversation with the
-- renter. Store every message on both sides so the admin dashboard is the
-- record of what was said, no matter whether the reply was typed in the
-- dashboard or sent from Gmail.

CREATE TABLE IF NOT EXISTS public.complex_inquiry_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES public.complex_inquiries(id) ON DELETE CASCADE,
  -- inbound = from the renter, outbound = from Hausto (dashboard or Gmail)
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- where the message was composed, so the UI can label a Gmail reply
  source text NOT NULL DEFAULT 'email' CHECK (source IN ('email', 'dashboard', 'system')),
  from_email text NOT NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  subject text,
  body text NOT NULL,
  -- RFC message ids, used for threading and webhook idempotency
  provider_message_id text,
  in_reply_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.complex_inquiry_messages ENABLE ROW LEVEL SECURITY;

-- Writes happen server-side only (webhook + send function, both service role).
CREATE POLICY "Admins can read inquiry messages"
  ON public.complex_inquiry_messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_complex_inquiry_messages_inquiry
  ON public.complex_inquiry_messages(inquiry_id, created_at);

-- A provider can deliver the same message twice; keep one row per message id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_complex_inquiry_messages_provider_id
  ON public.complex_inquiry_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Denormalised activity stamps so the queue can sort and flag "renter replied"
-- without a per-row subquery.
ALTER TABLE public.complex_inquiries
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
