-- Manually activate subscription for ng.m.hoangz@gmail.com
UPDATE public.subscribers 
SET subscribed = true, 
    subscription_tier = 'premium', 
    subscription_end = now() + interval '30 days', 
    updated_at = now() 
WHERE email = 'ng.m.hoangz@gmail.com';