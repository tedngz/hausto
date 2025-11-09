-- Create enum for fast track request status
CREATE TYPE fast_track_status AS ENUM ('pending', 'in_progress', 'scheduled', 'completed', 'cancelled');

-- Create fast_track_requests table
CREATE TABLE public.fast_track_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.match_conversations(id) ON DELETE CASCADE,
  renter_id UUID NOT NULL,
  realtor_id UUID NOT NULL,
  property_ids UUID[] NOT NULL DEFAULT '{}',
  preferred_dates DATE[] NOT NULL,
  preferred_times TEXT[] NOT NULL,
  special_requirements TEXT,
  status fast_track_status NOT NULL DEFAULT 'pending',
  scheduled_viewings JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fast_track_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Renters can create their own fast track requests
CREATE POLICY "Renters can create their own fast track requests"
ON public.fast_track_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = renter_id);

-- Policy: Renters can view their own fast track requests
CREATE POLICY "Renters can view their own fast track requests"
ON public.fast_track_requests
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

-- Policy: Realtors can view fast track requests for their properties
CREATE POLICY "Realtors can view fast track requests for their properties"
ON public.fast_track_requests
FOR SELECT
TO authenticated
USING (auth.uid() = realtor_id);

-- Policy: Realtors can update fast track requests for their properties
CREATE POLICY "Realtors can update fast track requests for their properties"
ON public.fast_track_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = realtor_id);

-- Policy: Renters can update their own pending fast track requests
CREATE POLICY "Renters can update their own pending requests"
ON public.fast_track_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = renter_id AND status = 'pending');

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_fast_track_requests_updated_at
BEFORE UPDATE ON public.fast_track_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_fast_track_requests_renter_id ON public.fast_track_requests(renter_id);
CREATE INDEX idx_fast_track_requests_realtor_id ON public.fast_track_requests(realtor_id);
CREATE INDEX idx_fast_track_requests_conversation_id ON public.fast_track_requests(conversation_id);
CREATE INDEX idx_fast_track_requests_status ON public.fast_track_requests(status);