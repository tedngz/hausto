-- Create table to track anonymous chat attempts by IP address
CREATE TABLE IF NOT EXISTS public.anonymous_chat_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address INET NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on ip_address for faster lookups
CREATE INDEX IF NOT EXISTS idx_anonymous_chat_attempts_ip 
ON public.anonymous_chat_attempts(ip_address);

-- Create index on last_attempt_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_anonymous_chat_attempts_last_attempt 
ON public.anonymous_chat_attempts(last_attempt_at);

-- Enable RLS on the table (edge functions use service role, so this is defensive)
ALTER TABLE public.anonymous_chat_attempts ENABLE ROW LEVEL SECURITY;

-- No user-facing policies needed - only edge functions access this table