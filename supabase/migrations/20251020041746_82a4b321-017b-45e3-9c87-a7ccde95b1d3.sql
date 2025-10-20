-- Drop the view as it causes security concerns
DROP VIEW IF EXISTS public.active_properties;

-- Update the function to have proper security settings
DROP FUNCTION IF EXISTS public.is_property_within_active_period(timestamp with time zone);

CREATE OR REPLACE FUNCTION public.is_property_within_active_period(activated_at timestamp with time zone)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT activated_at > (now() - interval '10 days');
$$;

-- Update the RLS policy for viewing properties to only show active ones within 10 days
DROP POLICY IF EXISTS "Authenticated users can view published properties" ON public.properties;

CREATE POLICY "Authenticated users can view active properties" 
ON public.properties 
FOR SELECT 
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND is_active = true 
  AND public.is_property_within_active_period(last_activated_at)
);

-- Allow realtors to view ALL their own properties (active or not)
CREATE POLICY "Realtors can view all their own properties" 
ON public.properties 
FOR SELECT 
TO authenticated
USING (auth.uid() = realtor_id);