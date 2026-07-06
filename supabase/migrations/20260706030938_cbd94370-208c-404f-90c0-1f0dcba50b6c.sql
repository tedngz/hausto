DROP POLICY IF EXISTS "Anyone can view active external properties by direct link" ON public.external_properties;
DROP POLICY IF EXISTS "Anyone can view individual active properties by direct link" ON public.properties;
REVOKE SELECT ON public.external_properties FROM anon;
REVOKE SELECT ON public.properties FROM anon;