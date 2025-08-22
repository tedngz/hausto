-- Drop existing policies that have issues with anonymous access
DROP POLICY IF EXISTS "Authenticated users can view their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Authenticated users can create their own usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Authenticated users can update their own usage" ON public.daily_usage;

-- Create new, more specific policies that only work for authenticated users
CREATE POLICY "Users can view their own usage data" 
ON public.daily_usage 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own usage data" 
ON public.daily_usage 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own usage data" 
ON public.daily_usage 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Also fix the subscribers table policies
DROP POLICY IF EXISTS "Authenticated users can view their own subscription" ON public.subscribers;
DROP POLICY IF EXISTS "Authenticated users can create their own subscription" ON public.subscribers;  
DROP POLICY IF EXISTS "Authenticated users can update their own subscription" ON public.subscribers;

CREATE POLICY "Users can view their own subscription data" 
ON public.subscribers 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscription data" 
ON public.subscribers 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscription data" 
ON public.subscribers 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);