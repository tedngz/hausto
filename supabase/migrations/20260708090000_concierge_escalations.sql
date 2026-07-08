-- Concierge escalations: questions the Hausto AI could not answer in a
-- post-match thread, surfaced to the realtor as a queue with status.

-- Create enum for escalation status
CREATE TYPE escalation_status AS ENUM ('pending', 'answered', 'dismissed');

-- Create concierge_escalations table
CREATE TABLE public.concierge_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.match_conversations(id) ON DELETE CASCADE,
  renter_id UUID NOT NULL,
  realtor_id UUID NOT NULL,
  -- Nullable and no FK: may point at an external listing that lives in
  -- external_properties rather than properties.
  property_id UUID,
  question TEXT NOT NULL,
  source_message_id UUID REFERENCES public.direct_messages(id),
  status escalation_status NOT NULL DEFAULT 'pending',
  answered_message_id UUID REFERENCES public.direct_messages(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.concierge_escalations ENABLE ROW LEVEL SECURITY;

-- Policy: Renters can view their own escalations (status chips in the thread)
CREATE POLICY "Renters can view their own escalations"
ON public.concierge_escalations
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

-- Policy: Realtors can view escalations assigned to them (dashboard queue)
CREATE POLICY "Realtors can view their escalations"
ON public.concierge_escalations
FOR SELECT
TO authenticated
USING (auth.uid() = realtor_id);

-- Policy: Realtors can update escalations assigned to them (answer/dismiss)
CREATE POLICY "Realtors can update their escalations"
ON public.concierge_escalations
FOR UPDATE
TO authenticated
USING (auth.uid() = realtor_id);

-- No INSERT policy on purpose: rows are created only by the concierge-reply
-- edge function using the service role.

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_concierge_escalations_updated_at
BEFORE UPDATE ON public.concierge_escalations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for queue and thread lookups
CREATE INDEX idx_concierge_escalations_realtor_status ON public.concierge_escalations(realtor_id, status);
CREATE INDEX idx_concierge_escalations_conversation_id ON public.concierge_escalations(conversation_id);

-- Realtime so the renter's status chip and the realtor queue update live
ALTER PUBLICATION supabase_realtime ADD TABLE public.concierge_escalations;
