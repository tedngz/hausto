-- Asking a building's agents through the Zalo bridge (PLAN-v3 S7.2a, SPEC §11).
--
-- An availability request is a sourcing job: an operator asks the building's
-- agents what is free. Until now that was by hand, off the record; the bridge
-- could only carry messages about a viewing request's items. This lets a
-- realtor_messages row belong to an availability request instead:
--
--   * request_id becomes nullable beside a new inquiry_id - exactly one is set;
--   * AVAILABILITY_CHECK joins the purposes;
--   * the event a bridge send stands for (on_sent_event) may be an
--     inquiry_events row, written by the device's ack like any other.
--
-- Additive and replay-safe.

ALTER TABLE public.realtor_messages ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE public.realtor_messages
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.complex_inquiries(id) ON DELETE CASCADE;

ALTER TABLE public.realtor_messages DROP CONSTRAINT IF EXISTS realtor_messages_one_subject;
ALTER TABLE public.realtor_messages ADD CONSTRAINT realtor_messages_one_subject
  CHECK ((request_id IS NULL) <> (inquiry_id IS NULL));

ALTER TABLE public.realtor_messages DROP CONSTRAINT IF EXISTS realtor_messages_purpose_check;
ALTER TABLE public.realtor_messages ADD CONSTRAINT realtor_messages_purpose_check
  CHECK (purpose IN ('REQUEST_VIEWING', 'NUDGE', 'CONFIRM', 'RELEASE', 'REPLY', 'AVAILABILITY_CHECK'));

CREATE INDEX IF NOT EXISTS idx_realtor_messages_inquiry
  ON public.realtor_messages (inquiry_id, created_at) WHERE inquiry_id IS NOT NULL;
-- The caps read every availability check to an agent (outreach.ts).
CREATE INDEX IF NOT EXISTS idx_realtor_messages_realtor_out
  ON public.realtor_messages (realtor_id, created_at) WHERE direction = 'OUT';
