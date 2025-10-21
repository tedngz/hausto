-- Add RLS policy to allow viewing realtor profiles for active properties
CREATE POLICY "Authenticated users can view realtor profiles for active properties"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 
    FROM public.properties 
    WHERE properties.realtor_id = profiles.id 
      AND properties.is_active = true
      AND is_property_within_active_period(properties.last_activated_at)
  )
);