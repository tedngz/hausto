-- Enable RLS on anonymous_chat_attempts table
ALTER TABLE public.anonymous_chat_attempts ENABLE ROW LEVEL SECURITY;

-- Add policy to restrict access to service role only (edge functions)
-- This prevents authenticated users from viewing/manipulating rate limit data
CREATE POLICY "Service role only access" ON public.anonymous_chat_attempts
FOR ALL 
USING (false);

-- Add comment explaining the security model
COMMENT ON TABLE public.anonymous_chat_attempts IS 'Rate limiting table for anonymous chat users. Access restricted to service role (edge functions) only via RLS.';