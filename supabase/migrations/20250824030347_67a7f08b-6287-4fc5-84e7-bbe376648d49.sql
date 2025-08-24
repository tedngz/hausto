-- First, let's check if the subscribers table exists and manually update the user who paid
-- We'll also create a function to manually activate subscriptions

-- Create or update subscribers table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  paypal_subscription_id TEXT,
  subscribed BOOLEAN DEFAULT false,
  subscription_tier TEXT DEFAULT 'free',
  subscription_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- Create policies for subscribers table
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscribers;
CREATE POLICY "Users can view their own subscription" 
ON public.subscribers 
FOR SELECT 
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage all subscriptions" ON public.subscribers;
CREATE POLICY "Service role can manage all subscriptions" 
ON public.subscribers 
FOR ALL 
USING (true);

-- Manually activate the user who paid (ng.m.hoangz@gmail.com)
INSERT INTO public.subscribers (email, subscribed, subscription_tier, subscription_end, updated_at)
VALUES ('ng.m.hoangz@gmail.com', true, 'premium', now() + interval '1 month', now())
ON CONFLICT (email) 
DO UPDATE SET 
  subscribed = true,
  subscription_tier = 'premium',
  subscription_end = now() + interval '1 month',
  updated_at = now();

-- Create a function to manually activate subscriptions for testing
CREATE OR REPLACE FUNCTION activate_user_subscription(user_email TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO public.subscribers (email, subscribed, subscription_tier, subscription_end, updated_at)
  VALUES (user_email, true, 'premium', now() + interval '1 month', now())
  ON CONFLICT (email) 
  DO UPDATE SET 
    subscribed = true,
    subscription_tier = 'premium',
    subscription_end = now() + interval '1 month',
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;