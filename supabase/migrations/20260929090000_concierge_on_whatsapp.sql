-- Concierge availability requests answered on WhatsApp (SPEC §11).
-- Additive, and replay-safe (IF NOT EXISTS, guarded constraints).

-- ── The request ─────────────────────────────────────────────────────────────
-- A WhatsApp request may have no email, and the form now asks for a monthly
-- ceiling in dong rather than a USD range. The old columns stay for the rows
-- that have them.
ALTER TABLE public.complex_inquiries ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.complex_inquiries ALTER COLUMN budget_usd_min DROP NOT NULL;
ALTER TABLE public.complex_inquiries ALTER COLUMN budget_usd_max DROP NOT NULL;

ALTER TABLE public.complex_inquiries
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS budget_max_vnd bigint,
  -- The watch whose code is this request's WhatsApp handshake.
  ADD COLUMN IF NOT EXISTS watch_id uuid REFERENCES public.complex_watches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renter_id uuid REFERENCES public.renters(id) ON DELETE SET NULL,
  -- When the code arrived. The concierge's 24 hours start here.
  ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complex_inquiries_channel_check') THEN
    ALTER TABLE public.complex_inquiries
      ADD CONSTRAINT complex_inquiries_channel_check CHECK (channel IN ('WHATSAPP', 'EMAIL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complex_inquiries_email_channel_check') THEN
    ALTER TABLE public.complex_inquiries
      ADD CONSTRAINT complex_inquiries_email_channel_check CHECK (channel <> 'EMAIL' OR email IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_complex_inquiries_watch
  ON public.complex_inquiries (watch_id) WHERE watch_id IS NOT NULL;

-- Requests are created by complex-inquiry-create now, which validates them and
-- owns the WhatsApp handshake. A direct insert from the browser would skip both.
DROP POLICY IF EXISTS "Anyone can submit an inquiry" ON public.complex_inquiries;

-- ── The thread ──────────────────────────────────────────────────────────────
-- One conversation per request, whatever carried each message. A WhatsApp
-- message has no email sender, and carries the `messages` row it was.
ALTER TABLE public.complex_inquiry_messages ALTER COLUMN from_email DROP NOT NULL;

ALTER TABLE public.complex_inquiry_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS whatsapp_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complex_inquiry_messages_channel_check') THEN
    ALTER TABLE public.complex_inquiry_messages
      ADD CONSTRAINT complex_inquiry_messages_channel_check CHECK (channel IN ('WHATSAPP', 'EMAIL'));
  END IF;
END $$;

-- 'whatsapp' joins the places a message can be composed: the renter's phone.
ALTER TABLE public.complex_inquiry_messages DROP CONSTRAINT IF EXISTS complex_inquiry_messages_source_check;
ALTER TABLE public.complex_inquiry_messages
  ADD CONSTRAINT complex_inquiry_messages_source_check
  CHECK (source IN ('email', 'dashboard', 'system', 'whatsapp'));

-- One thread row per WhatsApp message: a redelivery is a no-op, and a
-- renter's reply finds its request from the last message we sent them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_complex_inquiry_messages_whatsapp
  ON public.complex_inquiry_messages (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
