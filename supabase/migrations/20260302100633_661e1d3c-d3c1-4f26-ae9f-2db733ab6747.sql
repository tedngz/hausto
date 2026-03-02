-- External properties should be readable by signed-in users (Discover requires auth)
DROP POLICY IF EXISTS "Anyone can view active external properties" ON public.external_properties;

CREATE POLICY "Authenticated users can view active external properties"
ON public.external_properties
FOR SELECT
TO authenticated
USING ((is_active = true) AND (expires_at > now()));