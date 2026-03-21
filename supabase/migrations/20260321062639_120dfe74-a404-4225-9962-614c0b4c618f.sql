CREATE POLICY "Anyone can view active external properties by direct link"
ON public.external_properties
FOR SELECT
TO public
USING (is_active = true AND expires_at > now());