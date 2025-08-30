-- Strengthen security for subscribers table
-- First, ensure user_id cannot be null (critical for RLS)
ALTER TABLE public.subscribers ALTER COLUMN user_id SET NOT NULL;

-- Add a unique constraint on user_id to prevent duplicate subscriptions
ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_user_id_unique UNIQUE (user_id);

-- Update RLS policies to be more restrictive
DROP POLICY IF EXISTS "Authenticated users can view their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Authenticated users can update their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Authenticated users can insert their own subscription data" ON public.subscribers;

-- Create more secure RLS policies
CREATE POLICY "Users can only view their own subscription data" ON public.subscribers
FOR SELECT
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can only update their own subscription data" ON public.subscribers
FOR UPDATE
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can only insert their own subscription data" ON public.subscribers
FOR INSERT
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- Add a security definer function to safely get user subscription status
-- This prevents direct access to sensitive subscription fields
CREATE OR REPLACE FUNCTION public.get_user_subscription_status()
RETURNS TABLE(
  subscribed boolean,
  subscription_tier text,
  subscription_end timestamptz
) AS $$
BEGIN
  -- Return subscription status for authenticated user only
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'free'::text, null::timestamptz;
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT s.subscribed, s.subscription_tier, s.subscription_end
  FROM public.subscribers s
  WHERE s.user_id = auth.uid();
  
  -- If no record found, return default values
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::boolean, 'free'::text, null::timestamptz;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public;