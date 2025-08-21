-- Fix security issues from the previous migration

-- Update the function to set search_path for security
CREATE OR REPLACE FUNCTION public.handle_new_subscriber()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscribers (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Update RLS policies to require authentication instead of allowing anonymous access
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscribers;
DROP POLICY IF EXISTS "Users can create their own subscription" ON public.subscribers;
DROP POLICY IF EXISTS "Users can update their own subscription" ON public.subscribers;

DROP POLICY IF EXISTS "Users can view their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can create their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can update their own usage" ON public.daily_usage;

-- Create new policies that require authentication
CREATE POLICY "Authenticated users can view their own subscription" 
ON public.subscribers 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can create their own subscription" 
ON public.subscribers 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own subscription" 
ON public.subscribers 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can view their own usage" 
ON public.daily_usage 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can create their own usage" 
ON public.daily_usage 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update their own usage" 
ON public.daily_usage 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id);