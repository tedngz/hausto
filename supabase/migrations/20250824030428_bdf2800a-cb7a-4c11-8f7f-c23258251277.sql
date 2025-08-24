-- Fix the subscribers table structure and manually activate the user who paid
-- First, let's check the current table structure and add the missing unique constraint

-- Add unique constraint on email if it doesn't exist
ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_email_unique UNIQUE (email);

-- Manually activate the user who paid (ng.m.hoangz@gmail.com)
INSERT INTO public.subscribers (user_id, email, subscribed, subscription_tier, subscription_end, updated_at)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'ng.m.hoangz@gmail.com'),
  'ng.m.hoangz@gmail.com', 
  true, 
  'premium', 
  now() + interval '1 month', 
  now()
)
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
  INSERT INTO public.subscribers (user_id, email, subscribed, subscription_tier, subscription_end, updated_at)
  VALUES (
    (SELECT id FROM auth.users WHERE email = user_email),
    user_email, 
    true, 
    'premium', 
    now() + interval '1 month', 
    now()
  )
  ON CONFLICT (email) 
  DO UPDATE SET 
    subscribed = true,
    subscription_tier = 'premium',
    subscription_end = now() + interval '1 month',
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;